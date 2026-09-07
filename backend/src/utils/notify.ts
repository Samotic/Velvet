import { Types } from 'mongoose';

import { Notification, type NotificationType } from '../models/Notification';
import { User, type ContentType } from '../models/User';
import { emitToUser } from '../lib/socket';
import { sendNewFollowerEmail, sendNewMessageEmail } from '../services/email';

/**
 * Creates a notification and pushes it down the recipient's socket if they're
 * connected, so the navbar badge updates without a poll.
 *
 * Never throws: a notification failing must not fail the action that triggered
 * it (a follow should still succeed if the notify write does not).
 *
 * This is also where the two email notifications hang, because it is the one
 * funnel every follow and message already passes through — putting them in the
 * controllers instead would mean two places to keep in step.
 */
export async function notify(opts: {
  userId: Types.ObjectId | string;
  type: NotificationType;
  fromUserId?: Types.ObjectId | string | null;
  contentId?: string | null;
  contentType?: ContentType | null;
  contentTitle?: string | null;
  /** The Follow edge, for the three follow types. Also the dedupe key. */
  followId?: Types.ObjectId | string | null;
  /** The message body, for the email preview. Only used by `type: 'message'`. */
  preview?: string | null;
}): Promise<void> {
  try {
    // Don't notify yourself — liking your own review shouldn't ping you.
    if (opts.fromUserId && String(opts.fromUserId) === String(opts.userId)) return;

    // A request card starts unresolved; every other type has no action to take.
    const actionState = opts.type === 'follow_request' ? 'pending' : null;

    /**
     * Upsert rather than create, against the sparse unique
     * (userId, type, followId) index. This is what makes a double-tapped
     * Follow produce one card: both taps carry the same edge id.
     *
     * It deliberately does **not** dedupe across unfollow → re-follow. That
     * cycle deletes the edge and creates a new one with a new id, so the
     * target gets a second card — which is correct, since it is a second
     * follow event, and §7's aggregation is what collapses the noise.
     *
     * `createdAt` is refreshed so a re-followed card surfaces at the top
     * rather than staying buried at its original position.
     */
    const doc = await Notification.findOneAndUpdate(
      opts.followId
        ? { userId: opts.userId, type: opts.type, followId: opts.followId }
        : { _id: new Types.ObjectId() },
      {
        $set: {
          userId: opts.userId,
          type: opts.type,
          fromUserId: opts.fromUserId ?? null,
          contentId: opts.contentId ?? null,
          contentType: opts.contentType ?? null,
          contentTitle: opts.contentTitle ?? null,
          followId: opts.followId ?? null,
          actionState,
          read: false,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Counter mirrors the row. Kept here because this is the one funnel every
    // notification passes through, so it cannot fall out of step.
    await User.updateOne({ _id: opts.userId }, { $inc: { unreadNotificationCount: 1 } });

    const populated = await doc.populate('fromUserId', 'username displayName profilePhoto');
    emitToUser(String(opts.userId), 'notification:new', populated.toJSON());

    await maybeEmail(opts);
  } catch (err) {
    console.error('notify error:', err);
  }
}

/**
 * Sends the email counterpart, for the two types that have one.
 *
 * Two rules worth keeping:
 *  - Only verified addresses are emailed. An unconfirmed address might belong
 *    to someone who never signed up, and mailing it is how a sending domain
 *    earns a spam reputation.
 *  - Failures are swallowed. The in-app notification has already landed; email
 *    is the redundant copy, not the delivery mechanism.
 */
async function maybeEmail(opts: {
  userId: Types.ObjectId | string;
  type: NotificationType;
  fromUserId?: Types.ObjectId | string | null;
  preview?: string | null;
}): Promise<void> {
  // `new_follower` replaced `follow`; both map to the same email. A
  // `follow_request` deliberately gets none — it is a prompt to act, and
  // mailing it turns a pending decision into pressure.
  const emailable = opts.type === 'follow' || opts.type === 'new_follower' || opts.type === 'message';
  if (!emailable) return;
  if (!opts.fromUserId) return;

  try {
    const [recipient, sender] = await Promise.all([
      User.findById(opts.userId).select('email emailVerified').lean(),
      User.findById(opts.fromUserId).select('displayName username profilePhoto').lean(),
    ]);

    if (!recipient?.emailVerified || !sender) return;

    // Both follow types, not just the deprecated one. `emailable` above has
    // always admitted `new_follower`, but this branch only caught `follow` —
    // so every real new-follower notification fell through to the message
    // email below and told the recipient they had been sent a message.
    if (opts.type === 'follow' || opts.type === 'new_follower') {
      await sendNewFollowerEmail({
        to: recipient.email,
        followerName: sender.displayName,
        followerUsername: sender.username,
        followerPhoto: sender.profilePhoto,
      });
      return;
    }

    await sendNewMessageEmail({
      to: recipient.email,
      fromName: sender.displayName,
      fromUsername: sender.username,
      preview: opts.preview ?? 'They sent you a message on Velvet.',
    });
  } catch (err) {
    console.error('notify email error:', err);
  }
}
