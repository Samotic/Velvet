'use client';

import { api } from './api';
import type { Notification } from './contentTypes';
import { announceFollowChange, announceNotificationsChange } from './socialEvents';

export { onNotificationsChange, NOTIFICATIONS_CHANGED } from './socialEvents';

export interface FollowRequest {
  id: string;
  from: {
    id: string;
    username: string;
    displayName: string;
    profilePhoto: string | null;
    followerCount: number;
  };
  createdAt: string;
}

export interface FollowRequestPage {
  requests: FollowRequest[];
  total: number;
  nextCursor: string | null;
}

export function getFollowRequests(
  opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<FollowRequestPage> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  // The summary row needs a count and three faces, not a page of cards.
  if (opts.limit) params.set('limit', String(opts.limit));
  const query = params.toString();
  return api.get<FollowRequestPage>(`/api/users/me/follow-requests${query ? `?${query}` : ''}`, {
    signal: opts.signal,
  });
}

export async function acceptFollowRequest(userId: string): Promise<{ status: 'following' }> {
  const result = await api.post<{ status: 'following' }>(`/api/users/${userId}/accept-follow`);
  announceFollowChange();
  announceNotificationsChange();
  return result;
}

export async function declineFollowRequest(userId: string): Promise<{ status: 'declined' }> {
  const result = await api.post<{ status: 'declined' }>(`/api/users/${userId}/decline-follow`);
  announceFollowChange();
  announceNotificationsChange();
  return result;
}

/**
 * The notifications and follow-request client.
 *
 * Every card the API returns already carries its actor's identity and the
 * viewer's relationship to them, so nothing here fans out a second request per
 * row — that N+1 is what the batched server response exists to prevent.
 */

export interface NotificationPage {
  notifications: Notification[];
  unread: number;
  /** Pass back as `cursor` for the next page. Null when there are no more. */
  nextCursor: string | null;
}

export function getNotifications(
  opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return api.get<NotificationPage>(`/api/notifications${qs ? `?${qs}` : ''}`, {
    signal: opts.signal,
  });
}

/** Cheap enough for the bell's polling loop; returns only the number. */
export function getUnreadCount(signal?: AbortSignal): Promise<number> {
  return api.get<{ unread: number }>('/api/notifications/count', { signal }).then((r) => r.unread);
}

/** Marks the given ids read, or everything when `ids` is omitted. */
export function markNotificationsRead(ids?: string[]): Promise<number> {
  return api
    .post<{ unread: number }>('/api/notifications/read', ids ? { ids } : {})
    .then((r) => {
      announceNotificationsChange();
      return r.unread;
    });
}

export type RequestOutcome = 'accepted' | 'declined';

/**
 * Accept or decline a follow request.
 *
 * `followRequestId` is the Follow edge's id. The server re-checks that the
 * caller is that edge's target — the id alone authorises nothing.
 */
export function respondToRequest(
  followRequestId: string,
  action: RequestOutcome,
): Promise<{ status: RequestOutcome }> {
  const verb = action === 'accepted' ? 'accept' : 'decline';
  return api.post<{ status: RequestOutcome }>(`/api/follow-requests/${followRequestId}/${verb}`)
    .then((result) => {
      announceFollowChange();
      announceNotificationsChange();
      return result;
    });
}
