'use client';

import { api } from './api';
import type { PublicProfile } from './authTypes';
import type { Review, WatchlistItem, WatchStats } from './contentTypes';
import { announceFollowChange } from './socialEvents';

export { onFollowChange } from './socialEvents';

/** Public profiles, follows and follower lists. */

export function getProfile(username: string, signal?: AbortSignal): Promise<PublicProfile> {
  return api
    .get<{ user: PublicProfile }>(`/api/users/${encodeURIComponent(username)}`, { signal })
    .then((r) => r.user);
}

export function getFollowers(userId: string, signal?: AbortSignal): Promise<PublicProfile[]> {
  return api
    .get<{ users: PublicProfile[] }>(`/api/users/${userId}/followers`, { signal })
    .then((r) => r.users);
}

export function getFollowing(userId: string, signal?: AbortSignal): Promise<PublicProfile[]> {
  return api
    .get<{ users: PublicProfile[] }>(`/api/users/${userId}/following`, { signal })
    .then((r) => r.users);
}

/** Only an approved request is an accepted follow. */
export type FollowStatus = 'accepted' | 'pending';

/**
 * Sends an approval request. The result decides the button's next label:
 * `accepted` → "Following", `pending` → "Requested".
 *
 * Idempotent server-side, so a double-tap resolves to the same state rather
 * than erroring.
 */
export function followUser(userId: string): Promise<FollowStatus> {
  return api.post<{ status: 'requested' | 'following' }>(`/api/users/${userId}/follow-request`)
    .then((r) => {
      announceFollowChange();
      return r.status === 'following' ? 'accepted' : 'pending';
    });
}

/** Unfollow, or withdraw a pending request — the same call either way. */
export function unfollowUser(userId: string): Promise<void> {
  return api.del(`/api/users/${userId}/follow`).then(() => announceFollowChange());
}

/** Severs the relationship in both directions and hides each from the other. */
export function blockUser(userId: string): Promise<void> {
  return api.post(`/api/users/${userId}/block`).then(() => announceFollowChange());
}

export function unblockUser(userId: string): Promise<void> {
  return api.del(`/api/users/${userId}/block`).then(() => undefined);
}

/** Everything the profile screen's tabs need, in one call per tab. */
export function getProfileRatings(userId: string, signal?: AbortSignal): Promise<Review[]> {
  return api.get<{ ratings: Review[] }>(`/api/ratings/user/${userId}`, { signal }).then((r) => r.ratings);
}

export function getProfileWatchlist(userId: string, signal?: AbortSignal): Promise<WatchlistItem[]> {
  return api
    .get<{ items: WatchlistItem[] }>(`/api/watchlist?userId=${userId}`, { signal })
    .then((r) => r.items);
}

export function getProfileStats(userId: string, signal?: AbortSignal): Promise<WatchStats> {
  return api.get<WatchStats>(`/api/activity/user/${userId}/stats`, { signal });
}
