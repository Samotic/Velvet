'use client';

import { api } from './api';
import type { ContentType } from './contentTypes';

/**
 * The personalised feed client.
 *
 * §14: the API returns items only. There is deliberately no field here capable
 * of carrying a neighbour's id, name or similarity — the rail describes a
 * relationship ("your taste twin"), never a person.
 */

export type FeedStrategy = 'cf' | 'hybrid' | 'seeded' | 'cold';

export type RailKind =
  | 'taste_twin'
  | 'neighborhood'
  | 'co_occurrence'
  | 'genre'
  | 'watchlist'
  | 'popular';

export interface FeedItem {
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
  /** Why this card is here. Evidence, never an identity. */
  reason: string;
}

export interface Rail {
  id: string;
  title: string;
  reason: string;
  kind: RailKind;
  items: FeedItem[];
}

export interface FeedResponse {
  strategy: FeedStrategy;
  /** True only on the cold tier — the picker is the whole screen then. */
  needsSeeding: boolean;
  rails: Rail[];
  cached?: boolean;
  diagnostics?: {
    ratingCount: number;
    neighborCount?: number;
    candidateCount?: number;
    cfReady?: boolean;
    needs?: string | null;
  };
}

export function getFeed(opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<FeedResponse> {
  return api.get<FeedResponse>(`/api/feed${opts.refresh ? '?refresh=1' : ''}`, {
    signal: opts.signal,
  });
}

export interface SeedItem {
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
  raterCount: number;
}

export function getSeedGrid(signal?: AbortSignal): Promise<{ items: SeedItem[]; required: number }> {
  return api.get<{ items: SeedItem[]; required: number }>('/api/feed/seed', { signal });
}

export interface SeedRating {
  contentId: string;
  contentType: ContentType;
  value: number;
  title?: string;
  poster?: string | null;
}

/** Writes the picker's ratings and returns the first real feed in one round trip. */
export function submitSeedRatings(ratings: SeedRating[]): Promise<FeedResponse> {
  return api.post<FeedResponse>('/api/feed/seed', { ratings });
}

/**
 * "Not for me". Writes a 1.5 pseudo-rating into the matrix rather than a
 * hidden-ids list, so the dismissal improves recommendations rather than only
 * removing one card.
 */
export function dismissItem(item: {
  contentId: string;
  contentType: ContentType;
  title?: string;
}): Promise<void> {
  return api.post('/api/feed/dismiss', item).then(() => undefined);
}
