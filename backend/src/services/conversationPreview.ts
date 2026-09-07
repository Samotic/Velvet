import type { Types } from 'mongoose';

import { Conversation, type IConversationPreview } from '../models/Conversation';
import { Message, type IMessage, type MessageKind } from '../models/Message';

/**
 * The inbox preview, which is a fact about a **reader** rather than a thread.
 *
 * Once a message can be hidden for one participant only, "the last message"
 * has two different answers in the same conversation, so the preview cannot be
 * one shared string. This module owns the whole calculation and is the only
 * writer of `Conversation.lastFor` — the send path and both delete paths call
 * in here rather than each deriving a preview of their own, because three
 * implementations of "what does the inbox row say" is three chances to drift.
 */

/** What a retracted message reads as, everywhere it is summarised. */
export const DELETED_PREVIEW = 'Message deleted';

/**
 * What the inbox row and the push notification show.
 *
 * A media message has no text, so without this the inbox would render a blank
 * row and the email would announce an empty message. A tombstone has no text
 * either, but for the opposite reason — it was cleared on purpose — so it gets
 * a label instead of falling through to the empty body.
 */
export function previewFor(
  kind: MessageKind,
  text: string,
  deletedForEveryone = false,
): string {
  if (deletedForEveryone) return DELETED_PREVIEW;
  if (kind === 'image') return '📷 Photo';
  if (kind === 'audio') return '🎙 Voice message';
  return text;
}

/** The fields a preview is computed from — all a caller needs to pass as a hint. */
export type PreviewSource = Pick<
  IMessage,
  'kind' | 'text' | 'deletedForEveryone' | 'createdAt' | 'senderId' | 'deletedFor'
>;

const EMPTY = { text: '', at: null, senderId: null };

const hiddenFrom = (m: PreviewSource, viewerId: string): boolean =>
  (m.deletedFor ?? []).some((id) => String(id) === viewerId);

/**
 * Rewrites the conversation's previews: the shared thread-level fields, and
 * one entry in `lastFor` per participant.
 *
 * `justSent` is an optimisation with a narrow contract: pass a message **only**
 * when it has just been created, because that is the one case where it is
 * guaranteed to be the newest message for everybody, and the two lookups can
 * be skipped entirely. The delete paths must not pass it — a retracted message
 * may be anywhere in the thread — so they take the full recompute, which is
 * two indexed queries against an operation that happens rarely.
 *
 * The shared `lastMessage` / `lastMessageAt` / `lastSenderId` are still
 * maintained: the inbox sorts on `lastMessageAt` (a map cannot be indexed for
 * a sort) and they are the fallback for rows written before `lastFor` existed.
 */
export async function recomputePreview(
  conversationId: Types.ObjectId,
  viewerIds: string[],
  justSent?: PreviewSource | null,
): Promise<Record<string, IConversationPreview>> {
  const set: Record<string, unknown> = {};
  const previews: Record<string, IConversationPreview> = {};

  const newest =
    justSent ??
    (await Message.findOne({ conversationId }).sort({ createdAt: -1 }).lean<PreviewSource>());

  if (newest) {
    set.lastMessage = previewFor(newest.kind, newest.text, newest.deletedForEveryone);
    set.lastMessageAt = newest.createdAt;
    set.lastSenderId = newest.senderId;
  } else {
    // Every message in the thread is gone. Blank the row rather than leaving
    // the last thing anyone said standing under an empty conversation.
    set.lastMessage = '';
    set.lastMessageAt = null;
    set.lastSenderId = null;
  }

  for (const viewerId of viewerIds) {
    const visible =
      justSent && !hiddenFrom(justSent, viewerId)
        ? justSent
        : await Message.findOne({ conversationId, ...Message.visibleTo(viewerId) })
            .sort({ createdAt: -1 })
            .lean<PreviewSource>();

    previews[viewerId] = visible
      ? {
          text: previewFor(visible.kind, visible.text, visible.deletedForEveryone),
          at: visible.createdAt,
          senderId: visible.senderId,
        }
      : { ...EMPTY };
    set[`lastFor.${viewerId}`] = previews[viewerId];
  }

  await Conversation.updateOne({ _id: conversationId }, { $set: set });

  /**
   * Handed back so callers can push each participant *their own* row rather
   * than one shared string. A socket payload that hardcoded "Message deleted"
   * would be wrong for both sides at once: the sender's inbox renders "You: "
   * from `senderId`, and either participant may not have been looking at the
   * retracted message at all — if it was not their newest visible one, their
   * preview does not change here.
   */
  return previews;
}
