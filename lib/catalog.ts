'use client';

import { api } from './api';
import type {
  ActivityItem,
  CatalogDetail,
  CatalogSummary,
  ContentType,
} from './contentTypes';
import type { PublicProfile } from './authTypes';
import type { SortId, TypeFilterId } from './homeFilters';
import { typeParam } from './homeFilters';

/**
 * Reads against the catalogue and social endpoints.
 *
 * Every call goes through the backend rather than TMDB/IGDB directly: the keys
 * stay server-side, the three sources arrive already mapped into one shape,
 * and results can be blended with Velvet's own community scores.
 */

/* ------------------------------- browsing -------------------------------- */

export interface BrowseQuery {
  filter?: TypeFilterId;
  genre?: string | null;
  sort?: SortId;
  page?: number;
  signal?: AbortSignal;
}

function browseParams({ filter = 'all', genre, sort = 'trending', page }: BrowseQuery) {
  const params = new URLSearchParams();
  const type = typeParam(filter);
  if (type) params.set('type', type);
  if (genre) params.set('genre', genre);
  if (sort !== 'trending') params.set('sort', sort);
  if (page && page > 1) params.set('page', String(page));
  return params.toString();
}

/** The main grid. Public — works signed out. */
export function browse(query: BrowseQuery = {}): Promise<CatalogSummary[]> {
  const qs = browseParams(query);
  return api
    .get<{ items: CatalogSummary[] }>(`/api/tmdb/trending${qs ? `?${qs}` : ''}`, {
      auth: false,
      signal: query.signal,
    })
    .then((r) => r.items);
}

export function getTopRated(signal?: AbortSignal): Promise<CatalogSummary[]> {
  return api
    .get<{ items: CatalogSummary[] }>('/api/tmdb/trending?sort=top', { auth: false, signal })
    .then((r) => r.items);
}

/* -------------------------------- detail --------------------------------- */

/** One title, fully hydrated: cast, similar, trailer, certification. */
export function getDetail(
  type: ContentType,
  id: string,
  signal?: AbortSignal,
): Promise<CatalogDetail> {
  const path =
    type === 'game'
      ? `/api/igdb/game/${encodeURIComponent(id)}`
      : `/api/tmdb/${type}/${encodeURIComponent(id)}`;
  return api.get<{ item: CatalogDetail }>(path, { auth: false, signal }).then((r) => r.item);
}

/* -------------------------------- search --------------------------------- */

export function searchContent(
  q: string,
  opts: { type?: ContentType | null; signal?: AbortSignal } = {},
): Promise<CatalogSummary[]> {
  const params = new URLSearchParams({ q });
  if (opts.type) params.set('type', opts.type);
  return api
    .get<{ items: CatalogSummary[] }>(`/api/tmdb/search?${params}`, {
      auth: false,
      signal: opts.signal,
    })
    .then((r) => r.items);
}

export function searchPeople(q: string, signal?: AbortSignal): Promise<PublicProfile[]> {
  return api
    .get<{ users: PublicProfile[] }>(`/api/users/search?q=${encodeURIComponent(q)}`, { signal })
    .then((r) => r.users);
}

/* ---------------------------------- AI ----------------------------------- */

/** A pick carries the AI's one-line reason, shown on the card's hover tip. */
export interface AiPick {
  item: CatalogSummary;
  reason: string;
}

export function getAiPicks(signal?: AbortSignal): Promise<AiPick[]> {
  return api.get<{ picks: AiPick[] }>('/api/ai/picks', { signal }).then((r) => r.picks);
}

/* ------------------------------- activity -------------------------------- */

/** The feed of what people you follow have been watching. */
export function getActivityFeed(signal?: AbortSignal): Promise<ActivityItem[]> {
  return api.get<{ items: ActivityItem[] }>('/api/activity/feed', { signal }).then((r) => r.items);
}

export function getUserActivity(userId: string, signal?: AbortSignal): Promise<ActivityItem[]> {
  return api
    .get<{ items: ActivityItem[] }>(`/api/activity/user/${userId}`, { signal })
    .then((r) => r.items);
}
