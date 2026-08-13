import { Types } from 'mongoose';

import { Rating } from '../../models/Rating';
import { itemKey, parseItemKey, type ItemKey } from '../../types/cf';

/**
 * "Users who rated X ≥ 4 also rated Y ≥ 4" — raw counts, no correlation.
 *
 * ── Why this exists alongside Pearson ──
 * §11's `seeded` tier covers users with 1–4 ratings, where UBCF is not merely
 * weak but undefined: a row of two items correlates with everything or
 * nothing. Co-occurrence asks a smaller question that sparse data can actually
 * answer — not "whose taste resembles yours" but "what tends to be loved
 * alongside this".
 *
 * It needs no user similarity, no mean-centring, and no neighbourhood. It
 * needs exactly one thing: that *somebody* rated both items highly. That makes
 * it the only recommender in this system that produces anything on Velvet's
 * current matrix.
 *
 * Counts are not normalised into a score deliberately. A raw count is honest
 * about its own thinness — "3 people" is legible in a way a 0.42 affinity is
 * not — and the tier is labelled "Often loved alongside {title}" precisely so
 * the claim matches the evidence.
 */

const LOVED = 4;

export interface CoOccurrence {
  itemKey: ItemKey;
  contentId: string;
  contentType: 'movie' | 'series' | 'game';
  title: string;
  poster: string | null;
  /** How many users rated both this and the seed ≥ 4. */
  count: number;
  meanRating: number;
}

/**
 * Items frequently loved by the people who loved `seed`.
 *
 * Two queries regardless of how many co-occurrences exist: find the lovers of
 * the seed, then group their other loved items. Walking per-user would be N+1
 * over a set that grows with the item's popularity.
 */
export async function lovedAlongside(
  seed: ItemKey,
  opts: { exclude?: Set<ItemKey>; limit?: number } = {},
): Promise<CoOccurrence[]> {
  const parsed = parseItemKey(seed);
  if (!parsed) return [];

  const lovers = await Rating.find({
    contentId: parsed.id,
    contentType: parsed.type,
    rating: { $gte: LOVED },
  })
    .select('userId')
    .lean();

  if (!lovers.length) return [];
  const loverIds = lovers.map((l) => l.userId);

  const rows: Array<{
    _id: { contentId: string; contentType: 'movie' | 'series' | 'game' };
    count: number;
    meanRating: number;
    title: string;
    poster: string | null;
  }> = await Rating.aggregate([
    { $match: { userId: { $in: loverIds }, rating: { $gte: LOVED } } },
    {
      $group: {
        _id: { contentId: '$contentId', contentType: '$contentType' },
        count: { $sum: 1 },
        meanRating: { $avg: '$rating' },
        title: { $first: '$contentTitle' },
        poster: { $first: '$poster' },
      },
    },
    { $sort: { count: -1, meanRating: -1 } },
    { $limit: (opts.limit ?? 40) + 40 },
  ]);

  const exclude = opts.exclude ?? new Set<ItemKey>();
  const out: CoOccurrence[] = [];

  for (const r of rows) {
    const key = itemKey(r._id.contentType, r._id.contentId);
    // The seed always co-occurs with itself; so does anything already rated.
    if (key === seed || exclude.has(key)) continue;
    out.push({
      itemKey: key,
      contentId: r._id.contentId,
      contentType: r._id.contentType,
      title: r.title ?? '',
      poster: r.poster ?? null,
      count: r.count,
      meanRating: r.meanRating,
    });
    if (out.length >= (opts.limit ?? 40)) break;
  }

  return out;
}

/**
 * The user's own highest-rated item — the seed the `seeded` tier builds from.
 *
 * Ties break toward the most recent, so a user whose top rating is three
 * 5-star films gets a rail off the one they're currently thinking about.
 */
export async function topRatedItem(
  userId: string | Types.ObjectId,
): Promise<{ itemKey: ItemKey; title: string } | null> {
  const row = await Rating.findOne({ userId: new Types.ObjectId(String(userId)) })
    .sort({ rating: -1, updatedAt: -1 })
    .select('contentId contentType contentTitle')
    .lean();

  if (!row) return null;
  return { itemKey: itemKey(row.contentType, row.contentId), title: row.contentTitle ?? '' };
}
