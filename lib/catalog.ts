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

/**
 * Detail reads are the slowest thing in the app — our API, then TMDB or IGDB,
 * then back — and they're the ones sitting between a click and the screen. So
 * they're cached, shared and prefetchable:
 *
 * - `prefetchDetail` on hover starts the fetch while the cursor is still
 *   travelling, which is usually enough to finish before the click lands.
 * - Concurrent callers share one in-flight request, so a hover already running
 *   is the request the click reuses rather than a second one.
 * - The result is held briefly, so going back and forward between a grid and a
 *   title is instant.
 *
 * The shared fetch deliberately ignores abort signals: a prefetch that outlives
 * its hover should still finish and fill the cache. Callers still get their own
 * cancellation — `getDetail` races the shared promise against the signal.
 */

const DETAIL_TTL = 5 * 60 * 1000;
const DETAIL_MAX = 60;

const detailCache = new Map<string, { at: number; value: CatalogDetail }>();
const detailInflight = new Map<string, Promise<CatalogDetail>>();

const detailPath = (type: ContentType, id: string) =>
  type === 'game'
    ? `/api/igdb/game/${encodeURIComponent(id)}`
    : `/api/tmdb/${type}/${encodeURIComponent(id)}`;

function loadDetail(type: ContentType, id: string): Promise<CatalogDetail> {
  const k = `${type}:${id}`;

  const hit = detailCache.get(k);
  if (hit && Date.now() - hit.at < DETAIL_TTL) return Promise.resolve(hit.value);

  const running = detailInflight.get(k);
  if (running) return running;

  const p = api
    .get<{ item: CatalogDetail }>(detailPath(type, id), { auth: false })
    .then((r) => {
      detailInflight.delete(k);
      detailCache.set(k, { at: Date.now(), value: r.item });
      // Bounded so a long browse doesn't retain every title of the session.
      if (detailCache.size > DETAIL_MAX) {
        const oldest = detailCache.keys().next().value;
        if (oldest !== undefined) detailCache.delete(oldest);
      }
      return r.item;
    })
    .catch((err) => {
      detailInflight.delete(k);
      throw err;
    });

  detailInflight.set(k, p);
  return p;
}

/** One title, fully hydrated: cast, similar, trailer, certification. */
export function getDetail(
  type: ContentType,
  id: string,
  signal?: AbortSignal,
): Promise<CatalogDetail> {
  const shared = loadDetail(type, id);
  if (!signal) return shared;

  // The caller's view of the shared fetch, cancellable without cancelling it.
  return new Promise<CatalogDetail>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    shared.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', abort);
        reject(err);
      },
    );
  });
}

/**
 * Starts a title's fetch without waiting for it. Called on poster hover and
 * focus; failures are swallowed because nothing is showing yet — the real
 * navigation will surface any error itself.
 */
export function prefetchDetail(type: ContentType, id: string): void {
  void loadDetail(type, id).catch(() => {});
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
