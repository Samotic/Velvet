import { Schema, model, type Types, type Model } from 'mongoose';

import { CONTENT_TYPES, type ContentType } from './User';

/**
 * The notification kinds from the spec. `ai_picks` and `available` have no
 * `fromUserId` — they come from Velvet itself, and the UI shows the AI mark
 * instead of an avatar.
 */
export const NOTIFICATION_TYPES = [
  /**
   * @deprecated Split into `new_follower` and `follow_request` when private
   * accounts arrived — the two need different cards, and `follow` cannot say
   * which it is. Kept in the enum so pre-existing rows still load; nothing
   * creates it any more.
   */
  'follow',
  /** Someone followed you outright (their target — you — is public). */
  'new_follower',
  /** Someone asked to follow you (you are private). Carries Accept/Decline. */
  'follow_request',
  /** Your request was accepted. The requester's half of the loop. */
  'follow_accepted',
  'review_like',
  'review_reply',
  'message',
  'ai_picks',
  'available',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * How a `follow_request` card was resolved.
 *
 * Held on the notification rather than read from the edge, because the edge is
 * *deleted* on decline — and the row must still render "Declined" afterwards.
 * The spec is explicit that the row stays put: a row vanishing under the
 * user's finger is disorienting.
 */
export const ACTION_STATES = ['pending', 'accepted', 'declined'] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export interface INotification {
  /** The recipient. */
  userId: Types.ObjectId;
  type: NotificationType;
  /** Who triggered it. Null for system notifications. */
  fromUserId: Types.ObjectId | null;
  contentId: string | null;
  contentType: ContentType | null;
  contentTitle: string | null;
  read: boolean;
  /** The Follow edge this refers to, for resolving Accept / Decline. */
  followId: Types.ObjectId | null;
  /** `follow_request` only. Null on every other type. */
  actionState: ActionState | null;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    contentId: { type: String, default: null },
    contentType: { type: String, enum: CONTENT_TYPES, default: null },
    contentTitle: { type: String, default: null },
    read: { type: Boolean, default: false },
    followId: { type: Schema.Types.ObjectId, ref: 'Follow', default: null },
    actionState: { type: String, enum: ACTION_STATES, default: null },
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

/** The notification list and the unread badge. */
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

/** Cursor pagination: newest first for one recipient. */
notificationSchema.index({ userId: 1, createdAt: -1 });

/**
 * Dedupe. Sparse because only follow notifications carry a `followId`, and a
 * non-sparse unique index would collapse every null into one collision.
 * Re-following after an unfollow reuses the pair, so this keeps one row per
 * (recipient, type, edge) rather than accumulating a card per toggle.
 */
notificationSchema.index(
  { userId: 1, type: 1, followId: 1 },
  { unique: true, sparse: true },
);

export type NotificationModel = Model<INotification>;

export const Notification: NotificationModel = model<INotification>(
  'Notification',
  notificationSchema,
);
