'use client';

import { api } from './api';
import type {
  ContentType,
  RatingSummary,
  Review,
  WatchStats,
  WatchStatus,
  WatchlistItem,
} from './contentTypes';

/**
 * The current user's library: ratings, reviews and watchlist.
 *
 * This module is the only place the UI talks to the rating/watchlist
 * endpoints. It used to be the only place that touched localStorage — the
 * seam held, so moving to the server changed these bodies and nothing else
 * about how screens are structured.
 *
 * Writes broadcast `LIBRARY_CHANGED` so any open screen re-reads. Rating a
 * film on a detail page updates the poster badge on the home grid behind it
 * without a route change or a refetch-everything.
 */

/** Fired after any successful write. */
export const LIBRARY_CHANGED = 'velvet:library-changed';

function announce() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LIBRARY_CHANGED));
  }
}

/**
 * Subscribes to library changes, shaped for `useEffect` cleanup. Fires the
 * handler once immediately so callers get their initial read for free:
 *
 *   useEffect(() => onLibraryChange(load), [load]);
 */
export function onLibraryChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  handler();
  window.addEventListener(LIBRARY_CHANGED, handler);
  return () => window.removeEventListener(LIBRARY_CHANGED, handler);
}

/* -------------------------------- ratings -------------------------------- */

export interface RateInput {
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  poster: string | null;
  /** 1-5. */
  rating: number;
  review?: string;
  /** Recorded at rate time so watch-hour totals stay honest for old rows. */
  runtimeMinutes?: number | null;
  genres?: string[];
}

/** Creates or updates the signed-in user's rating for a title. */
export async function saveRating(input: RateInput): Promise<Review> {
  const { rating } = await api.post<{ rating: Review }>('/api/ratings', input);
  announce();
  return rating;
}

/** The signed-in user's own rating for one title, or null if unrated. */
export async function getMyRating(
  contentId: string,
  contentType: ContentType,
): Promise<Review | null> {
  const { rating } = await api.get<{ rating: Review | null }>(
    `/api/ratings/content/${contentType}/${encodeURIComponent(contentId)}/me`,
  );
  return rating;
}

/** Community score, count and star distribution for a title. */
export function getRatingSummary(
  contentId: string,
  contentType: ContentType,
): Promise<RatingSummary> {
  return api.get<RatingSummary>(
    `/api/ratings/content/${contentType}/${encodeURIComponent(contentId)}`,
  );
}

/** Every rating a user has left, newest first. */
export function getUserRatings(userId: string): Promise<Review[]> {
  return api.get<{ ratings: Review[] }>(`/api/ratings/user/${userId}`).then((r) => r.ratings);
}

/* -------------------------------- reviews -------------------------------- */

export type ReviewSort = 'recent' | 'liked';

export function getReviews(
  contentId: string,
  contentType: ContentType,
  sort: ReviewSort = 'recent',
): Promise<Review[]> {
  return api
    .get<{ reviews: Review[] }>(
      `/api/reviews/content/${contentType}/${encodeURIComponent(contentId)}?sort=${sort}`,
    )
    .then((r) => r.reviews);
}

/** Toggles a like. Returns the review's new like state and count. */
export async function toggleReviewLike(
  reviewId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const result = await api.post<{ liked: boolean; likeCount: number }>(
    `/api/reviews/${reviewId}/like`,
  );
  announce();
  return result;
}

export async function replyToReview(reviewId: string, text: string): Promise<Review> {
  const { review } = await api.post<{ review: Review }>(`/api/reviews/${reviewId}/reply`, {
    text,
  });
  announce();
  return review;
}

/* ------------------------------- watchlist ------------------------------- */

export interface WatchlistInput {
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  poster: string | null;
  year: string | null;
  status?: WatchStatus;
}

export function getWatchlist(status?: WatchStatus): Promise<WatchlistItem[]> {
  const qs = status ? `?status=${status}` : '';
  return api.get<{ items: WatchlistItem[] }>(`/api/watchlist${qs}`).then((r) => r.items);
}

export async function addToWatchlist(input: WatchlistInput): Promise<WatchlistItem> {
  const { item } = await api.post<{ item: WatchlistItem }>('/api/watchlist', input);
  announce();
  return item;
}

export async function updateWatchlistItem(
  id: string,
  patch: { status?: WatchStatus; progressPercent?: number },
): Promise<WatchlistItem> {
  const { item } = await api.put<{ item: WatchlistItem }>(`/api/watchlist/${id}`, patch);
  announce();
  return item;
}

export async function removeFromWatchlist(id: string): Promise<void> {
  await api.del(`/api/watchlist/${id}`);
  announce();
}

/**
 * Adds if absent, removes if present. Returns the resulting saved state, so a
 * button can flip without refetching the whole list.
 *
 * The server owns the decision — sending the add and letting it answer "already
 * there" would race with a second tab.
 */
export async function toggleWatchlist(input: WatchlistInput): Promise<boolean> {
  const { saved } = await api.post<{ saved: boolean }>('/api/watchlist/toggle', input);
  announce();
  return saved;
}

/* --------------------------------- stats --------------------------------- */

/**
 * The figures behind the home stat strip and the profile stats section.
 *
 * Derived server-side from real ratings. Zero is a real value and renders as
 * "0"; the em-dash placeholder is only for figures that genuinely don't exist
 * yet, such as an average with nothing rated. The design's demo numbers
 * (247 / 618 / 3.8) are never substituted.
 */
export function getWatchStats(userId?: string): Promise<WatchStats> {
  return api.get<WatchStats>(userId ? `/api/activity/user/${userId}/stats` : '/api/ratings/stats');
}
