import { Types } from 'mongoose';

import { Notification, type NotificationType } from '../models/Notification';
import type { ContentType } from '../models/User';
import { emitToUser } from '../lib/socket';

/**
 * Creates a notification and pushes it down the recipient's socket if they're
 * connected, so the navbar badge updates without a poll.
 *
 * Never throws: a notification failing must not fail the action that triggered
 * it (a follow should still succeed if the notify write does not).
 */
export async function notify(opts: {
  userId: Types.ObjectId | string;
  type: NotificationType;
  fromUserId?: Types.ObjectId | string | null;
  contentId?: string | null;
  contentType?: ContentType | null;
  contentTitle?: string | null;
}): Promise<void> {
  try {
    // Don't notify yourself — liking your own review shouldn't ping you.
    if (opts.fromUserId && String(opts.fromUserId) === String(opts.userId)) return;

    const doc = await Notification.create({
      userId: opts.userId,
      type: opts.type,
      fromUserId: opts.fromUserId ?? null,
      contentId: opts.contentId ?? null,
      contentType: opts.contentType ?? null,
      contentTitle: opts.contentTitle ?? null,
    });

    const populated = await doc.populate('fromUserId', 'username displayName profilePhoto');
    emitToUser(String(opts.userId), 'notification:new', populated.toJSON());
  } catch (err) {
    console.error('notify error:', err);
  }
}
