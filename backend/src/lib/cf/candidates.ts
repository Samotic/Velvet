import { Types } from 'mongoose';

import { ItemPopularity } from '../../models/ItemPopularity';
import { Rating } from '../../models/Rating';
import { UserNeighbors } from '../../models/UserNeighbors';
import { UserStats } from '../../models/UserStats';
import { CF_PARAMS, itemKey, type ItemKey } from '../../types/cf';
import { capInfluence, predict, rankScore, type NeighborRating } from './predict';
import type { ContentType } from '../../models/User';

/**
 * Candidate generation — §9.
 *
 * Candidates come from **neighbours**, never from a TMDB discover call. That
 * distinction is the difference between collaborative filtering and a genre
 * browser wearing its clothes: if the pool is drawn from the catalogue, the
 * neighbourhood is only re-ranking someone else's editorial choices.
 */

export interface ScoredCandidate {
  itemKey: ItemKey;
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
  pred: number;
  conf: number;
  support: number;
  raterCount: number;
  score: number;
}

export interface CandidateContext {
  /** The viewer's mean, for centring predictions. */
  userMean: number;
  /** Their rated set — excluded from candidates, including dismissals. */
  rated: Set<ItemKey>;
  /** Whether enough neighbours exist to call this the `cf` tier. */
  neighborCount: number;
}

/**
 * Builds and ranks the candidate pool for one user.
 *
 * Query shape matters here. This loads every neighbour's ≥4.0 ratings in one
 * go and groups in memory, rather than asking per item — the pool is a few
 * hundred items across a few dozen neighbours, and a per-item round trip
 * would be the N+1 that blows §16's 400ms budget.
 */
export async function buildCandidates(
  userId: string,
): Promise<{ candidates: ScoredCandidate[]; ctx: CandidateContext }> {
  const [stats, neighborDoc] = await Promise.all([
    UserStats.findOne({ userId }).lean(),
    UserNeighbors.findOne({ userId }).lean(),
  ]);

  const userMean = stats?.meanRating ?? 3;
  const rated = new Set<ItemKey>(stats?.ratedKeys ?? []);

  // Top K by similarity. Stored is 80; predictions use 40.
  const neighbors = (neighborDoc?.neighbors ?? [])
    .filter((n) => n.sim > CF_PARAMS.minSim && n.coRated >= CF_PARAMS.minCoRated)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, CF_PARAMS.K);

  const ctx: CandidateContext = { userMean, rated, neighborCount: neighbors.length };
  if (!neighbors.length) return { candidates: [], ctx };

  const simById = new Map(neighbors.map((n) => [String(n.userId), n.sim]));
  const neighborIds = neighbors.map((n) => n.userId);

  // Each neighbour's own mean — predictions centre on it, so a missing one
  // would silently treat that neighbour as if they averaged the viewer's mean.
  const neighborStats = await UserStats.find({ userId: { $in: neighborIds } })
    .select('userId meanRating')
    .lean();
  const meanById = new Map(neighborStats.map((s) => [String(s.userId), s.meanRating]));

  const loved = await Rating.find({
    userId: { $in: neighborIds },
    rating: { $gte: 4 },
  })
    .select('userId contentId contentType contentTitle poster rating')
    .lean();

  // itemKey -> the neighbours who rated it, with what they gave and their mean.
  const byItem = new Map<
    ItemKey,
    { contentId: string; contentType: ContentType; title: string; poster: string | null; ratings: NeighborRating[] }
  >();

  for (const r of loved) {
    const key = itemKey(r.contentType, r.contentId);
    // §9 step 2: never recommend something they have already rated — and a
    // dismissal is a rating, which is how "dismissed never reappears" holds.
    if (rated.has(key)) continue;

    const sim = simById.get(String(r.userId));
    if (sim === undefined) continue;

    const entry =
      byItem.get(key) ??
      {
        contentId: r.contentId,
        contentType: r.contentType,
        title: r.contentTitle ?? '',
        poster: r.poster ?? null,
        ratings: [] as NeighborRating[],
      };

    entry.ratings.push({
      sim,
      value: r.rating,
      mean: meanById.get(String(r.userId)) ?? 3,
    });
    byItem.set(key, entry);
  }

  const popular = await ItemPopularity.find({ itemKey: { $in: [...byItem.keys()] } })
    .select('itemKey raterCount')
    .lean();
  const raterCountByKey = new Map(popular.map((p) => [p.itemKey, p.raterCount]));

  const scored: ScoredCandidate[] = [];

  for (const [key, entry] of byItem) {
    // §9 step 3 — enough neighbours actually rated it to trust the number.
    if (entry.ratings.length < CF_PARAMS.minNeighborsPerItem) continue;

    const capped = capInfluence(entry.ratings);
    const { pred, conf, support } = predict(userMean, capped);
    if (conf <= 0) continue;

    const raterCount = raterCountByKey.get(key) ?? 0;
    scored.push({
      itemKey: key,
      contentId: entry.contentId,
      contentType: entry.contentType,
      title: entry.title,
      poster: entry.poster,
      pred,
      conf,
      support,
      raterCount,
      score: rankScore(pred, conf, raterCount),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return { candidates: scored.slice(0, CF_PARAMS.maxCandidates), ctx };
}

/**
 * The single closest neighbour with a substantial overlap, and their 4.5+
 * items — the "taste twin" rail.
 *
 * §14: the returned items carry no trace of who this person is. The rail says
 * "your taste twin", never a name, never a link, never an avatar. Exposing
 * them would turn a recommendation into a disclosure of someone else's
 * ratings.
 */
export async function tasteTwinPicks(
  userId: string,
  rated: Set<ItemKey>,
): Promise<ScoredCandidate[]> {
  const doc = await UserNeighbors.findOne({ userId }).lean();
  const twin = (doc?.neighbors ?? [])
    .filter((n) => n.coRated >= 8)
    .sort((a, b) => b.sim - a.sim)[0];
  if (!twin) return [];

  const rows = await Rating.find({ userId: twin.userId, rating: { $gte: 4.5 } })
    .select('contentId contentType contentTitle poster rating')
    .sort({ rating: -1, updatedAt: -1 })
    .limit(40)
    .lean();

  return rows
    .filter((r) => !rated.has(itemKey(r.contentType, r.contentId)))
    .map((r) => ({
      itemKey: itemKey(r.contentType, r.contentId),
      contentId: r.contentId,
      contentType: r.contentType,
      title: r.contentTitle ?? '',
      poster: r.poster ?? null,
      pred: r.rating,
      conf: twin.sim,
      support: 1,
      raterCount: 0,
      score: r.rating * twin.sim,
    }));
}

/**
 * §13 rail 4 — items whose media type differs from the user's dominant one.
 *
 * Velvet's differentiator, given a real slot rather than left to chance. The
 * cross-media matrix is the reason a neighbour found through a game can
 * surface a film, and without an explicit rail that mostly stays invisible:
 * a user with 40 film ratings has a neighbourhood of film-raters, so their
 * top-ranked items are films all the way down.
 */
export function crossoverPicks(
  candidates: ScoredCandidate[],
  mix: { movie: number; series: number; game: number },
): ScoredCandidate[] {
  const dominant = (Object.entries(mix) as Array<[ContentType, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  if (!dominant) return [];
  return candidates.filter((c) => c.contentType !== dominant);
}

/** Convenience for the feed controller's exclusion set. */
export const ratedKeySet = (keys: string[] | undefined): Set<ItemKey> =>
  new Set<ItemKey>(keys ?? []);

export const toObjectId = (id: string): Types.ObjectId => new Types.ObjectId(id);
