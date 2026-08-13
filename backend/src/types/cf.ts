import type { Types } from 'mongoose';

import type { ContentType } from '../models/User';

/**
 * Collaborative-filtering types and tunables.
 *
 * ── The one rule that shapes everything here ──
 * The rating matrix is **not** split by media type. A neighbour discovered
 * through a game can legitimately surface a film, and that cross-media space
 * is the whole reason Velvet's matrix is worth more than Letterboxd's. Any
 * function in `lib/cf` that filters by `mediaType` before computing similarity
 * is a bug.
 */

/**
 * The matrix's column key: `"movie:1315772"`, `"game:1022"`.
 *
 * Derived rather than stored. Velvet already keys ratings on the
 * `(contentType, contentId)` pair — `contentId` is a string precisely because
 * TMDB and IGDB ids collide by accident — so a separate `itemKey` column would
 * be a second source of truth that can drift from the first.
 */
export type ItemKey = string;

export const itemKey = (type: ContentType, id: string): ItemKey => `${type}:${id}`;

/** Inverse of `itemKey`. Returns null rather than throwing on malformed input. */
export function parseItemKey(key: ItemKey): { type: ContentType; id: string } | null {
  const at = key.indexOf(':');
  if (at < 1) return null;
  const type = key.slice(0, at);
  const id = key.slice(at + 1);
  if (!id) return null;
  if (type !== 'movie' && type !== 'series' && type !== 'game') return null;
  return { type, id };
}

/**
 * Reads a tunable from the environment, falling back to the shipped default.
 *
 * Exists so `scripts/evaluateCF.ts` can sweep a parameter without editing
 * source — §15 requires these be tuned against the harness, and a tuning loop
 * that needs a code change per run does not get used.
 */
const tune = (name: string, fallback: number): number => {
  const raw = process.env[`CF_${name}`];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Every tunable in one place, because §15 requires these be tuned against the
 * evaluation harness rather than by intuition — and a constant buried in a
 * function is a constant nobody tunes.
 */
export const CF_PARAMS = {
  /**
   * Significance weighting. The single most important number here: a
   * correlation of 0.98 from 2 co-rated items is noise, from 40 it is signal.
   * Shrinks similarity toward zero when overlap is thin.
   *
   * Spec says 12, and says to tune down to 6 while the user base is small.
   * Velvet currently has **zero** co-rated pairs, so 6 is the honest setting —
   * at 12 nothing would ever clear the floor. Raise it as the matrix fills.
   */
  beta: tune('BETA', 6),
  /** Neighbourhood size for prediction. */
  K: tune('K', 40),
  /** Stored per user; the top-K is selected from these. */
  maxStoredNeighbors: 80,
  /** Below this a "neighbour" is indistinguishable from a stranger. */
  minSim: tune('MIN_SIM', 0.1),
  /** Fewer co-rated items than this and the correlation means nothing. */
  minCoRated: tune('MIN_CO_RATED', 3),
  /** Predictions need at least this many neighbours who actually rated the item. */
  minNeighborsPerItem: tune('MIN_NEIGHBORS_PER_ITEM', 3),
  /** Confidence damping: conf = Σsim / (Σsim + lambda). */
  lambda: tune('LAMBDA', 3.0),
  /** No single neighbour may exceed this share of the similarity mass. */
  maxNeighborInfluence: 0.08,
  /** Weak tiebreaker only. If it dominates, the feed has collapsed to trending. */
  popularityWeight: tune('POPULARITY_WEIGHT', 0.15),
  /** Implicit rows count for less than a deliberate rating. */
  implicitWeight: 0.6,
  explicitWeight: 1.0,
  /** z-score normalisation only once the std is meaningful. */
  zScoreMinRatings: 20,
  /** Guards against dividing by a near-zero std. */
  minStd: 0.5,
  /** Tier thresholds for the fallback ladder. */
  cfMinNeighbors: 8,
  cfMinItems: 24,
  /** Pool cap before diversification. */
  maxCandidates: 400,
  /** Row support cap, so one prolific account can't bloat its stats doc. */
  maxRatedKeys: 5000,
} as const;

/** How a rating entered the matrix. Implicit rows are down-weighted, never
 *  allowed to overwrite an explicit verdict. */
export type RatingSource = 'explicit' | 'implicit';

/** §4's pseudo-ratings. A detail view is deliberately absent — too weak a
 *  signal, and it would add noise to every similarity it touched. */
export const IMPLICIT_VALUES = {
  completed: 3.8,
  watchlist: 3.5,
  dismissed: 1.5,
} as const;

export interface UserStatsDoc {
  userId: Types.ObjectId;
  meanRating: number;
  stdRating: number;
  ratingCount: number;
  ratedKeys: ItemKey[];
  mediaTypeMix: { movie: number; series: number; game: number };
  updatedAt: Date;
}

export interface NeighborEntry {
  userId: Types.ObjectId;
  /** Significance-weighted; this is what ranking uses. */
  sim: number;
  /** Pre-shrink, kept for the evaluation harness to inspect. */
  rawSim: number;
  /** |I_uv| — the co-rated count the shrink was computed from. */
  coRated: number;
}

/** Which rung of §11's ladder produced a feed. Recorded so a disappointing
 *  feed can be explained rather than guessed at. */
export type FeedStrategy = 'cf' | 'hybrid' | 'seeded' | 'cold';

export type RailKind =
  | 'taste_twin'
  | 'neighborhood'
  | 'co_occurrence'
  | 'genre'
  | 'watchlist'
  | 'popular';
