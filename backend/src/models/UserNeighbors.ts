import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * One user's precomputed neighbourhood.
 *
 * Similarity against every other user at request time is O(N·M) — fine at 50
 * users, fatal at 50,000, and §16 asks for a p95 under 400ms. So the matrix is
 * walked offline and only the top slice is kept.
 *
 * Stored top 80, but predictions use the top K=40. The surplus is headroom:
 * once the viewer's own ratings grow, some stored neighbours drop below the
 * floor, and having 80 on hand means the job doesn't have to re-run for the
 * neighbourhood to stay full.
 *
 * §14: these ids never leave the server. This document is read to compute a
 * prediction and is never serialised into an API response.
 */

export interface INeighborEntry {
  userId: Types.ObjectId;
  /** Significance-weighted. What ranking uses. */
  sim: number;
  /** Pre-shrink, kept so the evaluation harness can see what the shrink did. */
  rawSim: number;
  coRated: number;
}

export interface IUserNeighbors {
  userId: Types.ObjectId;
  neighbors: INeighborEntry[];
  computedAt: Date;
}

const neighborEntrySchema = new Schema<INeighborEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sim: { type: Number, required: true },
    rawSim: { type: Number, required: true },
    coRated: { type: Number, required: true },
  },
  { _id: false },
);

const userNeighborsSchema = new Schema<IUserNeighbors>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  neighbors: { type: [neighborEntrySchema], default: [] },
  computedAt: { type: Date, default: () => new Date() },
});

export type UserNeighborsModel = Model<IUserNeighbors>;

export const UserNeighbors: UserNeighborsModel = model<IUserNeighbors>(
  'UserNeighbors',
  userNeighborsSchema,
);
