import { Types } from 'mongoose';

import { Rating } from '../models/Rating';
import type { ContentType } from '../models/User';

/**
 * Watch statistics derived from a user's ratings. There is no separate "watched"
 * record in the schema — rating something is what marks it watched — so every
 * figure here comes from the Rating collection.
 *
 * Ratings saved without runtime or genre data simply don't contribute to
 * `hours` or `topGenre`; the counts stay honest rather than extrapolating.
 */
export interface UserStats {
  films: number;
  filmsThisYear: number;
  hours: number;
  topGenre: string | null;
  /** Share of tagged titles carrying `topGenre`, 0-100. */
  topGenreShare: number;
  /** Every genre with a count, highest first — drives the mini bar chart. */
  genreBreakdown: { genre: string; count: number }[];
  avgRating: number | null;
  /** Consecutive days up to today with at least one rating. */
  streak: number;
}

export async function userStats(userId: string | Types.ObjectId): Promise<UserStats> {
  const rows = await Rating.find({ userId })
    .select('rating runtimeMinutes genres createdAt')
    .lean();

  if (!rows.length) {
    return {
      films: 0,
      filmsThisYear: 0,
      hours: 0,
      topGenre: null,
      topGenreShare: 0,
      genreBreakdown: [],
      avgRating: null,
      streak: 0,
    };
  }

  const thisYear = new Date().getUTCFullYear();
  let minutes = 0;
  let filmsThisYear = 0;
  let ratingSum = 0;
  let genreTagged = 0;
  const genreCounts = new Map<string, number>();
  const ratedDays = new Set<string>();

  for (const r of rows) {
    ratingSum += r.rating;
    minutes += r.runtimeMinutes ?? 0;

    const created = new Date(r.createdAt);
    if (created.getUTCFullYear() === thisYear) filmsThisYear += 1;
    ratedDays.add(created.toISOString().slice(0, 10));

    if (r.genres?.length) {
      genreTagged += 1;
      for (const g of r.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
  }

  const genreBreakdown = [...genreCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count);

  const top = genreBreakdown[0] ?? null;

  return {
    films: rows.length,
    filmsThisYear,
    hours: Math.round(minutes / 60),
    topGenre: top?.genre ?? null,
    topGenreShare: top && genreTagged ? Math.round((top.count / genreTagged) * 100) : 0,
    genreBreakdown: genreBreakdown.slice(0, 8),
    avgRating: Math.round((ratingSum / rows.length) * 10) / 10,
    streak: streakFrom(ratedDays),
  };
}

/**
 * Counts back from today while each day has a rating. A streak that ended
 * yesterday still counts — someone who rated last night at 23:00 and hasn't
 * opened the app yet today hasn't broken anything, so the walk is allowed to
 * start at either today or yesterday.
 */
function streakFrom(days: Set<string>): number {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  let cursor: Date;
  if (days.has(key(today))) cursor = today;
  else if (days.has(key(yesterday))) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (days.has(key(cursor))) {
    streak += 1;
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/** The five highest-rated titles, for the AI's taste profile. */
export async function topRatedTitles(
  userId: string | Types.ObjectId,
  limit = 5,
): Promise<string[]> {
  const rows = await Rating.find({ userId })
    .sort({ rating: -1, createdAt: -1 })
    .limit(limit)
    .select('contentTitle')
    .lean();
  return rows.map((r) => r.contentTitle).filter(Boolean);
}

/** The most recent titles, for the AI's taste profile. */
export async function recentTitles(
  userId: string | Types.ObjectId,
  limit = 10,
): Promise<string[]> {
  const rows = await Rating.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('contentTitle')
    .lean();
  return rows.map((r) => r.contentTitle).filter(Boolean);
}

/* ------------------------- signals for the advisor ------------------------ */

/**
 * A rated title with its score attached.
 *
 * The advisor was being handed bare titles, which loses the thing that makes
 * them useful: "their top rated" means something very different when the top
 * score is a 5 than when it is a 3. One line each, cheap to interpolate.
 */
export interface ScoredTitle {
  title: string;
  rating: number;
  type: ContentType;
}

const scored = (rows: { contentTitle: string; rating: number; contentType: ContentType }[]) =>
  rows
    .filter((r) => Boolean(r.contentTitle))
    .map((r) => ({ title: r.contentTitle, rating: r.rating, type: r.contentType }));

/** Their best, with scores — the positive half of the signal. */
export async function lovedTitles(
  userId: string | Types.ObjectId,
  limit = 8,
): Promise<ScoredTitle[]> {
  const rows = await Rating.find({ userId, rating: { $gte: 4 } })
    .sort({ rating: -1, createdAt: -1 })
    .limit(limit)
    .select('contentTitle rating contentType')
    .lean();
  return scored(rows);
}

/**
 * What they disliked — the half the advisor never had.
 *
 * Knowing what someone walked away from is at least as informative as knowing
 * what they loved: it rules out a whole lane rather than nudging toward one.
 * Without it the model can only ever argue from enthusiasm, and will happily
 * recommend the exact thing this person already told us they hated.
 */
export async function dislikedTitles(
  userId: string | Types.ObjectId,
  limit = 6,
): Promise<ScoredTitle[]> {
  const rows = await Rating.find({ userId, rating: { $lte: 2 } })
    .sort({ rating: 1, createdAt: -1 })
    .limit(limit)
    .select('contentTitle rating contentType')
    .lean();
  return scored(rows);
}

/**
 * How their attention is actually split across the three catalogues.
 *
 * The advisor covers films, series and games, but the profile only ever said
 * "films watched" — so someone who rates nothing but games was being given
 * film recommendations with no signal that they were off target.
 */
export async function typeMix(
  userId: string | Types.ObjectId,
): Promise<{ movie: number; series: number; game: number }> {
  const rows = await Rating.find({ userId }).select('contentType').lean();
  const mix = { movie: 0, series: 0, game: 0 };
  for (const r of rows) {
    if (r.contentType in mix) mix[r.contentType as keyof typeof mix] += 1;
  }
  return mix;
}
