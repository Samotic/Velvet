import type { Request, Response } from 'express';
import { Types } from 'mongoose';

import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import { emitToUser } from '../lib/socket';
import { fail, ok } from '../utils/http';
import { notify } from '../utils/notify';
import { publicProfile, userRef } from '../utils/serialize';
import { isObjectId, str } from '../utils/validation';

/**
 * Text-only direct messaging. No media, no calls.
 *
 * Sends persist first and broadcast second: a socket push is best-effort, so
 * the durable write must not depend on it.
 */

const AUTHOR = 'username displayName profilePhoto';

/**
 * Finds or creates the thread between two people.
 *
 * `participants` is stored sorted by id string so the pair is a stable key and
 * the unique index actually prevents duplicate threads — without the sort,
 * [a,b] and [b,a] would be two different documents for one conversation.
 */
async function conversationFor(a: string, b: string) {
  const pair = [a, b].sort().map((id) => new Types.ObjectId(id));

  const existing = await Conversation.findOne({ participants: pair });
  if (existing) return existing;

  try {
    return await Conversation.create({ participants: pair, unread: new Map<string, number>() });
  } catch (err) {
    // Two simultaneous first messages can both miss the find; the unique index
    // rejects the loser, which then reads the winner's document.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const raced = await Conversation.findOne({ participants: pair });
      if (raced) return raced;
    }
    throw err;
  }
}

/* -------------------------------- inbox ---------------------------------- */

/** GET /api/messages/conversations */
export async function conversations(req: Request, res: Response): Promise<Response> {
  try {
    const me = req.user!.userId;

    const rows = await Conversation.find({ participants: me })
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .populate('participants', AUTHOR);

    const out = rows
      .map((c) => {
        // The "other" participant — the one that isn't the caller.
        const other = (c.participants as unknown[]).find((p) => {
          const ref = userRef(p);
          return ref && ref.id !== me;
        });
        const user = userRef(other);
        // A thread with a deleted account has nobody to show; drop the row
        // rather than rendering a nameless conversation.
        if (!user) return null;

        return {
          id: String(c._id),
          user,
          lastMessage: c.lastMessage ?? '',
          lastMessageAt: c.lastMessageAt,
          lastFromMe: c.lastSenderId ? String(c.lastSenderId) === me : false,
          unread: c.unread?.get(me) ?? 0,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return ok(res, { conversations: out });
  } catch (err) {
    console.error('conversations error:', err);
    return fail(res, 'Could not load your conversations', 500);
  }
}

/** GET /api/messages/unread-count — drives the navbar badge. */
export async function unreadCount(req: Request, res: Response): Promise<Response> {
  try {
    const unread = await Message.countDocuments({ receiverId: req.user!.userId, read: false });
    return ok(res, { unread });
  } catch (err) {
    console.error('unreadCount error:', err);
    return fail(res, 'Could not load your unread count', 500);
  }
}

/* -------------------------------- thread --------------------------------- */

/** GET /api/messages/:userId — one thread, oldest first, plus the other person. */
export async function thread(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const me = req.user!.userId;

    const other = await User.findById(otherId).lean();
    if (!other) return fail(res, 'User not found', 404);

    const convo = await Conversation.findOne({
      participants: [me, otherId].sort().map((id) => new Types.ObjectId(id)),
    }).select('_id');

    const messages = convo
      ? await Message.find({ conversationId: convo._id }).sort({ createdAt: 1 }).limit(500)
      : [];

    const filmCount = await Rating.countDocuments({ userId: other._id });

    return ok(res, {
      messages: messages.map((m) => m.toJSON()),
      user: publicProfile(other, me, filmCount),
    });
  } catch (err) {
    console.error('thread error:', err);
    return fail(res, 'Could not load that conversation', 500);
  }
}

/** POST /api/messages/:userId/send */
export async function send(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const me = req.user!.userId;
    if (otherId === me) return fail(res, 'You cannot message yourself', 422);

    const text = str((req.body ?? {}).text).slice(0, 2000);
    if (!text) return fail(res, 'Write something first', 422);

    const other = await User.findById(otherId).select('_id');
    if (!other) return fail(res, 'User not found', 404);

    const convo = await conversationFor(me, otherId);

    const message = await Message.create({
      conversationId: convo._id,
      senderId: me,
      receiverId: otherId,
      text,
      read: false,
    });

    // The unread counter is per-reader, so only the recipient's goes up.
    await Conversation.updateOne(
      { _id: convo._id },
      {
        $set: { lastMessage: text, lastMessageAt: new Date(), lastSenderId: me },
        $inc: { [`unread.${otherId}`]: 1 },
      },
    );

    const payload = message.toJSON();

    // Push to the recipient, and to the sender's other tabs so a second window
    // shows the message it didn't send.
    emitToUser(otherId, 'message:new', payload);
    emitToUser(me, 'message:new', payload);

    await notify({ userId: otherId, type: 'message', fromUserId: me });

    return ok(res, { message: payload }, 201);
  } catch (err) {
    console.error('send message error:', err);
    return fail(res, 'Could not send that message', 500);
  }
}

/** PUT /api/messages/:userId/read — clears what they sent me. */
export async function markRead(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const me = req.user!.userId;

    await Message.updateMany(
      { senderId: otherId, receiverId: me, read: false },
      { $set: { read: true } },
    );

    const convo = await Conversation.findOne({
      participants: [me, otherId].sort().map((id) => new Types.ObjectId(id)),
    }).select('_id');

    if (convo) {
      await Conversation.updateOne({ _id: convo._id }, { $set: { [`unread.${me}`]: 0 } });
      // Lets the sender's open thread tick over to "read" without a poll.
      emitToUser(otherId, 'message:read', {
        conversationId: String(convo._id),
        readerId: me,
      });
    }

    return ok(res, { read: true });
  } catch (err) {
    console.error('markRead error:', err);
    return fail(res, 'Could not update that conversation', 500);
  }
}
