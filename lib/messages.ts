'use client';

import { api } from './api';
import type { Conversation, DirectMessage } from './contentTypes';
import type { PublicProfile } from './authTypes';

/**
 * Direct messaging: text, photos and voice notes. No calls.
 *
 * Media travels as a base64 data URL on the JSON body, the same transport the
 * avatar upload uses — see `uploadPhoto` in the backend's userController. The
 * size checks below are a courtesy so the user hears "too big" instantly
 * instead of after a 6MB round trip; the server enforces the real limits,
 * because the client is not trustworthy.
 */

/** Matches `MAX_IMAGE_BYTES` in backend/src/services/cloudinary.ts. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Matches `MAX_AUDIO_BYTES` there. */
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
/** The recorder stops itself here, so a forgotten recording can't run away. */
export const MAX_VOICE_SECONDS = 120;

/** Reads a Blob or File into the `data:<mime>;base64,…` string the API wants. */
export function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

export function getConversations(signal?: AbortSignal): Promise<Conversation[]> {
  return api
    .get<{ conversations: Conversation[] }>('/api/messages/conversations', { signal })
    .then((r) => r.conversations);
}

/**
 * One thread's messages, oldest first, plus who the other person is.
 *
 * `canMessage` is the mutual-follow verdict, computed server-side. History is
 * always returned — losing the follow closes the composer, not the thread.
 */
export interface ThreadPayload {
  messages: DirectMessage[];
  user: PublicProfile;
  canMessage: boolean;
  /**
   * Whether read receipts are live for **this pair** — both sides opted in.
   *
   * Decided server-side, and the server also withholds `read` on your own
   * messages when it is false, so this is not the thing keeping the secret.
   * It exists so the client can render *nothing* rather than a greyed-out
   * tick: an indicator that is visibly disabled still tells you the other
   * person has receipts off, which is its own disclosure.
   */
  readReceipts: boolean;
}

export function getThread(userId: string, signal?: AbortSignal): Promise<ThreadPayload> {
  return api.get<ThreadPayload>(`/api/messages/${userId}`, { signal });
}

export function sendMessage(userId: string, text: string): Promise<DirectMessage> {
  return api
    .post<{ message: DirectMessage }>(`/api/messages/${userId}/send`, { text })
    .then((r) => r.message);
}

/**
 * Sends a photo.
 *
 * The size is checked on the decoded `File`, not on the encoded string —
 * base64 inflates by a third, so testing the data URL's length against 5MB
 * would quietly reject anything over 3.75MB.
 */
export async function sendPhoto(userId: string, file: File): Promise<DirectMessage> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('That photo is larger than 5MB');

  const media = await toDataUrl(file);
  const r = await api.post<{ message: DirectMessage }>(`/api/messages/${userId}/send`, {
    kind: 'image',
    media,
  });
  return r.message;
}

/**
 * Sends a recorded voice note.
 *
 * The duration the recorder measured is not sent: Cloudinary probes the file
 * and returns the real length, so a claimed one would only be a second source
 * of truth that could disagree with the audio the recipient actually hears.
 */
export async function sendVoiceNote(userId: string, clip: Blob): Promise<DirectMessage> {
  if (clip.size > MAX_VOICE_BYTES) throw new Error('That recording is too long');

  const media = await toDataUrl(clip);
  const r = await api.post<{ message: DirectMessage }>(`/api/messages/${userId}/send`, {
    kind: 'audio',
    media,
  });
  return r.message;
}

/** Marks everything they sent as read, clearing the badge. */
export function markThreadRead(userId: string): Promise<void> {
  return api.put(`/api/messages/${userId}/read`).then(() => undefined);
}

/* ---------------------------- edit and delete ----------------------------- */

/**
 * How long a message stays editable and retractable.
 *
 * Mirrors `EDIT_WINDOW_MS` / `DELETE_WINDOW_MS` in
 * backend/src/config/messaging.ts. Duplicated rather than fetched because the
 * menu has to decide whether to offer Edit *before* any request is made — but
 * it is only ever used to decide what to **show**. The server re-checks every
 * call and answers 403, so a stale constant here can at worst offer an action
 * that then fails honestly; it can never grant one.
 */
export const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Whether `message` is still inside the window, for menu-building only. */
export function withinWindow(createdAt: string, windowMs: number): boolean {
  return Date.now() - new Date(createdAt).getTime() <= windowMs;
}

/**
 * Whether the ⋯ menu should offer Edit.
 *
 * Text only, mine only, still in the window, and not already retracted — the
 * same four conditions the server checks, in the same order.
 */
export function canEdit(m: DirectMessage, myId: string | null): boolean {
  return (
    m.senderId === myId &&
    m.kind === 'text' &&
    !m.deletedForEveryone &&
    withinWindow(m.createdAt, EDIT_WINDOW_MS)
  );
}

/**
 * Whether the confirm sheet should offer "Delete for everyone".
 *
 * When this is false the sheet shows only "Delete for me" — never a disabled
 * ghost button, which advertises a capability the viewer does not have and
 * invites them to wonder why.
 */
export function canDeleteForEveryone(m: DirectMessage, myId: string | null): boolean {
  return (
    m.senderId === myId &&
    !m.deletedForEveryone &&
    withinWindow(m.createdAt, DELETE_WINDOW_MS)
  );
}

/**
 * Edits a message in place.
 *
 * Returns the server's copy rather than the text that was sent: an identical
 * edit is answered 200 with `editedAt` untouched, so trusting the local string
 * would paint an "edited" label the server does not agree with.
 */
export function editMessage(messageId: string, text: string): Promise<DirectMessage> {
  return api
    .patch<{ message: DirectMessage }>(`/api/messages/${messageId}`, { text })
    .then((r) => r.message);
}

export type DeleteScope = 'me' | 'everyone';

/**
 * Deletes a message, one way or the other.
 *
 * `scope` is required with no default, mirroring the API. The two outcomes are
 * not variations on each other — one changes what I see, the other destroys
 * content for somebody else — so there is no sensible value to guess, and a
 * caller that has not decided yet has no business calling this.
 *
 * Sent on the body rather than the query string so the scope cannot end up in
 * a proxy access log alongside the message id.
 */
export function deleteMessage(messageId: string, scope: DeleteScope): Promise<void> {
  return api.del(`/api/messages/${messageId}`, { body: { scope } }).then(() => undefined);
}

/** What a conversation-level clear reports back. */
export interface ClearResult {
  cleared: DeleteScope;
  /** Messages actually retracted. Always 0 for scope 'me'. */
  retracted: number;
  /** Mine that were past the window, so the UI can say so rather than
   *  appearing to have done less than it was asked. */
  skippedTooOld: number;
}

/**
 * Clears a whole conversation.
 *
 * A bulk application of the per-message rules, not a second kind of deletion.
 * `me` hides every message from this viewer and leaves the other copy alone;
 * `everyone` retracts **only my own** messages, and only those still inside
 * the delete window — so it does not empty the thread, which is why the UI
 * calls it "Delete my recent messages" rather than "clear for everyone".
 */
export function clearConversation(userId: string, scope: DeleteScope): Promise<ClearResult> {
  return api.del<ClearResult>(`/api/messages/${userId}/history`, { body: { scope } });
}
