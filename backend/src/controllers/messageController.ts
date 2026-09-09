import type { Request, Response } from 'express';
import { Types } from 'mongoose';

import { Conversation, type IConversationPreview } from '../models/Conversation';
import { EDIT_HISTORY_LIMIT, MESSAGE_KINDS, Message, type MessageKind } from '../models/Message';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import { emitToUser } from '../lib/socket';
import { fail, ok } from '../utils/http';
import { notify, releaseThreadUnread, retractMessage } from '../utils/notify';
import {
  DELETE_WINDOW_MS,
  EDIT_WINDOW_MS,
  MAX_MESSAGE_LENGTH,
} from '../config/messaging';
import { previewFor, recomputePreview } from '../services/conversationPreview';
import { receiptsActiveBetween } from '../services/visibility';
import {
  UploadNotConfiguredError,
  type UploadedMedia,
  destroyMedia,
  isValidAudioDataUrl,
  isValidImageDataUrl,
  uploadMessageAudio,
  uploadMessageImage,
} from '../services/cloudinary';
import { consume, refund, type LimitWindow } from '../services/rateLimit';
import { areMutual, relationBetween } from '../services/social';
import { publicProfile, userRef } from '../utils/serialize';
import { clean, isObjectId, str } from '../utils/validation';

/**
 * Direct messaging: text, photos and voice notes. Still no calls — Socket.io
 * here carries messages and typing state, never media streams.
 *
 * Sends persist first and broadcast second: a socket push is best-effort, so
 * the durable write must not depend on it.
 */

/**
 * Attachments are capped per user; text messages are not.
 *
 * The asymmetry is the point. A text message costs one document, while a photo
 * or a voice note costs an upload, storage and egress on a Cloudinary account
 * with no revenue behind it — the same reasoning that makes
 * `AI_FREE_DAILY_MESSAGES` load-bearing. Two windows, because one cannot
 * express both shapes of abuse: 20/minute stops a burst, 200/hour stops the
 * patient version that stays under it all day.
 */
const MEDIA_LIMITS: LimitWindow[] = [
  { limit: 20, seconds: 60 },
  { limit: 200, seconds: 60 * 60 },
];

const AUTHOR = 'username displayName profilePhoto';

/**
 * Messaging requires a **mutual** follow: I follow them and they follow me.
 * A one-way follow is not consent to be messaged, which is the whole point of
 * the rule — it means nobody can open a thread with a stranger.
 *
 * One query, not two. `follow` writes both sides (my `following`, their
 * `followers`), so my own document already holds both halves of the answer and
 * the pair of `$elemMatch`-style filters resolves on the indexed `_id`.
 *
 * This is the authority. The UI hides the entry points when it returns false,
 * but the check has to live here — a hidden button is not an access control.
 */
async function isMutual(me: string, other: string): Promise<boolean> {
  if (me === other) return false;
  // Delegates to the follow graph rather than reading the deprecated arrays.
  // Both edges must exist *and* be accepted — a pending request is not consent.
  return areMutual(me, other);
}

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

        /**
         * The preview is per-reader once a message can be hidden for one side
         * only. `lastFor` is the answer; the shared fields are the fallback for
         * rows written before it existed, which the migration backfills.
         */
        const mine = c.lastFor?.get(me);

        return {
          id: String(c._id),
          user,
          lastMessage: mine?.text ?? c.lastMessage ?? '',
          lastMessageAt: mine?.at ?? c.lastMessageAt,
          lastFromMe: String(mine?.senderId ?? c.lastSenderId ?? '') === me,
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
    const me = req.user!.userId;
    /**
     * A retracted message and one the reader hid must both stop counting.
     * Otherwise the badge advertises something there is nothing to open —
     * the exact drift the tombstone was supposed to avoid.
     */
    const unread = await Message.countDocuments({
      receiverId: me,
      read: false,
      deletedForEveryone: { $ne: true },
      ...Message.visibleTo(me),
    });
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
      ? await Message.find({ conversationId: convo._id, ...Message.visibleTo(me) })
          .sort({ createdAt: 1 })
          .limit(500)
      : [];

    const filmCount = await Rating.countDocuments({ userId: other._id });

    // History stays readable after a follow is withdrawn — only sending stops.
    // Deleting the view too would make an unfollow silently destroy the record
    // of a conversation both people had.
    const rel = await relationBetween(me, otherId);

    /**
     * The socket event is only half of a receipt. The other half is `read` on
     * the stored message, which a reload would hand over regardless.
     *
     * So the flag is stripped from **my own sent messages** when the pair is
     * not mutually opted in. Without this, turning receipts off would stop the
     * live tick and then leak the whole history the next time the thread was
     * opened — the setting would look like it worked and not work.
     *
     * Only outgoing messages are touched. On an incoming one `read` is *my*
     * unread state, which is mine to know and nothing to do with disclosure.
     */
    const receipts = await receiptsActiveBetween(me, otherId);

    return ok(res, {
      messages: messages.map((m) => {
        const json = m.toJSON() as Record<string, unknown>;
        if (!receipts && String(m.senderId) === me) json.read = false;
        return json;
      }),
      user: publicProfile(other, me, filmCount, rel),
      canMessage: rel.outgoing === 'accepted' && rel.incoming === 'accepted',
      /** Lets the client render nothing at all, rather than a greyed-out tick. */
      readReceipts: receipts,
    });
  } catch (err) {
    console.error('thread error:', err);
    return fail(res, 'Could not load that conversation', 500);
  }
}

/**
 * POST /api/messages/:userId/send
 *
 * Body is either `{ text }` or `{ kind: 'image' | 'audio', media: <data URL> }`.
 * A data URL rather than multipart for the same reason the avatar upload uses
 * one: no file-upload dependency on the server, and the payload is pattern-
 * checked before a byte is forwarded to Cloudinary.
 */
export async function send(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const me = req.user!.userId;
    if (otherId === me) return fail(res, 'You cannot message yourself', 422);

    const body = (req.body ?? {}) as Record<string, unknown>;
    // An unrecognised kind falls back to text rather than erroring, so an older
    // client that sends no `kind` at all keeps working unchanged.
    const kind: MessageKind = (MESSAGE_KINDS as readonly string[]).includes(String(body.kind))
      ? (body.kind as MessageKind)
      : 'text';

    /**
     * The media payload is deliberately NOT passed through `clean()`.
     *
     * `sanitizeText` strips `data:` as an active URI scheme — correct for prose,
     * fatal here, because it would empty out every upload before it was read.
     * Only the text branch is user-authored prose, so only it is sanitised.
     */
    const text = kind === 'text' ? clean(body.text, MAX_MESSAGE_LENGTH) : '';
    const media = body.media;

    // Everything is validated before any write, so a rejected send leaves no
    // conversation, no document and no uploaded asset behind.
    if (kind === 'text' && !text) return fail(res, 'Write something first', 422);
    if (kind === 'image' && !isValidImageDataUrl(media)) {
      return fail(res, 'Send a PNG, JPEG, WebP or GIF image under 5MB', 422);
    }
    if (kind === 'audio' && !isValidAudioDataUrl(media)) {
      return fail(res, 'That recording could not be read', 422);
    }

    const other = await User.findById(otherId).select('_id');
    if (!other) return fail(res, 'User not found', 404);

    // Checked before the conversation is created, so a blocked send leaves no
    // empty thread behind in either inbox — and before the upload, so a
    // non-mutual sender can never spend the operator's Cloudinary quota.
    if (!(await isMutual(me, otherId))) {
      return fail(res, 'NOT_MUTUAL: You can only message people who follow you back', 403);
    }

    let uploaded: UploadedMedia | null = null;
    if (kind !== 'text') {
      // The limit is consumed before the upload, not after: the point is to
      // bound what reaches Cloudinary, and a check that runs afterwards has
      // already paid for the request it was meant to prevent.
      const gate = await consume(me, 'message_media', MEDIA_LIMITS);
      if (!gate.ok) {
        return fail(
          res,
          `Too many attachments. Try again in ${gate.retryAfter}s.`,
          429,
        );
      }

      try {
        uploaded =
          kind === 'image'
            ? await uploadMessageImage(media as string)
            : await uploadMessageAudio(media as string);
      } catch (err) {
        // Uploads are optional infrastructure, so say so plainly rather than
        // reporting a 500 the sender can do nothing about.
        if (err instanceof UploadNotConfiguredError) {
          // Nothing reached Cloudinary and the sender did nothing wrong, so the
          // unit goes back. Without this, twenty honest 503s on a deployment
          // with no upload credentials turn the twenty-first into a 429 that
          // blames the sender for the server's missing configuration.
          await refund(me, 'message_media', MEDIA_LIMITS);
          return fail(res, err.message, 503);
        }
        throw err;
      }
    }

    const convo = await conversationFor(me, otherId);

    const message = await Message.create({
      conversationId: convo._id,
      senderId: me,
      receiverId: otherId,
      kind,
      text,
      mediaUrl: uploaded?.url ?? null,
      // Recorded so the asset can be destroyed if the message is retracted.
      // The uploaders still assign no id of their own — this is the one that
      // came back from Cloudinary.
      mediaPublicId: uploaded?.publicId ?? null,
      mediaResourceType: uploaded?.resourceType ?? null,
      mediaDuration: uploaded?.duration ?? null,
      mediaWidth: uploaded?.width ?? null,
      mediaHeight: uploaded?.height ?? null,
      read: false,
    });

    // A photo has no text, so the inbox and the email preview get a label
    // rather than the empty string the body would give them.
    const preview = previewFor(kind, text);

    // The unread counter is per-reader, so only the recipient's goes up.
    await Conversation.updateOne({ _id: convo._id }, { $inc: { [`unread.${otherId}`]: 1 } });

    /**
     * Previews go through the one helper the delete paths also use, so the
     * three writers of `lastFor` cannot disagree. The message is handed over
     * as `justSent`: it was created a line ago, so it is provably the newest
     * for both participants and the helper can skip its two lookups — this
     * stays as cheap as the single `$set` it replaced.
     */
    await recomputePreview(convo._id, [me, otherId], message);

    const payload = message.toJSON();

    // Push to the recipient, and to the sender's other tabs so a second window
    // shows the message it didn't send.
    emitToUser(otherId, 'message:new', payload);
    emitToUser(me, 'message:new', payload);

    // Deliberately not awaited. The recipient already has the message over the
    // socket above, and nothing in the response depends on this. Awaiting it put
    // four database round trips and a live Resend API call on the sender's
    // critical path, so every send waited on an email the sender never sees.
    // `notify` never throws — it swallows and logs its own failures — so there
    // is no rejection to strand here.
    void notify({
      userId: otherId,
      type: 'message',
      fromUserId: me,
      messageId: message._id,
      preview,
    });

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

      /**
       * The receipt is only sent when **both** sides are opted in.
       *
       * Decided here rather than in the client. A browser that chooses not to
       * render a receipt still received one, and anyone can open the network
       * tab — "off" has to mean the event was never sent, not that it was
       * ignored politely.
       *
       * Note the messages above are marked read regardless: `read` drives the
       * recipient's own unread badge, which is theirs and has nothing to do
       * with what the sender is told. What the setting gates is disclosure.
       */
      if (await receiptsActiveBetween(me, otherId)) {
        // Lets the sender's open thread tick over to "read" without a poll.
        emitToUser(otherId, 'message:read', {
          conversationId: String(convo._id),
          readerId: me,
        });
      }
    }

    return ok(res, { read: true });
  } catch (err) {
    console.error('markRead error:', err);
    return fail(res, 'Could not update that conversation', 500);
  }
}

/* --------------------------- edit and delete ------------------------------ */

/**
 * Pushes one event to each participant, carrying **their** inbox row.
 *
 * The preview is per-reader, so a single payload broadcast to both sides would
 * be wrong for at least one of them: the sender's row reads "You: …" off
 * `previewFromMe`, and a participant whose newest visible message was not the
 * one that changed should see no movement at all. Reusing what
 * `recomputePreview` just wrote is what keeps the socket and the database
 * saying the same thing — nothing here re-derives a preview of its own.
 */
function emitEach(
  participants: string[],
  event: string,
  previews: Record<string, IConversationPreview>,
  payload: Record<string, unknown>,
): void {
  for (const p of participants) {
    const mine = previews[p];
    emitToUser(p, event, {
      ...payload,
      preview: mine?.text ?? '',
      previewAt: mine?.at ?? null,
      previewFromMe: String(mine?.senderId ?? '') === p,
    });
  }
}

/**
 * PATCH /api/messages/:messageId — reword a message you sent.
 *
 * Text only, and only inside `EDIT_WINDOW_MS`. Media is not editable because
 * there is nothing to reword: replacing the asset would be a new message
 * wearing an old timestamp, which is the one thing an edit must not be able to
 * do — a reader who saw the original has no way to tell.
 */
export async function edit(req: Request, res: Response): Promise<Response> {
  try {
    const messageId = req.params.messageId;
    if (!isObjectId(messageId)) return fail(res, 'Message not found', 404);

    const me = req.user!.userId;
    const msg = await Message.findById(messageId);
    if (!msg) return fail(res, 'Message not found', 404);

    // Authorship first: someone who may not touch this message should not
    // learn from the error which of the later rules it happens to break.
    if (String(msg.senderId) !== me) return fail(res, 'You can only edit your own messages', 403);
    if (msg.deletedForEveryone) return fail(res, 'That message was deleted', 400);
    if (msg.kind !== 'text') return fail(res, 'Only text messages can be edited', 400);

    if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
      return fail(res, 'That message is too old to edit', 403);
    }

    const body = (req.body ?? {}) as { text?: unknown };
    // The same sanitiser and the same cap as a new message — one constant, so
    // an edit can never smuggle in a body a send would have rejected.
    const next = clean(body.text, MAX_MESSAGE_LENGTH).trim();

    // An empty edit is a mistake, not a shorthand for delete. Answering it with
    // a deletion would destroy content on an ambiguous gesture.
    if (!next) return fail(res, 'A message cannot be empty', 400);

    /**
     * Identical text is a no-op, and deliberately does not stamp `editedAt`:
     * an "edited" label that appears when nothing changed is a lie about the
     * message, and re-submitting the same text is a common accident.
     */
    if (next === msg.text) return ok(res, { message: msg.toJSON() });

    const editedAt = new Date();
    msg.editHistory = [...msg.editHistory, { text: msg.text, editedAt }].slice(
      -EDIT_HISTORY_LIMIT,
    );
    msg.text = next;
    msg.editedAt = editedAt;
    await msg.save();

    // The preview is per-reader, so this goes through the shared helper rather
    // than a targeted `$set` — it works out on its own whether this message is
    // still what either participant sees at the top of the inbox.
    const participants = [String(msg.senderId), String(msg.receiverId)];
    const previews = await recomputePreview(msg.conversationId, participants);

    // No conversation rooms exist — routing is per user — so "the conversation"
    // is addressed as both of its participants, and each is sent the preview
    // computed for them rather than one shared string.
    emitEach(participants, 'message:edited', previews, {
      messageId: String(msg._id),
      conversationId: String(msg.conversationId),
      text: msg.text,
      editedAt: msg.editedAt,
    });

    return ok(res, { message: msg.toJSON() });
  } catch (err) {
    console.error('edit message error:', err);
    return fail(res, 'Could not edit that message', 500);
  }
}

/**
 * DELETE /api/messages/:messageId — hide a message, or retract it.
 *
 * `scope` is required and has no default. The two outcomes are not variations
 * on each other: one changes what I see, the other destroys content for
 * somebody else. Guessing on the caller's behalf is how a tidy-up becomes a
 * retraction, so a missing scope is a 400 rather than a lenient fallback.
 */
export async function remove(req: Request, res: Response): Promise<Response> {
  try {
    const messageId = req.params.messageId;
    if (!isObjectId(messageId)) return fail(res, 'Message not found', 404);

    const raw = (req.body as { scope?: unknown } | undefined)?.scope ?? req.query.scope;
    const scope = typeof raw === 'string' ? raw : '';
    if (scope !== 'me' && scope !== 'everyone') {
      return fail(res, "A delete needs scope: 'me' or 'everyone'", 400);
    }

    const me = req.user!.userId;
    const msg = await Message.findById(messageId);
    if (!msg) return fail(res, 'Message not found', 404);

    const isSender = String(msg.senderId) === me;
    const isReceiver = String(msg.receiverId) === me;
    if (!isSender && !isReceiver) return fail(res, 'Message not found', 404);

    const participants = [String(msg.senderId), String(msg.receiverId)];

    if (scope === 'me') {
      /**
       * Idempotent by construction: `$addToSet` on a second tap is a no-op and
       * still answers success, because ending up in the state you asked for is
       * what the user meant.
       */
      const alreadyHidden = msg.deletedFor.some((id) => String(id) === me);
      await Message.updateOne({ _id: msg._id }, { $addToSet: { deletedFor: new Types.ObjectId(me) } });

      /**
       * Hiding an unread message must also stop it counting. The badge query
       * already filters `deletedFor`, so without this the thread's counter
       * keeps claiming a message the navbar has stopped counting — an inbox
       * row with an unread dot that opens onto nothing. Same helper the
       * retraction uses, so the two can't decrement differently, and skipped
       * when the message was already hidden so a second tap cannot double-count.
       */
      if (isReceiver && !alreadyHidden) {
        await releaseThreadUnread(msg.conversationId, me, !msg.read);
      }

      // Only my own preview can have changed — the other participant's view of
      // this thread is untouched, and must not be recomputed or re-broadcast.
      const mine = await recomputePreview(msg.conversationId, [me]);

      // My other tabs, and nobody else's. A per-user hide that told the other
      // side anything would stop being per-user.
      emitEach([me], 'message:deletedForMe', mine, {
        messageId: String(msg._id),
        conversationId: String(msg.conversationId),
      });

      return ok(res, { deleted: 'me' });
    }

    /* --- everyone ------------------------------------------------------- */

    if (!isSender) return fail(res, 'You can only delete your own messages for everyone', 403);
    if (Date.now() - msg.createdAt.getTime() > DELETE_WINDOW_MS) {
      return fail(res, 'That message is too old to delete for everyone', 403);
    }

    // Already a tombstone: report the state rather than clearing it twice and
    // decrementing the unread counter a second time.
    if (msg.deletedForEveryone) return ok(res, { deleted: 'everyone' });

    /**
     * Captured before the fields are cleared. The asset is destroyed after the
     * response, and by then the document no longer says where it lived.
     */
    const asset = {
      mediaUrl: msg.mediaUrl,
      mediaPublicId: msg.mediaPublicId,
      mediaResourceType: msg.mediaResourceType,
    };
    const wasUnread = !msg.read;

    const deletedAt = new Date();
    msg.deletedForEveryone = true;
    msg.deletedAt = deletedAt;
    msg.deletedBy = new Types.ObjectId(me);
    // The document survives so counters and cached lists stay coherent; the
    // content does not. Superseded drafts go too — an edit history would be a
    // readable copy of the very text that was just retracted.
    msg.text = '';
    msg.mediaUrl = null;
    msg.mediaPublicId = null;
    msg.mediaResourceType = null;
    msg.editHistory = [];
    await msg.save();

    /**
     * Both unread counters, in one helper, awaited. It is only local Mongo, so
     * the recipient's badge is already correct by the time the sender's
     * response lands — unlike the CDN call below, which genuinely must not be
     * waited on.
     */
    await retractMessage({
      _id: msg._id,
      conversationId: msg.conversationId,
      receiverId: msg.receiverId,
      wasUnread,
    });

    const previews = await recomputePreview(msg.conversationId, participants);

    emitEach(participants, 'message:deleted', previews, {
      messageId: String(msg._id),
      conversationId: String(msg.conversationId),
      deletedAt,
    });

    const response = ok(res, { deleted: 'everyone' });

    /**
     * After the response. `destroyMedia` reaches the CDN, which the sender
     * should never wait on and which cannot throw: a stranded asset is a
     * sweep-up job, while a retraction that 500s because Cloudinary was
     * unreachable is a message the user was told they could not take back.
     */
    void destroyMedia(asset);

    return response;
  } catch (err) {
    console.error('delete message error:', err);
    return fail(res, 'Could not delete that message', 500);
  }
}
