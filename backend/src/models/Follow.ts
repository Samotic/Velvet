import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * One directed follow edge.
 *
 * Follows are **asymmetric**: A→B says nothing about B→A. "Mutual" is derived
 * by looking for both edges, never stored — a stored mutual flag is two writes
 * that can disagree.
 *
 * ── Why a collection and not the arrays it replaces ──
 * Velvet stored follows as `followers` / `following` arrays on the user. An
 * array can hold a member but not a *state*, and this system needs `pending`
 * for private accounts. It also grows the user document unboundedly, so a
 * popular account's profile read drags its whole follower list along.
 *
 * A **declined** request is deleted rather than kept as a status. Keeping it
 * would silently make the decline permanent, and re-requesting later is
 * legitimate. Stopping someone permanently is what blocking is for.
 */

export const FOLLOW_STATUSES = ['pending', 'accepted'] as const;
export type FollowStatus = (typeof FOLLOW_STATUSES)[number];

export interface IFollow {
  /** Who pressed Follow. */
  followerId: Types.ObjectId;
  /** Who is being followed. */
  followingId: Types.ObjectId;
  status: FollowStatus;
  createdAt: Date;
  respondedAt?: Date | null;
}

const followSchema = new Schema<IFollow>(
  {
    followerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    followingId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: FOLLOW_STATUSES, required: true },
    respondedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/**
 * The idempotency guarantee. A double-tapped Follow races two inserts; this
 * index rejects the loser with code 11000, which the controller catches and
 * turns into "you already follow them" rather than an error. Without it the
 * same pair could hold two edges and every count would be wrong.
 */
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

/** "Who follows me" and the pending-request list. */
followSchema.index({ followingId: 1, status: 1, createdAt: -1 });

/** "Who I follow". */
followSchema.index({ followerId: 1, status: 1, createdAt: -1 });

export type FollowModel = Model<IFollow>;

export const Follow: FollowModel = model<IFollow>('Follow', followSchema);
