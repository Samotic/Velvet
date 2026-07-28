'use client';

import { api } from './api';
import type { Conversation, DirectMessage } from './contentTypes';
import type { PublicProfile } from './authTypes';

/** Text-only direct messaging. No media, no calls. */

export function getConversations(signal?: AbortSignal): Promise<Conversation[]> {
  return api
    .get<{ conversations: Conversation[] }>('/api/messages/conversations', { signal })
    .then((r) => r.conversations);
}

/** One thread's messages, oldest first, plus who the other person is. */
export function getThread(
  userId: string,
  signal?: AbortSignal,
): Promise<{ messages: DirectMessage[]; user: PublicProfile }> {
  return api.get<{ messages: DirectMessage[]; user: PublicProfile }>(
    `/api/messages/${userId}`,
    { signal },
  );
}

export function sendMessage(userId: string, text: string): Promise<DirectMessage> {
  return api
    .post<{ message: DirectMessage }>(`/api/messages/${userId}/send`, { text })
    .then((r) => r.message);
}

/** Marks everything they sent as read, clearing the badge. */
export function markThreadRead(userId: string): Promise<void> {
  return api.put(`/api/messages/${userId}/read`).then(() => undefined);
}
