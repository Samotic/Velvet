import type { Request, Response } from 'express';
import { Types } from 'mongoose';

import { Rating } from '../models/Rating';
import { UserStats } from '../models/UserStats';
import { ItemPopularity } from '../models/ItemPopularity';
import { lovedAlongside, topRatedItem } from '../lib/cf/cooccurrence';
import { buildSeedGrid } from '../lib/cf/seeding';
import { recomputeUserStats, upsertRating } from '../lib/cf/stats';
import { CF_PARAMS, IMPLICIT_VALUES, itemKey, type FeedStrategy } from '../types/cf';
import { fail, ok } from '../utils/http';
import { isContentType, str } from '../utils/validation';
import type { RailKind } from '../types/cf';

/**
 * The personalised home feed and its cold-start path.
 *
 * ── §14, non-negotiable ──
 * The neighbourhood is derived from other people's ratings. Nothing in any
 * response here may carry a neighbour's id, username, avatar, or similarity
 * score. `GET /api/feed` returns **items only**. "Your taste twin also loved"
 * describes a real person and must never name them.
 *
 * ── The ladder ──
 * Which tier fired is recorded and returned, so a thin feed can be explained
 * rather than guessed at. The rule that keeps it honest: a CF rail is never
 * padded with non-CF items. Short rails in separate, labelled sections beat
 * one long rail that quietly mixes a prediction with a popularity ranking.
 */

interface FeedItem {
  contentId: string;
  contentType: 'movie' | 'series' | 'game';
  title: string;
  poster: string | null;
  /** Why this is here, for the card's tooltip. Never mentions a person. */
  reason: string;
  score: number;
}

interface Rail {
  id: string;
  title: string;
  reason: string;
  kind: RailKind;
  items: FeedItem[];
}

/** GET /api/feed */
export async function feed(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const stats = await UserStats.findOne({ userId }).lean();
    const ratingCount = stats?.ratingCount ?? 0;

    // Tier: cold. No row vector at all — similarity to everyone is undefined,
    // so there is nothing to rank and nothing to fall back to but seeding.
    if (ratingCount === 0) {
      return ok(res, {
        strategy: 'cold' satisfies FeedStrategy,
        needsSeeding: true,
        rails: [],
      });
    }

    const rated = new Set(stats?.ratedKeys ?? []);
    const rails: Rail[] = [];

    // Tier: seeded (1-4 ratings). Co-occurrence only — raw counts, no Pearson.
    // A row of two items correlates with everything or nothing, so asking
    // "whose taste resembles yours" is meaningless here. "What is loved
    // alongside this" is a smaller question sparse data can answer.
    const seed = await topRatedItem(userId);
    if (seed) {
      const alongside = await lovedAlongside(seed.itemKey, { exclude: rated, limit: 20 });
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
            score: c.count,
          })),
        });
      }
    }

    // Widely loved — the hybrid/seeded floor. Present so the feed is never
    // empty, and labelled honestly rather than dressed up as personalisation.
    const popular = await ItemPopularity.find({
      raterCount: { $gt: 0 },
      itemKey: { $nin: [...rated] },
    })
      .sort({ meanRating: -1, raterCount: -1 })
      .limit(20)
      .lean();

    if (popular.length) {
      rails.push({
        id: 'popular',
        title: 'Widely loved',
        reason: 'Highly rated across Velvet.',
        kind: 'popular',
        items: popular.map((p) => ({
          contentId: p.contentId,
          contentType: p.contentType,
          title: p.title,
          poster: p.poster,
          reason: `${p.meanRating.toFixed(1)} average from ${p.raterCount}`,
          score: p.meanRating,
        })),
      });
    }

    const strategy: FeedStrategy = ratingCount < 5 ? 'seeded' : 'hybrid';

    return ok(res, {
      strategy,
      needsSeeding: false,
      rails,
      // Deliberately exposed: the UI says why a feed is thin instead of
      // pretending it is personalised.
      diagnostics: {
        ratingCount,
        cfReady: false,
        note:
          'CF tier requires co-rated overlap between users. Neighbour computation ' +
          'activates once the rating matrix has users sharing rated titles.',
      },
    });
  } catch (err) {
    console.error('feed error:', err);
    return fail(res, 'Could not build your feed', 500);
  }
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
 * POST /api/feed/seed — writes the picker's ratings.
 *
 * §12 requires the feed be built in the same response, so the user never sees
 * an empty screen between rating twenty things and getting something back.
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

    // §12: a binary tap gives no variance, and Pearson on a constant vector is
    // undefined. Five *rated* items is the floor, not five tapped ones.
    if (entries.length < 5) {
      return fail(res, 'Rate at least 5 titles so we can find your taste', 422);
    }

    for (const e of entries) {
      await upsertRating({
        userId,
        contentId: String(e.contentId),
        contentType: e.contentType as 'movie' | 'series' | 'game',
        value: Number(e.value),
        source: 'explicit',
        contentTitle: str(e.title),
        poster: typeof e.poster === 'string' ? e.poster : null,
      });
    }

    await recomputeUserStats(userId);
    return feed(req, res);
  } catch (err) {
    console.error('submitSeed error:', err);
    return fail(res, 'Could not save those ratings', 500);
  }
}

/**
 * POST /api/feed/dismiss — "Not for me".
 *
 * Writes a 1.5 pseudo-rating rather than a hidden-ids list. A dismissal is
 * real taste information, and putting it in the matrix means it improves the
 * user's similarity to others instead of merely filtering one card. The
 * tooltip says so, because a dismissal that silently trains a model the user
 * doesn't know about is not something to be quiet about.
 */
export async function dismiss(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.contentId !== 'string' || !isContentType(body.contentType)) {
      return fail(res, 'Unknown title', 422);
    }

    await upsertRating({
      userId: req.user!.userId,
      contentId: body.contentId,
      contentType: body.contentType,
      value: IMPLICIT_VALUES.dismissed,
      source: 'implicit',
      contentTitle: str(body.title),
    });

    return ok(res, { dismissed: true });
  } catch (err) {
    console.error('dismiss error:', err);
    return fail(res, 'Could not dismiss that', 500);
  }
}
