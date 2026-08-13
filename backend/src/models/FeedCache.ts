import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * A built feed, cached for 6h.
 *
 * §16 asks for p95 < 400ms warm. Candidate generation touches every
 * neighbour's ratings; that is fast enough to do occasionally and far too slow
 * to do on every home-screen render.
 *
 * `strategy` is stored, not just returned — when someone reports a
 * disappointing feed, the first question is which rung of the ladder produced
 * it, and reconstructing that after the fact is guesswork.
 */

export interface IFeedCache {
  userId: Types.ObjectId;
  rails: unknown[];
  strategy: 'cf' | 'hybrid' | 'seeded' | 'cold';
  builtAt: Date;
  expiresAt: Date;
}

const feedCacheSchema = new Schema<IFeedCache>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  rails: { type: [Schema.Types.Mixed], default: [] },
  strategy: { type: String, required: true },
  builtAt: { type: Date, default: () => new Date() },
  expiresAt: { type: Date, required: true },
});

/** Mongo's TTL monitor drops stale feeds; nothing has to prune them. */
feedCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type FeedCacheModel = Model<IFeedCache>;

export const FeedCache: FeedCacheModel = model<IFeedCache>('FeedCache', feedCacheSchema);
