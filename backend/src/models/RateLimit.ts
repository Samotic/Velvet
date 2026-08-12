import { Schema, model, type Model } from 'mongoose';

/**
 * A counter for one actor, one action, one time window.
 *
 * Keyed `{userId}:{action}:{windowStart}` — a fixed window rather than a
 * sliding one, because a fixed window is a single atomic `$inc` on an upserted
 * document, while a sliding window needs the timestamps of every recent action.
 * The trade-off is the usual one: a burst straddling a boundary can briefly
 * exceed the nominal rate. That is acceptable for follow spam, where the aim is
 * to stop a script doing thousands, not to police the exact 61st follow.
 *
 * Unlike the auth limiters (express-rate-limit, in-process memory) this is
 * keyed by **user id, not IP**, and lives in Mongo. Both matter: a follow is an
 * authenticated action, so IP keying would punish shared networks and be
 * sidestepped by a phone hotspot; and an in-memory counter resets on deploy and
 * is not shared across instances.
 */

export interface IRateLimit {
  key: string;
  count: number;
  /** TTL anchor. Mongo removes the document once this passes. */
  expiresAt: Date;
  createdAt: Date;
}

const rateLimitSchema = new Schema<IRateLimit>(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** Mongo's TTL monitor sweeps these, so nothing has to prune them. */
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimitModel = Model<IRateLimit>;

export const RateLimit: RateLimitModel = model<IRateLimit>('RateLimit', rateLimitSchema);
