import { Schema, model, type Types, type Model } from 'mongoose';

import { CONTENT_TYPES, type ContentType } from './User';

/**
 * The notification kinds from the spec. `ai_picks` and `available` have no
 * `fromUserId` — they come from Velvet itself, and the UI shows the AI mark
 * instead of an avatar.
 */
export const NOTIFICATION_TYPES = [
  'follow',
  'review_like',
  'review_reply',
  'message',
  'ai_picks',
  'available',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

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

export type NotificationModel = Model<INotification>;

export const Notification: NotificationModel = model<INotification>(
  'Notification',
  notificationSchema,
);
