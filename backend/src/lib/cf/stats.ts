import { Types } from 'mongoose';

import { Rating } from '../../models/Rating';
import { UserStats } from '../../models/UserStats';
import { CF_PARAMS, itemKey, type ItemKey, type RatingSource } from '../../types/cf';
import type { ContentType } from '../../models/User';

/**
 * The rating matrix's write path and the per-user summary that hangs off it.
 *
 * Everything that mutates a rating goes through `upsertRating`, so `userStats`
 * cannot drift from the rows it summarises. §5 requires the mean and std on
 * every rating write, and a second writer that forgot would silently poison
 * every similarity this user takes part in.
 */

export interface UpsertRatingInput {
  userId: string | Types.ObjectId;
  contentId: string;
  contentType: ContentType;
  value: number;
  source?: RatingSource;
  contentTitle?: string;
  poster?: string | null;
  runtimeMinutes?: number | null;
  genres?: string[];
  review?: string;
}

/**
 * Writes one cell of the matrix.
 *
 * **An implicit signal never overwrites an explicit rating.** Someone who rated
 * a film 2 and later added it to their watchlist still thinks it is a 2;
 * letting the 3.5 pseudo-rating win would replace a verdict with an inference.
 * The reverse is fine — an explicit rating always supersedes.
 */
export async function upsertRating(input: UpsertRatingInput): Promise<{ written: boolean }> {
  const source = input.source ?? 'explicit';
  const userId = new Types.ObjectId(String(input.userId));

  const existing = await Rating.findOne({
    userId,
    contentId: input.contentId,
    contentType: input.contentType,
  }).select('source');

  if (existing && source === 'implicit' && (existing.source ?? 'explicit') === 'explicit') {
    return { written: false };
  }

  const set: Record<string, unknown> = { rating: input.value, source };
  // Only overwrite denormalised display fields when the caller actually has
  // them; an implicit write from a dismiss button knows nothing about posters.
  if (input.contentTitle !== undefined) set.contentTitle = input.contentTitle;
  if (input.poster !== undefined) set.poster = input.poster;
  if (input.runtimeMinutes !== undefined) set.runtimeMinutes = input.runtimeMinutes;
  if (input.genres !== undefined) set.genres = input.genres;
  if (input.review !== undefined) set.review = input.review;

  await Rating.updateOne(
    { userId, contentId: input.contentId, contentType: input.contentType },
    { $set: set },
    { upsert: true },
  );

  await recomputeUserStats(userId);
  return { written: true };
}

/**
 * Recomputes one user's row summary from their ratings.
 *
 * Population std, not sample: these are all of the user's ratings, not a sample
 * drawn from a larger set, so dividing by n is the correct denominator.
 */
export async function recomputeUserStats(userId: string | Types.ObjectId): Promise<void> {
  const id = new Types.ObjectId(String(userId));

  const rows = await Rating.find({ userId: id })
    .select('contentId contentType rating')
    .sort({ updatedAt: -1 })
    .limit(CF_PARAMS.maxRatedKeys)
    .lean();

  if (!rows.length) {
    await UserStats.updateOne(
      { userId: id },
      {
        $set: {
          meanRating: 0,
          stdRating: 0,
          ratingCount: 0,
          ratedKeys: [],
          mediaTypeMix: { movie: 0, series: 0, game: 0 },
        },
      },
      { upsert: true },
    );
    return;
  }

  const n = rows.length;
  const mean = rows.reduce((s, r) => s + r.rating, 0) / n;
  const variance = rows.reduce((s, r) => s + (r.rating - mean) ** 2, 0) / n;

  const mix = { movie: 0, series: 0, game: 0 };
  const ratedKeys: ItemKey[] = [];
  for (const r of rows) {
    mix[r.contentType] += 1;
    ratedKeys.push(itemKey(r.contentType, r.contentId));
  }

  await UserStats.updateOne(
    { userId: id },
    {
      $set: {
        meanRating: mean,
        stdRating: Math.sqrt(variance),
        ratingCount: n,
        ratedKeys,
        mediaTypeMix: mix,
      },
    },
    { upsert: true },
  );
}

/**
 * §5's normalisation.
 *
 * Mean-centring is always right; the z-score is only meaningful once the std
 * is estimated from enough ratings to be stable, hence the threshold. Below it
 * a couple of extreme ratings would produce a tiny std and blow every
 * deviation out of proportion.
 */
export function normalize(
  value: number,
  stats: { meanRating: number; stdRating: number; ratingCount: number },
): number {
  const centred = value - stats.meanRating;
  if (stats.ratingCount < CF_PARAMS.zScoreMinRatings) return centred;
  return centred / Math.max(stats.stdRating, CF_PARAMS.minStd);
}
