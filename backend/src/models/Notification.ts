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
  /**
   * Someone asked to clear your conversation with them, for both of you. The
   * card links to the thread and carries no Accept of its own: accepting is
   * an irreversible wipe, and the thread is where its confirm step lives.
   * Withdrawn as soon as the request is answered or cancelled.
   */
  'clear_request',
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
  /**
   * The Message this refers to. `message` type only, null on every other.
   *
   * Exists so a retraction can find and remove the card it raised: without it
   * the only handles are the sender and a timestamp, and deleting "the newest
   * message notification from this person" would take down the wrong card
   * whenever two messages arrived close together.
   */
  messageId: Types.ObjectId | null;
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
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
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

/** Sparse: only `message` rows carry one. Used to retract a card on delete. */
notificationSchema.index({ messageId: 1 }, { sparse: true });

/**
 * Dedupe for the follow types, and **only** the follow types.
 *
 * One row per (recipient, type, edge): re-following after an unfollow reuses
 * the pair, so this keeps one card rather than accumulating one per toggle.
 *
 * ── Why `partialFilterExpression` and not `sparse` ──
 * This index was `sparse`, on the reasoning that "only follow notifications
 * carry a followId, so the rest are skipped". That reasoning is wrong, and it
 * is wrong in a way that is easy to keep believing: in a **compound** index,
 * sparse skips a document only when **every** indexed field is missing.
 * `userId` and `type` are always present, so every notification was indexed —
 * including all the ones whose `followId` is null.
 *
 * The effect was that each user could hold exactly one `message`, one
 * `review_like` and one `review_reply` notification, ever. Every later one hit
 * a duplicate key, `notify` swallowed it, and the card was silently never
 * created.
 *
 * A partial filter says what sparse was mistakenly believed to say: index this
 * row only when `followId` is a real ObjectId. The follow dedupe is unchanged;
 * everything else drops out of the index entirely and is deduped by its own
 * upsert key in `notify` instead.
 *
 * ── Changing this requires a migration ──
 * MongoDB refuses to redefine an index with the same keys and different
 * options — `IndexKeySpecsConflict` — so `autoIndex` cannot swap it and fails
 * quietly, leaving the schema and the database disagreeing. See
 * `scripts/migrate-notification-index.ts`, and `autoIndex` is off in
 * production for exactly this reason.
 */
notificationSchema.index(
  { userId: 1, type: 1, followId: 1 },
  { unique: true, partialFilterExpression: { followId: { $type: 'objectId' } } },
);

export type NotificationModel = Model<INotification>;

export const Notification: NotificationModel = model<INotification>(
  'Notification',
  notificationSchema,
);
