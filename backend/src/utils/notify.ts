import { Types } from 'mongoose';

import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { Notification, type NotificationType } from '../models/Notification';
import { User, type ContentType } from '../models/User';
import { emitToUser } from '../lib/socket';
import { notificationPayload } from './serialize';
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
  /**
   * The Message this is about. `type: 'message'` only. It is what lets a
   * retraction find this card again, and what lets the email step check the
   * message still stands before sending.
   */
  messageId?: Types.ObjectId | string | null;
  /** The message body, for the email preview. Only used by `type: 'message'`. */
  preview?: string | null;
}): Promise<void> {
  try {
    // Don't notify yourself — liking your own review shouldn't ping you.
    if (opts.fromUserId && String(opts.fromUserId) === String(opts.userId)) return;

    // A request card starts unresolved; every other type has no action to take.
    const actionState = opts.type === 'follow_request' ? 'pending' : null;

    /**
     * What counts as "the same notification", per type.
     *
     * This used to be one rule — dedupe on `followId` if there is one, else
     * insert — which quietly meant the three types that carry no `followId`
     * were deduped by the unique index instead, on `(userId, type)` alone.
     * One `message` card per user, ever. See the note on that index.
     *
     * Each type gets the key its own behaviour wants:
     *
     *  - **follow types** — the edge. A double-tapped Follow is one card.
     *    Deliberately does *not* dedupe across unfollow → re-follow: that
     *    cycle makes a new edge, and a second follow really is a second event.
     *
     *  - **message** — the sender. The card says "you have messages from X",
     *    not "here is message #14"; the thread is the record. Nothing in the
     *    UI collapses these (`aggregate.ts` groups follower types only), so
     *    without this a chatty friend becomes twenty cards.
     *
     *  - **review_like** — the liker and the review. Stops like/unlike/like
     *    stacking, while different likers still get their own rows, which is
     *    what any future "X and 4 others" needs.
     *
     *  - **review_reply** — nothing. Each reply is a distinct utterance with
     *    its own text, and collapsing two from one person silently loses one.
     *
     * `createdAt` is refreshed on every upsert, so a collapsed card surfaces
     * at the top rather than staying buried where it first landed.
     */
    const dedupeKey = (): Record<string, unknown> => {
      if (opts.followId) {
        return { userId: opts.userId, type: opts.type, followId: opts.followId };
      }
      if (opts.type === 'message' && opts.fromUserId) {
        return { userId: opts.userId, type: 'message', fromUserId: opts.fromUserId };
      }
      if (opts.type === 'review_like' && opts.fromUserId && opts.contentId) {
        return {
          userId: opts.userId,
          type: 'review_like',
          fromUserId: opts.fromUserId,
          contentId: opts.contentId,
        };
      }
      // No dedupe: a filter that cannot match forces an insert.
      return { _id: new Types.ObjectId() };
    };

    const doc = await Notification.findOneAndUpdate(
      dedupeKey(),
      {
        $set: {
          userId: opts.userId,
          type: opts.type,
          fromUserId: opts.fromUserId ?? null,
          contentId: opts.contentId ?? null,
          contentType: opts.contentType ?? null,
          contentTitle: opts.contentTitle ?? null,
          followId: opts.followId ?? null,
          messageId: opts.messageId ?? null,
          actionState,
          read: false,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    /**
     * Recomputed, not incremented.
     *
     * `$inc: 1` was right when every notify inserted a row. It is wrong now
     * that several types collapse into an existing card: twenty messages from
     * one person are one card, and would have been twenty on the badge — a
     * number pointing at a list that does not contain it.
     *
     * Counting is correct by construction rather than by bookkeeping, and it
     * is what `readOne` in the notification controller already does. One
     * indexed count against `(userId, read)` on a path that runs per
     * notification, not per request.
     */
    const unread = await Notification.countDocuments({ userId: opts.userId, read: false });
    await User.updateOne({ _id: opts.userId }, { $set: { unreadNotificationCount: unread } });

    // toObject(), not toJSON(): the User transform renames `_id` to `id` on the
    // populated actor, and the serializer reads `_id`.
    const populated = await doc.populate('fromUserId', 'username displayName profilePhoto');
    emitToUser(String(opts.userId), 'notification:new', notificationPayload(populated.toObject()));

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
  messageId?: Types.ObjectId | string | null;
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

    /**
     * Last look before the mail goes out.
     *
     * There is no queue to cancel a job in, so a message retracted seconds
     * after it was sent is caught here instead: re-read the row and stop if it
     * has become a tombstone. It narrows the window rather than closing it —
     * a delete landing after this check but before Resend accepts the payload
     * still mails — which is why the retraction also removes the in-app card
     * rather than relying on this alone.
     */
    if (opts.type === 'message' && opts.messageId) {
      const still = await Message.findById(opts.messageId).select('deletedForEveryone').lean();
      if (!still || still.deletedForEveryone) return;
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

/**
 * Gives back one unread from a thread's per-reader counter.
 *
 * Exported because **both** delete paths need it and they need it to behave
 * identically. A retraction goes through `retractMessage` below; a
 * delete-for-me calls this directly, because hiding an unread message must
 * also stop it counting — the badge query already filters `deletedFor`, so
 * skipping this leaves `Conversation.unread` claiming a message the navbar
 * has already stopped counting, and the inbox row shows a badge that opens
 * onto nothing.
 *
 * The `$gt: 0` guard is the whole reason this is one function rather than two
 * call sites: it is what makes a repeat harmless.
 */
export async function releaseThreadUnread(
  conversationId: Types.ObjectId,
  receiverId: Types.ObjectId | string,
  wasUnread: boolean,
): Promise<void> {
  if (!wasUnread) return;
  const key = `unread.${String(receiverId)}`;
  await Conversation.updateOne(
    { _id: conversationId, [key]: { $gt: 0 } },
    { $inc: { [key]: -1 } },
  );
}

/**
 * Undoes everything a message caused, for when that message is retracted.
 *
 * **Both** unread counters are released from here, together, on purpose. A
 * retracted message has to give back two separate denormalized counts — the
 * thread's `Conversation.unread.<recipient>` and the badge's
 * `User.unreadNotificationCount` — and they are decremented under the same
 * condition by the same event. Split across two modules they would be two
 * things to remember on the next change to this path; here, forgetting one is
 * not possible. Both take the `$gt: 0` guard so a repeated retraction can
 * never drive either negative.
 *
 * Never throws, for the same reason `notify` does not: cleanup failing must
 * not fail the retraction that triggered it.
 */
export async function retractMessage(msg: {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  receiverId: Types.ObjectId;
  /** Whether the message was unread **before** it was retracted. */
  wasUnread: boolean;
}): Promise<void> {
  try {
    // 1. The thread's own counter, through the shared helper — delete-for-me
    //    calls the same one, so the two paths cannot decrement differently.
    await releaseThreadUnread(msg.conversationId, msg.receiverId, msg.wasUnread);

    // 2. The card it raised, and the navbar badge that mirrors it.
    const row = await Notification.findOneAndDelete({
      messageId: msg._id,
      type: 'message',
    }).lean();
    if (!row) return;

    if (!row.read) {
      await User.updateOne(
        { _id: row.userId, unreadNotificationCount: { $gt: 0 } },
        { $inc: { unreadNotificationCount: -1 } },
      );
    }

    emitToUser(String(row.userId), 'notification:removed', { id: String(row._id) });
  } catch (err) {
    console.error('retractMessage error:', err);
  }
}
