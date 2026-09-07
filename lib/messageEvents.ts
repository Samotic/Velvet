'use client';

import type { Conversation, DirectMessage } from './contentTypes';
import type { PreviewRow } from './socket';

/**
 * How an edit or a delete changes a list, as plain functions.
 *
 * The same reasoning as `lib/messageGroups.ts`: these rules are testable
 * without a renderer, and three screens need them — the open thread, the
 * inbox, and whichever of the two is mounted when the event lands. Written as
 * effects inside `Thread` they would have to be written again inside `Inbox`.
 *
 * Every function is pure and **returns the input array unchanged when nothing
 * matched**, so a React state setter given the result re-renders only when
 * something actually moved. That matters here because these events broadcast
 * to both participants and to every tab either of them has open, most of which
 * are not looking at the affected conversation.
 */

/* -------------------------------- thread ---------------------------------- */

/**
 * Applies a rewording to whichever bubble it belongs to.
 *
 * Matching is by `messageId` only. §5.4's reconciliation rule falls out of
 * that for free: an optimistic edit has already written the same text under
 * the same id, so the socket echo lands on the row that is already correct and
 * changes nothing rather than appending a second copy.
 *
 * `editedAt` is taken from the payload, never stamped locally — an identical
 * edit is a server-side no-op that deliberately leaves the timestamp alone,
 * and a client that set its own would show "edited" on a message that wasn't.
 */
export function applyEdited(
  messages: DirectMessage[],
  payload: { messageId: string; text: string; editedAt: string },
): DirectMessage[] {
  let hit = false;
  const next = messages.map((m) => {
    if (m.id !== payload.messageId) return m;
    hit = true;
    return { ...m, text: payload.text, editedAt: payload.editedAt };
  });
  return hit ? next : messages;
}

/**
 * Turns a bubble into a tombstone, in place.
 *
 * The row keeps its position and its timestamp. Removing it would reflow the
 * thread under whoever is reading, and — worse — would make a retraction
 * indistinguishable from a message that was never sent, which is not what
 * either participant saw happen.
 *
 * `text` and `mediaUrl` are cleared to mirror what the server has already
 * done. Leaving them would keep the retracted content alive in the tab that
 * was open when it happened, which is precisely the state this feature exists
 * to end.
 */
export function applyDeleted(
  messages: DirectMessage[],
  payload: { messageId: string; deletedAt: string },
): DirectMessage[] {
  let hit = false;
  const next = messages.map((m) => {
    if (m.id !== payload.messageId) return m;
    hit = true;
    return {
      ...m,
      text: '',
      mediaUrl: null,
      mediaDuration: null,
      deletedForEveryone: true,
      deletedAt: payload.deletedAt,
    };
  });
  return hit ? next : messages;
}

/**
 * Drops a message I hid, with no trace.
 *
 * Removal, not a tombstone: nothing was retracted from anyone, so a marker
 * saying "this was deleted" would be a false claim about the conversation. The
 * caller animates the gap closed; this only decides what the list contains.
 */
export function applyDeletedForMe(
  messages: DirectMessage[],
  payload: { messageId: string },
): DirectMessage[] {
  const next = messages.filter((m) => m.id !== payload.messageId);
  return next.length === messages.length ? messages : next;
}

/* -------------------------------- inbox ----------------------------------- */

/**
 * Writes the server's per-viewer row onto the matching conversation.
 *
 * The preview is **not** derived from the event's message — see `PreviewRow`.
 * A retraction of something the viewer was not looking at leaves their row
 * untouched, and the payload says so; recomputing locally would overwrite a
 * correct row with "Message deleted" for the wrong person.
 *
 * Re-sorting is left to the caller. `previewAt` can move *backwards* when a
 * hidden message uncovers an older one, so a list that sorts on it must sort
 * after applying this, not assume the order still holds.
 */
export function applyPreview(
  conversations: Conversation[],
  payload: PreviewRow & { conversationId: string },
): Conversation[] {
  let hit = false;
  const next = conversations.map((c) => {
    if (c.id !== payload.conversationId) return c;
    hit = true;
    return {
      ...c,
      lastMessage: payload.preview,
      lastMessageAt: payload.previewAt,
      lastFromMe: payload.previewFromMe,
    };
  });
  return hit ? next : conversations;
}

/** Newest first, with rows that have never carried a message sorted last. */
export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : -Infinity;
    const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : -Infinity;
    return bt - at;
  });
}

/* ------------------------------- rendering -------------------------------- */

/**
 * What a bubble should render as, resolved once so no renderer branches on
 * `mediaUrl != null` — the same rule the `kind` field exists to enforce.
 *
 * The tombstone check comes **first** and deliberately outranks `kind`: a
 * retracted photo is still `kind: 'image'` with no URL, and a renderer that
 * asked about kind first would try to draw an image that is not there.
 */
export type BubbleShape = 'deleted' | 'text' | 'image' | 'audio';

export function bubbleShape(m: DirectMessage): BubbleShape {
  if (m.deletedForEveryone) return 'deleted';
  return m.kind;
}

/** The copy inside a tombstone bubble. One place, so both surfaces agree. */
export const DELETED_BUBBLE_TEXT = 'This message was deleted';
