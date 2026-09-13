import type { Request, Response } from 'express';
import { Types, type HydratedDocument, type UpdateQuery } from 'mongoose';

import { ACCEPT_LEASE_MS, ClearRequest, type IClearRequest } from '../models/ClearRequest';
import { Conversation, type IConversationPreview } from '../models/Conversation';
import { pairKeyFor } from '../models/conversationKey';
import { EDIT_HISTORY_LIMIT, MESSAGE_KINDS, Message, type MessageKind } from '../models/Message';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import { emitToUser } from '../lib/socket';
import { fail, ok } from '../utils/http';
import {
  notify,
  releaseThreadUnread,
  retractMessage,
  retractMessageCards,
  withdrawClearRequestCard,
} from '../utils/notify';
import {
  DELETE_WINDOW_MS,
  EDIT_WINDOW_MS,
  MAX_MESSAGE_LENGTH,
} from '../config/messaging';
import { CLEARED_PREVIEW, previewFor, recomputePreview } from '../services/conversationPreview';
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
import { recordStrandedMedia } from '../services/strandedMedia';
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

/**
 * Asking to clear a chat for both is capped per person, **per thread**.
 *
 * An ask costs the asker nothing and drops a card in the other person's bell,
 * and withdrawing takes the card away again — so ask-and-withdraw in a loop
 * would ping one person for as long as someone cared to, through the feature
 * whose whole point is consent. Keyed on the conversation as well as the
 * asker, so the cap sits between two people: pestering one thread does not
 * stop an honest ask in another, and the other participant keeps their own
 * allowance.
 *
 * 3 an hour leaves room for the honest pattern — ask, withdraw a mis-tap, ask
 * again — and a fourth inside the hour is already the loop. 5 a day stops the
 * patient version that waits out each hour. Fixed windows, as for follows, so
 * a burst straddling a boundary can briefly get past either; the aim is to
 * stop a loop, not to police the exact fourth ask.
 */
const CLEAR_REQUEST_LIMITS: LimitWindow[] = [
  { limit: 3, seconds: 60 * 60 },
  { limit: 5, seconds: 24 * 60 * 60 },
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
 * Looked up by `pairKey`, the field the unique index is on — not by
 * `participants`, whose index is deliberately not unique (see the model).
 */
async function conversationFor(a: string, b: string) {
  const pairKey = pairKeyFor(a, b);

  const existing = await Conversation.findOne({ pairKey });
  if (existing) return existing;

  try {
    return await Conversation.create({
      participants: [a, b].sort().map((id) => new Types.ObjectId(id)),
      unread: new Map<string, number>(),
    });
  } catch (err) {
    // Two simultaneous first messages can both miss the find; the unique index
    // rejects the loser, which then reads the winner's document. The retry must
    // look up by the same key that rejected it, or it can find nothing and 500.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const raced = await Conversation.findOne({ pairKey });
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

    /**
     * When each thread on this page was last cleared by agreement, so a row
     * with nothing visible can say "Chat cleared" instead of "Say hello". One
     * query for the page, ascending, so the newest clear is the last one set.
     */
    const clearedAt = new Map<string, Date>();
    if (rows.length) {
      const accepted = await ClearRequest.find({
        conversationId: { $in: rows.map((c) => c._id) },
        status: 'accepted',
      })
        .sort({ resolvedAt: 1 })
        .select('conversationId resolvedAt')
        .lean();
      for (const r of accepted) {
        if (r.resolvedAt) clearedAt.set(String(r.conversationId), r.resolvedAt);
      }
    }

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
         *
         * When this reader has an entry, it is the **whole** answer — including
         * when it is empty. It used to fall back field by field with `??`, and
         * an empty entry stores `at: null` and `senderId: null`, so a thread I
         * had cleared for myself took the *hidden* message's time and sender:
         * it sorted by a message I can no longer see, and read "You: Say hello"
         * whenever I had sent it.
         */
        const mine = c.lastFor?.get(me);
        const preview = mine ?? {
          text: c.lastMessage ?? '',
          at: c.lastMessageAt,
          senderId: c.lastSenderId,
        };

        // Nothing visible, and both people agreed to clear it: say so, dated
        // when it happened, rather than inviting a first message.
        const cleared = preview.text ? undefined : clearedAt.get(String(c._id));

        return {
          id: String(c._id),
          user,
          lastMessage: cleared ? CLEARED_PREVIEW : preview.text,
          lastMessageAt: cleared ?? preview.at,
          lastFromMe: !cleared && String(preview.senderId ?? '') === me,
          unread: c.unread?.get(me) ?? 0,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    /**
     * Re-ordered on the value the row actually shows.
     *
     * The Mongo sort above is on the **shared** `lastMessageAt`, because a Map
     * field cannot be indexed for a sort — but every row displays the
     * **per-viewer** time. Left alone, the two disagree: a thread whose newest
     * messages this viewer has hidden keeps its position near the top while
     * showing something much older, and the client (which re-sorts on the
     * displayed value after any live event) would move it and then a reload
     * would move it back.
     *
     * Clearing a whole conversation is the case that makes this impossible to
     * ignore: the per-viewer time becomes null while the shared one stays
     * current, so an empty row would sit above threads with real activity.
     *
     * Sorting here rather than in the query is cheap — at most 200 rows,
     * already materialised. Rows with no visible message sort last rather than
     * first, which is what `-Infinity` buys.
     */
    out.sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : -Infinity;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : -Infinity;
      return bt - at;
    });

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

    const convo = await Conversation.findOne({ pairKey: pairKeyFor(me, otherId) }).select('_id');

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

    /**
     * Where this thread stands on clearing for both: a pending request drives
     * the banner, the latest accepted one the "cleared this chat" line.
     */
    const [pendingClear, lastClear] = convo
      ? await Promise.all([
          ClearRequest.findOne({ conversationId: convo._id, status: 'pending' })
            .select('_id requesterId createdAt')
            .lean(),
          ClearRequest.findOne({ conversationId: convo._id, status: 'accepted' })
            .sort({ resolvedAt: -1 })
            .select('resolvedAt')
            .lean(),
        ])
      : [null, null];

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
      clearRequest: pendingClear
        ? {
            id: String(pendingClear._id),
            requestedByMe: String(pendingClear.requesterId) === me,
            createdAt: pendingClear.createdAt,
          }
        : null,
      clearedAt: lastClear?.resolvedAt ?? null,
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

    const convo = await Conversation.findOne({ pairKey: pairKeyFor(me, otherId) }).select('_id');

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
      /**
       * The *other* participant, from this recipient's point of view.
       *
       * Every one of these events is addressed to a person, not to a room, so
       * the recipient has to work out which of their threads it belongs to.
       * The per-message events can reconcile by `messageId` and ignore this; a
       * conversation-level clear carries no message id and has nothing else to
       * match on — the open thread is keyed by the other person's id, not by
       * `conversationId`.
       */
      withUserId: participants.find((x) => x !== p) ?? p,
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
       *
       * Also skipped for a tombstone. Retracting an unread message already gave
       * its unread back, and retraction leaves `read: false` behind — so hiding
       * the tombstone afterwards would release it a second time, and the
       * `$gt: 0` guard only stops the counter going negative, not it taking a
       * count that belongs to another unread message in the thread.
       */
      if (isReceiver && !alreadyHidden && !msg.deletedForEveryone) {
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
    void destroyOrRecord({ _id: msg._id, kind: msg.kind, ...asset });

    return response;
  } catch (err) {
    console.error('delete message error:', err);
    return fail(res, 'Could not delete that message', 500);
  }
}

/* ------------------------- clearing a conversation ------------------------ */

/**
 * How many Cloudinary destroys run at once when a clear retracts media.
 *
 * Clearing a long thread can name dozens of assets. Firing them all at once
 * would be a burst against a rate-limited third party for work nobody is
 * waiting on — this is already off the response path, so it can afford to be
 * unhurried.
 */
const DESTROY_CONCURRENCY = 4;

/**
 * Runs `work` over `items`, `limit` at a time. Never throws — and never
 * silently: a rejection is logged, because this runs after the response and a
 * swallowed error here is an orphan nobody can find.
 */
async function inBatches<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(
      items
        .slice(i, i + limit)
        .map((item) => work(item).catch((err) => console.error('media cleanup error:', err))),
    );
  }
}

/** Where a message's asset lives, read before a wipe clears it. */
type MediaHandle = {
  _id: unknown;
  kind?: string | null;
  mediaUrl?: string | null;
  mediaPublicId?: string | null;
  mediaResourceType?: string | null;
};

/**
 * Destroys a message's asset, and writes it down when it could not be.
 *
 * Every message-media destroy goes through here — one retraction, "Delete my
 * recent messages", and a clear by agreement — so all three record a stranded
 * asset the same way. Never throws: neither `destroyMedia` nor
 * `recordStrandedMedia` does.
 */
async function destroyOrRecord(m: MediaHandle): Promise<void> {
  const result = await destroyMedia(m);
  if (result.outcome !== 'stranded') return;
  await recordStrandedMedia({
    messageId: String(m._id),
    kind: m.kind ?? null,
    publicId: result.publicId,
    resourceType: result.resourceType,
    mediaUrl: m.mediaUrl ?? null,
    reason: result.reason,
  });
}

/*
 * The writes every clear is built from. Each is one of the two deletion
 * outcomes applied in bulk; the three clears differ only in which of these
 * they call, over which messages, and who is allowed to ask.
 */

/**
 * Delete-for-me's write, for each of `viewerIds`, across a conversation.
 *
 * With `before`, only messages created strictly earlier — the cutoff a
 * clear-for-both request was made with. Without it, the whole thread, which is
 * what clearing for yourself means.
 *
 * `$addToSet` keeps it idempotent: a message already hidden one at a time is
 * left as it is. New messages carry an empty `deletedFor` and appear normally.
 */
async function hideForViewers(
  conversationId: Types.ObjectId,
  viewerIds: string[],
  before?: Date,
): Promise<void> {
  for (const viewerId of viewerIds) {
    const oid = new Types.ObjectId(viewerId);
    await Message.updateMany(
      {
        conversationId,
        deletedFor: { $ne: oid },
        ...(before ? { createdAt: { $lt: before } } : {}),
      },
      { $addToSet: { deletedFor: oid } },
    );
  }
}

/**
 * Sets each viewer's thread counter to what is really unread for them.
 *
 * Counted rather than set to zero. Clearing for yourself hides everything, so
 * the count *is* zero — but a clear by agreement stops at its cutoff, and a
 * message that arrived while the request was pending still stands and may
 * still be unread. Zeroing would erase it. Counting is right for both, and
 * also absorbs a message that lands mid-clear.
 */
async function recountThreadUnread(
  conversationId: Types.ObjectId,
  viewerIds: string[],
): Promise<void> {
  const set: Record<string, number> = {};
  for (const viewerId of viewerIds) {
    set[`unread.${viewerId}`] = await Message.countDocuments({
      conversationId,
      receiverId: viewerId,
      read: false,
      deletedForEveryone: { $ne: true },
      ...Message.visibleTo(viewerId),
    });
  }
  await Conversation.updateOne({ _id: conversationId }, { $set: set });
}

/**
 * Delete-for-everyone's write: the content goes, the document stays.
 *
 * The same fields the per-message retraction clears, for the same reason —
 * counters and cached lists stay coherent, and nothing readable survives,
 * superseded drafts included. An existing tombstone is skipped so its original
 * `deletedAt` and `deletedBy` stand.
 */
async function tombstone(ids: Types.ObjectId[], deletedBy: string, deletedAt: Date): Promise<void> {
  if (!ids.length) return;
  await Message.updateMany(
    { _id: { $in: ids }, deletedForEveryone: { $ne: true } },
    {
      $set: {
        deletedForEveryone: true,
        deletedAt,
        deletedBy: new Types.ObjectId(deletedBy),
        text: '',
        mediaUrl: null,
        mediaPublicId: null,
        mediaResourceType: null,
        editHistory: [],
      },
    },
  );
}

/**
 * DELETE /api/messages/:userId/history — clear a whole conversation.
 *
 * A bulk application of the per-message rules, not a second deletion model.
 * `scope: 'me'` is delete-for-me applied to every message; `scope: 'everyone'`
 * is delete-for-everyone applied to every message of mine that is still
 * eligible. The same `deletedFor` / `deletedForEveryone` fields carry it, so a
 * cleared thread and a thread cleared one message at a time are identical in
 * the database.
 *
 * Which is also why "everyone" does **not** empty the thread: it can only
 * reach my own messages, inside `DELETE_WINDOW_MS`, exactly as the per-message
 * route can. Their messages stay, and so do mine older than the window. The
 * response returns the counts so the UI can say which, rather than appearing
 * to do less than it was asked.
 */
export async function clearHistory(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const raw = (req.body as { scope?: unknown } | undefined)?.scope ?? req.query.scope;
    const scope = typeof raw === 'string' ? raw : '';
    if (scope !== 'me' && scope !== 'everyone') {
      return fail(res, "Clearing needs scope: 'me' or 'everyone'", 400);
    }

    const me = req.user!.userId;

    const convo = await Conversation.findOne({ pairKey: pairKeyFor(me, otherId) }).select('_id');

    // No thread is not an error: the caller wanted it empty, and it is.
    if (!convo) return ok(res, { cleared: scope, retracted: 0, skippedTooOld: 0 });

    const participants = [me, otherId];

    /* --- mine only, for me ------------------------------------------------ */

    if (scope === 'me') {
      /**
       * Note this hides **their** messages from me as well as my own — that is
       * what clearing a history means, and it is per-viewer, so their copy is
       * untouched.
       */
      await hideForViewers(convo._id, [me]);
      await recountThreadUnread(convo._id, [me]);

      const previews = await recomputePreview(convo._id, [me]);
      emitEach([me], 'message:cleared', previews, {
        conversationId: String(convo._id),
        scope: 'me',
      });

      return ok(res, { cleared: 'me', retracted: 0, skippedTooOld: 0 });
    }

    /* --- mine only, for everyone ------------------------------------------ */

    const cutoff = new Date(Date.now() - DELETE_WINDOW_MS);

    /**
     * Read before writing, for two reasons: the media URLs are about to be
     * cleared and cannot be recovered afterwards, and the unread flags decide
     * how far the recipient's counter falls.
     */
    const mine = await Message.find({
      conversationId: convo._id,
      senderId: me,
      deletedForEveryone: { $ne: true },
    })
      .select('_id kind read createdAt mediaUrl mediaPublicId mediaResourceType')
      .lean();

    const eligible = mine.filter((m) => m.createdAt >= cutoff);
    const skippedTooOld = mine.length - eligible.length;

    if (!eligible.length) {
      return ok(res, { cleared: 'everyone', retracted: 0, skippedTooOld });
    }

    const deletedAt = new Date();
    const ids = eligible.map((m) => m._id as Types.ObjectId);

    // One write, through the helper the clear by agreement also uses.
    await tombstone(ids, me, deletedAt);

    /**
     * Their unread counter, once per message that was unread.
     *
     * `releaseThreadUnread` is guarded at zero, so a miscount cannot drive it
     * negative — but the number of calls still has to match the number of
     * messages that were actually counting.
     */
    const unreadCount = eligible.filter((m) => !m.read).length;
    for (let i = 0; i < unreadCount; i += 1) {
      await releaseThreadUnread(convo._id, otherId, true);
    }

    /**
     * The notification card, once — not once per message — and found by any
     * of the retracted ids, because it holds my newest one. This used to pass
     * `eligible[0]`, the oldest, which missed the card whenever more than one
     * message was retracted. The unread counter was released above, per
     * message; this touches cards only.
     */
    await retractMessageCards(ids);

    const previews = await recomputePreview(convo._id, participants);
    emitEach(participants, 'message:cleared', previews, {
      conversationId: String(convo._id),
      scope: 'everyone',
      deletedAt,
    });

    const response = ok(res, {
      cleared: 'everyone',
      retracted: eligible.length,
      skippedTooOld,
    });

    // After the response, throttled. A stranded asset is a sweep-up job — and
    // is recorded as one — while a clear that 500s because Cloudinary was slow
    // is a thread the user was told they could not tidy.
    void inBatches(
      eligible.filter((m) => m.mediaUrl || m.mediaPublicId),
      DESTROY_CONCURRENCY,
      destroyOrRecord,
    );

    return response;
  } catch (err) {
    console.error('clear history error:', err);
    return fail(res, 'Could not clear that conversation', 500);
  }
}

/* ------------------------ clearing, for both of you ----------------------- */

/*
 * Clearing a conversation for both participants is **consent-gated**, and it
 * is not a third kind of deletion.
 *
 * One person asks, and nothing changes. The other accepts, and then — for every
 * message created before the moment of asking —
 *
 *  - delete-for-me is applied for **both** of them: `hideForViewers`, the write
 *    "Clear chat for me" makes, once per participant; and
 *  - delete-for-everyone's content wipe is applied: `tombstone`, the write
 *    "Delete my recent messages" makes, with its media destroyed.
 *
 * Two people could already reach the same *visible* result by each clearing
 * for themselves. What agreement adds is permission for the wipe to reach past
 * its two ordinary limits: it covers the other person's messages, not only the
 * sender's, and it has no 48-hour window. Both limits exist to stop one person
 * rewriting shared history alone; with both agreeing, neither applies. That
 * permission is the only new rule. **There is no undo** — the content is gone
 * from Mongo and Cloudinary, and the confirm step is the only guard.
 *
 * `:userId` is always the other person, as in the follow graph. Requester and
 * recipient come from the session and the pair; the one id a caller supplies is
 * the request id on accept and decline, which pins the answer to the exact
 * request the recipient was shown rather than whichever is pending by then.
 */

/** "Already asked", worded for whoever is asking again. */
function pendingMessage(requesterId: unknown, me: string): string {
  return String(requesterId) === me
    ? 'You have already asked to clear this chat'
    : 'They have already asked to clear this chat — answer it in the thread';
}

/** POST /api/messages/:userId/clear-request — ask to clear the chat for both. */
export async function requestClear(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const me = req.user!.userId;
    if (otherId === me) return fail(res, 'User not found', 404);

    const other = await User.findById(otherId).select('_id');
    if (!other) return fail(res, 'User not found', 404);

    const convo = await Conversation.findOne({ pairKey: pairKeyFor(me, otherId) }).select('_id');
    if (!convo) return fail(res, 'There is no conversation to clear', 404);

    /**
     * Something has to be left to clear. A thread that is already hidden from
     * both people and wiped would raise a request — and a card in someone
     * else's bell — whose acceptance changes nothing.
     */
    const meOid = new Types.ObjectId(me);
    const otherOid = new Types.ObjectId(otherId);
    const anything = await Message.exists({
      conversationId: convo._id,
      $or: [
        { deletedForEveryone: { $ne: true } },
        { deletedFor: { $ne: meOid } },
        { deletedFor: { $ne: otherOid } },
      ],
    });
    if (!anything) return fail(res, 'There is nothing left to clear in this chat', 422);

    const existing = await ClearRequest.findOne({ conversationId: convo._id, status: 'pending' })
      .select('requesterId')
      .lean();
    if (existing) return fail(res, pendingMessage(existing.requesterId, me), 409);

    /**
     * Counted here and only here: past every refusal that raises no card, so a
     * 404, a 409 or a 422 costs nothing, and before the create, so an ask over
     * the cap never reaches anyone's bell. See `CLEAR_REQUEST_LIMITS`.
     */
    const limitAction = `clear_request:${String(convo._id)}`;
    const gate = await consume(me, limitAction, CLEAR_REQUEST_LIMITS);
    if (!gate.ok) {
      const minutes = Math.ceil(gate.retryAfter / 60);
      return fail(
        res,
        `You have asked to clear this chat too many times. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        429,
      );
    }

    // The cutoff is now: the request covers what exists at the moment of asking.
    const cutoff = new Date();

    let request;
    try {
      request = await ClearRequest.create({
        conversationId: convo._id,
        requesterId: me,
        recipientId: otherId,
        cutoff,
        status: 'pending',
      });
    } catch (err) {
      // Both people asked in the same instant and both missed the find above.
      // The partial unique index let exactly one in; report that one.
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        // The loser made no request and raised no card, so its ask is handed back.
        await refund(me, limitAction, CLEAR_REQUEST_LIMITS);
        const winner = await ClearRequest.findOne({ conversationId: convo._id, status: 'pending' })
          .select('requesterId')
          .lean();
        return fail(res, pendingMessage(winner?.requesterId, me), 409);
      }
      throw err;
    }

    // Awaited, unlike a message's notify: it is how the other person learns
    // there is something to answer at all, and it never throws.
    await notify({ userId: otherId, type: 'clear_request', fromUserId: me });

    // Their open thread grows the banner; so do my other tabs.
    emitToUser(otherId, 'clear:changed', { withUserId: me });
    emitToUser(me, 'clear:changed', { withUserId: otherId });

    return ok(
      res,
      {
        request: {
          id: String(request._id),
          requestedByMe: true,
          createdAt: request.createdAt,
        },
      },
      201,
    );
  } catch (err) {
    console.error('request clear error:', err);
    return fail(res, 'Could not ask to clear this chat', 500);
  }
}

/**
 * A request no acceptance is holding. `{ acceptingSince: null }` also matches a
 * document without the field, so requests made before it existed qualify. A
 * claim older than the lease belongs to an attempt that died without letting go.
 */
function unclaimed(now: Date) {
  return {
    $or: [
      { acceptingSince: null },
      { acceptingSince: { $lt: new Date(now.getTime() - ACCEPT_LEASE_MS) } },
    ],
  };
}

/**
 * Takes one pending request addressed to `me`, atomically: `claim` marks an
 * acceptance under way and leaves the request pending; `decline` resolves it.
 *
 * The filter is the whole authorisation: this request, in this pair's
 * conversation, from them, to me, still pending, and not held by an acceptance
 * already under way. A withdraw racing an accept can only win or lose the same
 * document, so a withdrawn request is never carried out, and a double-tapped
 * accept finds the request held the second time.
 */
async function answerRequest(
  req: Request,
  res: Response,
  action: 'claim' | 'decline',
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true;
      me: string;
      otherId: string;
      conversationId: Types.ObjectId;
      request: HydratedDocument<IClearRequest>;
      at: Date;
    }
> {
  const otherId = req.params.userId;
  if (!isObjectId(otherId)) return { ok: false, response: fail(res, 'User not found', 404) };

  const me = req.user!.userId;
  const requestId = (req.body as { requestId?: unknown } | undefined)?.requestId;
  if (typeof requestId !== 'string' || !isObjectId(requestId)) {
    return { ok: false, response: fail(res, 'Say which request: requestId is required', 400) };
  }

  const convo = await Conversation.findOne({ pairKey: pairKeyFor(me, otherId) }).select('_id');
  if (!convo) return { ok: false, response: fail(res, 'Request not found', 404) };

  const at = new Date();
  const update: UpdateQuery<IClearRequest> =
    action === 'claim'
      ? { $set: { acceptingSince: at } }
      : { $set: { status: 'declined', resolvedAt: at } };

  const request = await ClearRequest.findOneAndUpdate(
    {
      _id: requestId,
      conversationId: convo._id,
      requesterId: otherId,
      recipientId: me,
      status: 'pending',
      ...unclaimed(at),
    },
    update,
    { new: true },
  );

  if (!request) {
    const mine = await ClearRequest.findOne({
      _id: requestId,
      conversationId: convo._id,
      recipientId: me,
    })
      .select('status')
      .lean();
    if (!mine) return { ok: false, response: fail(res, 'Request not found', 404) };
    return {
      ok: false,
      response:
        mine.status === 'pending'
          ? fail(res, 'That request is being accepted right now', 409)
          : fail(res, 'That request is no longer waiting for an answer', 409),
    };
  }

  return { ok: true, me, otherId, conversationId: convo._id, request, at };
}

/**
 * Lets go of a failed acceptance's claim, so the request is answerable again at
 * once rather than when the lease runs out. Matched on the claim's own
 * timestamp, so it can never release a later attempt's claim. Never throws: if
 * this fails too, the lease still lapses.
 */
async function releaseClaim(id: Types.ObjectId, at: Date): Promise<void> {
  try {
    await ClearRequest.updateOne(
      { _id: id, status: 'pending', acceptingSince: at },
      { $set: { acceptingSince: null } },
    );
  } catch (err) {
    console.error('accept clear: could not release the claim; it lapses with the lease:', err);
  }
}

/**
 * The media of an acceptance that failed once its wipe had begun.
 *
 * `tombstone` erases the handles as it wipes, and the request is still pending,
 * so a retry reads those messages with no media on them and would never
 * destroy it. Each asset therefore goes one of three ways, and none is lost:
 *
 *  - its message **was** wiped: destroyed now, or recorded when that fails —
 *    what a successful acceptance would have done with it;
 *  - its message was **not** wiped: left alone, handle intact, for the retry;
 *  - Mongo cannot say which, because Mongo is what failed: recorded and not
 *    destroyed, since it may belong to a message that still stands.
 *
 * Never throws.
 */
async function settleMediaAfterFailedWipe(media: MediaHandle[]): Promise<void> {
  let wiped: Set<string>;
  try {
    const rows = await Message.find({
      _id: { $in: media.map((m) => m._id as Types.ObjectId) },
      mediaUrl: null,
      mediaPublicId: null,
    })
      .select('_id')
      .lean();
    wiped = new Set(rows.map((r) => String(r._id)));
  } catch (err) {
    console.error('accept clear: could not tell which media was wiped, so all of it is recorded:', err);
    for (const m of media) {
      await recordStrandedMedia({
        messageId: String(m._id),
        kind: m.kind ?? null,
        publicId: m.mediaPublicId ?? null,
        resourceType: m.mediaResourceType ?? null,
        mediaUrl: m.mediaUrl ?? null,
        reason: 'a clear-for-both acceptance failed mid-wipe, and whether this message was wiped is unknown',
      });
    }
    return;
  }
  await inBatches(
    media.filter((m) => wiped.has(String(m._id))),
    DESTROY_CONCURRENCY,
    destroyOrRecord,
  );
}

/**
 * POST /api/messages/:userId/clear-request/accept — `{ requestId }`.
 *
 * The irreversible step. Everything before the request's cutoff is hidden
 * from both people and its content wiped, their messages and mine alike.
 *
 * **The request reads `accepted` only once every write below has landed.** It
 * is claimed first and stays `pending` throughout, so a failure anywhere
 * leaves it pending: the claim is released, and accepting again is the
 * recovery. Every write is idempotent, so a retry repeats what already landed
 * harmlessly and finishes the rest. What a failed attempt did do stays done —
 * the messages are already hidden from both, and anything wiped is wiped.
 */
export async function acceptClear(req: Request, res: Response): Promise<Response> {
  let claim: { id: Types.ObjectId; at: Date } | null = null;
  let media: MediaHandle[] = [];
  let wipeStarted = false;

  try {
    const answered = await answerRequest(req, res, 'claim');
    if (!answered.ok) return answered.response;
    const { me, otherId, conversationId, request, at } = answered;
    claim = { id: request._id, at };

    const participants = [me, otherId];

    /**
     * Up to the cutoff **stored on the request**, never up to now. Anything
     * sent while it waited was not part of what either person agreed to.
     *
     * Read before writing: the media handles are about to be cleared, and
     * nothing can recover them afterwards.
     */
    const doomed = await Message.find({ conversationId, createdAt: { $lt: request.cutoff } })
      .select('_id kind mediaUrl mediaPublicId mediaResourceType')
      .lean();
    const ids = doomed.map((m) => m._id as Types.ObjectId);
    media = doomed.filter((m) => m.mediaUrl || m.mediaPublicId);

    // 1. Delete-for-me, for both of them.
    await hideForViewers(conversationId, participants, request.cutoff);

    // 2. The bookkeeping every clear does. None of it depends on the wipe —
    //    the hidden messages already count for nothing and preview nothing —
    //    so it runs first, and the wipe can be the last message write.
    await recountThreadUnread(conversationId, participants);
    await retractMessageCards(ids);
    await withdrawClearRequestCard(me, otherId);
    const previews = await recomputePreview(conversationId, participants);

    // 3. Delete-for-everyone's content wipe, with neither the sender rule nor
    //    the window: the permission the agreement grants. Last, because it is
    //    the write that erases the media handles — fail before it, and every
    //    handle is still there for the retry. `deletedBy` names who asked; the
    //    request records who agreed.
    const clearedAt = new Date();
    wipeStarted = true;
    await tombstone(ids, String(request.requesterId), clearedAt);

    // 4. Only now does the request say it happened.
    const done = await ClearRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending', acceptingSince: at },
      {
        $set: {
          status: 'accepted',
          resolvedAt: clearedAt,
          clearedCount: ids.length,
          acceptingSince: null,
        },
      },
      { new: true },
    );
    if (!done) {
      throw new Error(`clear request ${String(request._id)} lost its claim before it was marked accepted`);
    }
    claim = null;

    /**
     * Each side is told `scope: 'me'`, because from each side that is exactly
     * what happened to their view. Not a third scope: `requestId` is what says
     * it was by agreement, and both threads reload to pick up the notice.
     */
    emitEach(participants, 'message:cleared', previews, {
      conversationId: String(conversationId),
      scope: 'me',
      requestId: String(request._id),
      clearedAt,
    });

    const response = ok(res, { cleared: ids.length, clearedAt });

    // After the response, throttled, and every asset that survives recorded. A
    // destroy failing here cannot un-accept anything: the request records what
    // happened in Mongo, and the stranded-media list records Cloudinary's side.
    void inBatches(media, DESTROY_CONCURRENCY, destroyOrRecord);

    return response;
  } catch (err) {
    console.error('accept clear error:', err);
    if (claim) await releaseClaim(claim.id, claim.at);
    if (wipeStarted && media.length) void settleMediaAfterFailedWipe(media);
    return fail(res, 'Could not clear this chat. It was not marked as agreed — try again.', 500);
  }
}

/**
 * POST /api/messages/:userId/clear-request/decline — `{ requestId }`.
 *
 * Silent, like a declined follow request: the requester is told nothing —
 * saying so is hostile and invites asking again. Only my own other tabs hear,
 * so the banner leaves those too.
 */
export async function declineClear(req: Request, res: Response): Promise<Response> {
  try {
    const answered = await answerRequest(req, res, 'decline');
    if (!answered.ok) return answered.response;
    const { me, otherId } = answered;

    await withdrawClearRequestCard(me, otherId);
    emitToUser(me, 'clear:changed', { withUserId: otherId });

    return ok(res, { status: 'declined' });
  } catch (err) {
    console.error('decline clear error:', err);
    return fail(res, 'Could not answer that request', 500);
  }
}

/**
 * DELETE /api/messages/:userId/clear-request — withdraw my pending request.
 *
 * Idempotent: with nothing pending it still answers success, since ending up
 * with no request is what was asked for. That also means a request they
 * already declined looks exactly like one that was never there, so cancelling
 * cannot be used to find out about a silent decline.
 */
export async function cancelClear(req: Request, res: Response): Promise<Response> {
  try {
    const otherId = req.params.userId;
    if (!isObjectId(otherId)) return fail(res, 'User not found', 404);

    const me = req.user!.userId;

    const convo = await Conversation.findOne({ pairKey: pairKeyFor(me, otherId) }).select('_id');
    if (!convo) return ok(res, { status: 'none' });

    const now = new Date();
    const request = await ClearRequest.findOneAndUpdate(
      {
        conversationId: convo._id,
        requesterId: me,
        recipientId: otherId,
        status: 'pending',
        ...unclaimed(now),
      },
      { $set: { status: 'cancelled', resolvedAt: now } },
      { new: true },
    );
    if (!request) {
      /**
       * Still pending but held: they are accepting it at this moment, and
       * answering `none` would tell me it was withdrawn while it is being
       * carried out. This reveals nothing a decline hides — a declined request
       * is not pending, and still answers `none`.
       */
      const held = await ClearRequest.exists({
        conversationId: convo._id,
        requesterId: me,
        recipientId: otherId,
        status: 'pending',
      });
      if (held) {
        return fail(res, 'They are accepting this request right now, so it can no longer be withdrawn', 409);
      }
      return ok(res, { status: 'none' });
    }

    // Nothing left to answer, so nothing left in their bell or on their screen.
    await withdrawClearRequestCard(otherId, me);
    emitToUser(otherId, 'clear:changed', { withUserId: me });
    emitToUser(me, 'clear:changed', { withUserId: otherId });

    return ok(res, { status: 'cancelled' });
  } catch (err) {
    console.error('cancel clear error:', err);
    return fail(res, 'Could not withdraw that request', 500);
  }
}
