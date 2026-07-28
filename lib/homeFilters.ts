/**
 * The home screen's filter and sort vocabulary.
 *
 * Lives here rather than in the FilterBar component because both the server
 * page and the client tab row need it — importing plain data out of a
 * `'use client'` module hands the server a client reference proxy, not the
 * array, and that throws at request time rather than build time.
 */

import type { ContentType } from './contentTypes';

/** The type tabs: All / Movies / Series / Games. */
export const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'movies', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'games', label: 'Games' },
] as const;

export type TypeFilterId = (typeof TYPE_FILTERS)[number]['id'];

/** The genre tabs that sit after the type tabs. */
export const GENRE_FILTERS = [
  'Action',
  'Drama',
  'Comedy',
  'Thriller',
  'Sci-Fi',
  'Horror',
  'Romance',
  'Animation',
] as const;

export const SORTS = [
  { id: 'trending', label: 'Trending' },
  { id: 'popular', label: 'Popular' },
  { id: 'top', label: 'Top Rated' },
] as const;

export type SortId = (typeof SORTS)[number]['id'];

export const isTypeFilter = (v: string): v is TypeFilterId => TYPE_FILTERS.some((f) => f.id === v);

export const isGenreFilter = (v: string): boolean =>
  (GENRE_FILTERS as readonly string[]).includes(v);

export const isSort = (v: string): v is SortId => SORTS.some((s) => s.id === v);

/** Maps a type tab to the catalogue kind the API expects. `all` sends none. */
export const typeParam = (filter: TypeFilterId): ContentType | null => {
  if (filter === 'movies') return 'movie';
  if (filter === 'series') return 'series';
  if (filter === 'games') return 'game';
  return null;
};
