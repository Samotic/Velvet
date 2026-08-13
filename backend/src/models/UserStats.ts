import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * A cached summary of one user's row in the rating matrix.
 *
 * Recomputed on every rating write rather than derived at request time: the
 * mean and std are needed for *every* similarity computation this user takes
 * part in, so recomputing them per comparison would multiply one cheap
 * aggregation by the size of the neighbourhood.
 *
 * `ratedKeys` is the row's support — the set similarity is intersected
 * against, and the set candidate generation subtracts. Capped, because one
 * prolific account should not be able to grow a single document without bound.
 */

export interface IUserStats {
  userId: Types.ObjectId;
  /** Centre for mean-centring. The whole point of §5. */
  meanRating: number;
  /** Floored at 0.5 on read — a near-zero std would explode the z-score. */
  stdRating: number;
  ratingCount: number;
  /** `["movie:1315772", "game:1022", …]` */
  ratedKeys: string[];
  /** Drives the "Crossing over" rail: which type is this user's default. */
  mediaTypeMix: { movie: number; series: number; game: number };
  /** Watermark for the incremental neighbour recompute (+10 ratings). */
  ratingsAtLastNeighborRun: number;
  updatedAt: Date;
}

const userStatsSchema = new Schema<IUserStats>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    meanRating: { type: Number, default: 0 },
    stdRating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    ratedKeys: { type: [String], default: [] },
    mediaTypeMix: {
      movie: { type: Number, default: 0 },
      series: { type: Number, default: 0 },
      game: { type: Number, default: 0 },
    },
    ratingsAtLastNeighborRun: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export type UserStatsModel = Model<IUserStats>;

export const UserStats: UserStatsModel = model<IUserStats>('UserStats', userStatsSchema);
