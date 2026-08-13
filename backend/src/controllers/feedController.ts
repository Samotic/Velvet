import type { Request, Response } from 'express';

import { FeedCache } from '../models/FeedCache';
import { ItemPopularity } from '../models/ItemPopularity';
import { UserStats } from '../models/UserStats';
import { WatchlistItem } from '../models/WatchlistItem';
import { buildCandidates, crossoverPicks, tasteTwinPicks, type ScoredCandidate } from '../lib/cf/candidates';
import { lovedAlongside, topRatedItem } from '../lib/cf/cooccurrence';
import { computeNeighborsForUser, needsRecompute } from '../lib/cf/neighbors';
import { recomputePopularity } from '../lib/cf/popularity';
import { buildSeedGrid } from '../lib/cf/seeding';
import { recomputeUserStats, upsertRating } from '../lib/cf/stats';
import { CF_PARAMS, IMPLICIT_VALUES, itemKey, type FeedStrategy, type ItemKey, type RailKind } from '../types/cf';
import { fail, ok } from '../utils/http';
import { isContentType, str } from '../utils/validation';
import type { ContentType } from '../models/User';

/**
 * The personalised home feed — §11's ladder, §13's rails.
 *
 * ── §14, non-negotiable ──
 * The neighbourhood is derived from other people's ratings. **Nothing here may
 * carry a neighbour's id, username, avatar, or similarity score.** `FeedItem`
 * has no field capable of holding one, which is deliberate: a rule enforced by
 * the type is a rule that survives the next edit. "Your taste twin also loved"
 * describes a real person and must never name them.
 *
 * ── The rule that keeps the ladder honest ──
 * A CF rail is never padded with non-CF items. Short rails in separate,
 * labelled sections beat one long rail that quietly mixes a prediction with a
 * popularity ranking — the user cannot tell the difference, which is exactly
 * why it would be dishonest.
 */

interface FeedItem {
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
  /** Shown on the card. Describes evidence, never a person. */
  reason: string;
}

interface Rail {
  id: string;
  title: string;
  reason: string;
  kind: RailKind;
  items: FeedItem[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RAIL_SIZE = 20;

/** Strips every internal score before anything leaves the server. */
const toItem = (c: ScoredCandidate, reason: string): FeedItem => ({
  contentId: c.contentId,
  contentType: c.contentType,
  title: c.title,
  poster: c.poster,
  reason,
});

/** GET /api/feed */
export async function feed(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;

    const fresh = await FeedCache.findOne({ userId, expiresAt: { $gt: new Date() } }).lean();
    if (fresh && req.query.refresh !== '1') {
      return ok(res, {
        strategy: fresh.strategy,
        needsSeeding: false,
        rails: fresh.rails,
        cached: true,
      });
    }

    const built = await buildFeed(userId);

    if (built.strategy !== 'cold') {
      await FeedCache.updateOne(
        { userId },
        {
          $set: {
            rails: built.rails,
            strategy: built.strategy,
            builtAt: new Date(),
            expiresAt: new Date(Date.now() + CACHE_TTL_MS),
          },
        },
        { upsert: true },
      );
    }

    return ok(res, { ...built, cached: false });
  } catch (err) {
    console.error('feed error:', err);
    return fail(res, 'Could not build your feed', 500);
  }
}

/**
 * Walks the ladder and assembles the rails.
 *
 * Tiers are evaluated per request rather than stored on the user: a tier is a
 * statement about the data right now, and a user crosses between them by
 * rating one more thing.
 */
async function buildFeed(
  userId: string,
): Promise<{ strategy: FeedStrategy; needsSeeding: boolean; rails: Rail[]; diagnostics: unknown }> {
  const stats = await UserStats.findOne({ userId }).lean();
  const ratingCount = stats?.ratingCount ?? 0;

  // ── cold ── No row vector at all. Similarity to everyone is undefined, so
  // there is nothing to rank and nothing to degrade to but seeding.
  if (ratingCount === 0) {
    return {
      strategy: 'cold',
      needsSeeding: true,
      rails: [],
      diagnostics: { ratingCount, reason: 'no ratings yet' },
    };
  }

  const rated = new Set<ItemKey>(stats?.ratedKeys ?? []);
  const rails: Rail[] = [];

  const { candidates, ctx } = await buildCandidates(userId);
  const cfReady =
    ctx.neighborCount >= CF_PARAMS.cfMinNeighbors && candidates.length >= CF_PARAMS.cfMinItems;

  // ── cf rails ── Only when the neighbourhood is real. Below the threshold
  // these are omitted entirely rather than filled with something else.
  if (candidates.length) {
    rails.push({
      id: 'neighborhood',
      title: 'People with your taste are watching',
      reason: 'Ranked by what people who rate like you rated highly.',
      kind: 'neighborhood',
      items: candidates
        .slice(0, RAIL_SIZE)
        .map((c) => toItem(c, `Predicted ${c.pred.toFixed(1)} for you`)),
    });

    const twin = await tasteTwinPicks(userId, rated);
    if (twin.length) {
      rails.push({
        id: 'taste-twin',
        title: 'Your taste twin also loved',
        // No name, no link, no avatar — §14. The rail describes a
        // relationship, never a person.
        reason: 'From the one person whose ratings line up closest with yours.',
        kind: 'taste_twin',
        items: twin.slice(0, RAIL_SIZE).map((c) => toItem(c, 'They rated this 4.5+')),
      });
    }

    const crossover = crossoverPicks(
      candidates,
      stats?.mediaTypeMix ?? { movie: 0, series: 0, game: 0 },
    );
    if (crossover.length) {
      rails.push({
        id: 'crossover',
        title: 'Crossing over',
        reason: 'Outside your usual medium — the same taste, a different form.',
        kind: 'neighborhood',
        items: crossover.slice(0, RAIL_SIZE).map((c) => toItem(c, `Predicted ${c.pred.toFixed(1)} for you`)),
      });
    }
  }

  // ── seeded / hybrid ── Co-occurrence asks a smaller question than Pearson,
  // and sparse data can answer it.
  const seed = await topRatedItem(userId);
  if (seed) {
    const alongside = await lovedAlongside(seed.itemKey, { exclude: rated, limit: RAIL_SIZE });
    if (alongside.length) {
      rails.push({
        id: 'co-occurrence',
        title: `Often loved alongside ${seed.title || 'what you rated'}`,
        reason: 'People who rated that highly also rated these highly.',
        kind: 'co_occurrence',
        items: alongside.map((c) => ({
          contentId: c.contentId,
          contentType: c.contentType,
          title: c.title,
          poster: c.poster,
          reason: `${c.count} ${c.count === 1 ? 'person' : 'people'} loved both`,
        })),
      });
    }
  }

  // ── watchlist, ranked ── Their own list, ordered by prediction where one
  // exists. Useful at every tier, since the items are already theirs.
  const watchlist = await WatchlistItem.find({ userId }).limit(60).lean();
  if (watchlist.length) {
    const predByKey = new Map(candidates.map((c) => [c.itemKey, c.pred]));
    const ranked = watchlist
      .map((w) => ({ w, pred: predByKey.get(itemKey(w.contentType, w.contentId)) ?? 0 }))
      .sort((a, b) => b.pred - a.pred)
      .slice(0, RAIL_SIZE);

    rails.push({
      id: 'watchlist',
      title: 'Your watchlist, ranked',
      reason: 'What you saved, ordered by how much we think you will like it.',
      kind: 'watchlist',
      items: ranked.map(({ w, pred }) => ({
        contentId: w.contentId,
        contentType: w.contentType,
        title: w.contentTitle ?? '',
        poster: w.poster ?? null,
        reason: pred > 0 ? `Predicted ${pred.toFixed(1)} for you` : 'On your watchlist',
      })),
    });
  }

  // ── Widely loved ── hybrid and seeded tiers only. §13 is explicit that this
  // does not appear once CF is carrying the feed, or the popularity rail
  // becomes the thing users actually scroll and CF becomes decorative.
  if (!cfReady) {
    const popular = await ItemPopularity.find({
      raterCount: { $gt: 0 },
      itemKey: { $nin: [...rated] },
    })
      .sort({ meanRating: -1, raterCount: -1 })
      .limit(RAIL_SIZE)
      .lean();

    if (popular.length) {
      rails.push({
        id: 'popular',
        title: 'Widely loved',
        reason: 'Highly rated across Velvet. Not personalised — yet.',
        kind: 'popular',
        items: popular.map((p) => ({
          contentId: p.contentId,
          contentType: p.contentType,
          title: p.title,
          poster: p.poster,
          reason: `${p.meanRating.toFixed(1)} average from ${p.raterCount}`,
        })),
      });
    }
  }

  const strategy: FeedStrategy = cfReady ? 'cf' : ratingCount < 5 ? 'seeded' : 'hybrid';

  return {
    strategy,
    needsSeeding: false,
    rails,
    diagnostics: {
      ratingCount,
      neighborCount: ctx.neighborCount,
      candidateCount: candidates.length,
      cfReady,
      needs: cfReady
        ? null
        : `cf tier needs >=${CF_PARAMS.cfMinNeighbors} neighbours and >=${CF_PARAMS.cfMinItems} predicted items`,
    },
  };
}

/** GET /api/feed/seed — the cold-start grid. */
export async function seedGrid(req: Request, res: Response): Promise<Response> {
  try {
    const items = await buildSeedGrid(req.user!.userId);
    return ok(res, { items, required: 5 });
  } catch (err) {
    console.error('seedGrid error:', err);
    return fail(res, 'Could not load the picker', 500);
  }
}

/**
 * POST /api/feed/seed
 *
 * §12 requires the feed be built in the same response — the user has just
 * rated twenty things and must not land on an empty screen while a job
 * catches up. So stats, popularity and this user's neighbours are all computed
 * synchronously here.
 */
export async function submitSeed(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const raw = (req.body ?? {}).ratings;
    if (!Array.isArray(raw)) return fail(res, 'Send an array of ratings', 422);

    const entries = raw
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .filter((r) => typeof r.contentId === 'string' && isContentType(r.contentType))
      .filter((r) => typeof r.value === 'number' && r.value >= 1 && r.value <= 5)
      .slice(0, 60);

    // A binary tap gives no variance, and Pearson on a constant vector is
    // undefined. Five *rated* items is the floor, not five tapped ones.
    if (entries.length < 5) {
      return fail(res, 'Rate at least 5 titles so we can find your taste', 422);
    }

    for (const e of entries) {
      await upsertRating({
        userId,
        contentId: String(e.contentId),
        contentType: e.contentType as ContentType,
        value: Number(e.value),
        source: 'explicit',
        contentTitle: str(e.title),
        poster: typeof e.poster === 'string' ? e.poster : null,
      });
    }

    await recomputeUserStats(userId);
    await recomputePopularity();
    await computeNeighborsForUser(userId);
    await FeedCache.deleteOne({ userId });

    const built = await buildFeed(userId);
    return ok(res, { ...built, cached: false });
  } catch (err) {
    console.error('submitSeed error:', err);
    return fail(res, 'Could not save those ratings', 500);
  }
}

/**
 * POST /api/feed/dismiss — "Not for me".
 *
 * Writes a 1.5 pseudo-rating rather than a hidden-ids list, so the dismissal
 * enters the matrix and improves this user's similarity to others instead of
 * merely filtering one card. The tooltip says so: a signal that silently
 * trains a model is not something to be quiet about.
 */
export async function dismiss(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.contentId !== 'string' || !isContentType(body.contentType)) {
      return fail(res, 'Unknown title', 422);
    }

    await upsertRating({
      userId,
      contentId: body.contentId,
      contentType: body.contentType,
      value: IMPLICIT_VALUES.dismissed,
      source: 'implicit',
      contentTitle: str(body.title),
    });

    // The dismissed card must be gone on the next load, not in six hours.
    await FeedCache.deleteOne({ userId });

    // §10's incremental path: cheap for one user, and criterion 5 wants a
    // visible change within 30s.
    if (await needsRecompute(userId)) void computeNeighborsForUser(userId).catch(() => {});

    return ok(res, { dismissed: true });
  } catch (err) {
    console.error('dismiss error:', err);
    return fail(res, 'Could not dismiss that', 500);
  }
}
