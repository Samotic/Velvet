'use client';

import { io, type Socket } from 'socket.io-client';

import { API_BASE, getToken } from './api';

/**
 * The single Socket.io connection, shared by every screen that needs live
 * updates — the message thread, the inbox, and the navbar's unread badges.
 *
 * One socket per tab rather than one per component: the server tracks presence
 * per connection, so a component-scoped socket would make a user look like
 * several people and multiply every broadcast.
 *
 * Text messaging and notifications only. There is no media, no call signalling
 * and no playback sync — Watch Together was removed from the product.
 */

let socket: Socket | null = null;

/**
 * The inbox row every edit and delete event carries.
 *
 * The server computes this **per recipient** and sends each participant their
 * own copy, because once a message can be hidden for one side only, "the last
 * message in this thread" has two different answers. Two consequences for
 * handlers:
 *
 *  - Never derive a sidebar row from the event's message fields. A retraction
 *    the viewer was not looking at leaves their preview untouched, and it
 *    will say so here — the row is not necessarily "Message deleted".
 *  - `previewFromMe` is the server's verdict on whether the viewer sent what
 *    their row now shows, which after a delete may be a different message by
 *    a different person. Recomputing it locally gets "You: " wrong.
 */
export interface PreviewRow {
  preview: string;
  previewAt: string | null;
  previewFromMe: boolean;
}

/** Server → client events. Kept in one place so handlers can't drift. */
export interface ServerEvents {
  'message:new': (message: unknown) => void;
  'message:read': (payload: { conversationId: string; readerId: string }) => void;
  /**
   * A message was reworded. Carries the new body rather than the whole
   * message: the thread patches in place by id, and a partial payload cannot
   * accidentally resurrect a field the recipient had already hidden.
   */
  'message:edited': (
    payload: PreviewRow & {
      messageId: string;
      conversationId: string;
      text: string;
      editedAt: string;
    },
  ) => void;
  /**
   * A message was retracted for everyone. The bubble becomes a tombstone and
   * stays in place — it is not removed, so the thread does not reflow under
   * whoever happens to be reading it.
   */
  'message:deleted': (
    payload: PreviewRow & {
      messageId: string;
      conversationId: string;
      deletedAt: string;
    },
  ) => void;
  /**
   * I hid a message, on another device.
   *
   * Only ever delivered to the person who did it — the other participant is
   * told nothing, which is what makes a per-user delete per-user. The bubble
   * is removed outright here; there is no tombstone, because nothing was
   * retracted from anyone.
   */
  'message:deletedForMe': (
    payload: PreviewRow & { messageId: string; conversationId: string },
  ) => void;
  /** The relay identifies the typist by id only — it has no conversation id. */
  'typing:start': (payload: { userId: string }) => void;
  'typing:stop': (payload: { userId: string }) => void;
  'notification:new': (notification: unknown) => void;
  /**
   * A notification was withdrawn — raised when the message behind it is
   * retracted. The card is removed rather than tombstoned: unlike a bubble it
   * marks no place in a conversation, so leaving a dead one behind is clutter
   * pointing at nothing.
   */
  'notification:removed': (payload: { id: string }) => void;
  'notification:changed': (payload: { unread?: number }) => void;
  'follow:changed': (payload: { userId?: string }) => void;
}

/**
 * Returns the live socket, connecting on first call.
 *
 * Returns null when there's no token — an anonymous visitor has nothing to
 * subscribe to, and connecting would just be refused by the server's auth
 * handshake.
 */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;

  const token = getToken();
  if (!token) return null;

  if (!socket) {
    socket = io(API_BASE, {
      auth: { token },
      // The backend mounts Socket.io on its default path; websocket first with
      // a polling fallback for networks that block upgrades.
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }

  return socket;
}

/**
 * Tears the connection down. Called on logout — the next `getSocket()` builds
 * a fresh one carrying the new token, so a second user on the same browser
 * never inherits the first one's subscriptions.
 */
export function closeSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Subscribes to one event and returns an unsubscribe function, shaped for
 * `useEffect` cleanup:
 *
 *   useEffect(() => onSocket('message:new', handle), [handle]);
 *
 * A no-op teardown when there's no socket keeps the call site free of null
 * checks.
 */
export function onSocket<E extends keyof ServerEvents>(
  event: E,
  handler: ServerEvents[E],
): () => void {
  const s = getSocket();
  if (!s) return () => {};

  s.on(event as string, handler as (...args: unknown[]) => void);
  return () => {
    s.off(event as string, handler as (...args: unknown[]) => void);
  };
}

/** Fire-and-forget emit; silently does nothing when disconnected. */
export function emitSocket(event: string, payload?: unknown): void {
  getSocket()?.emit(event, payload);
}
