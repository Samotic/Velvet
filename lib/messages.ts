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
export function getThread(
  userId: string,
  signal?: AbortSignal,
): Promise<{ messages: DirectMessage[]; user: PublicProfile; canMessage: boolean }> {
  return api.get<{ messages: DirectMessage[]; user: PublicProfile; canMessage: boolean }>(
    `/api/messages/${userId}`,
    { signal },
  );
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
