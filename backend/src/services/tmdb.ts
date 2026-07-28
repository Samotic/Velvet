import { configured, env } from '../config/env';

import {
  CatalogNotConfiguredError,
  normaliseScore,
  runtimeLabel,
  type CatalogCredit,
  type CatalogDetail,
  type CatalogSummary,
} from './catalogTypes';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

/**
 * Server-side TMDB client covering both films and series.
 *
 * Supports both auth styles: the v4 read token (Bearer header, preferred) and
 * the v3 api_key query param. Responses are cached in-process for a short TTL
 * because the home screen hits trending on every render and TMDB rate-limits.
 */

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!configured.tmdb()) throw new CatalogNotConfiguredError('tmdb');

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!env.tmdbReadToken && env.tmdbApiKey) url.searchParams.set('api_key', env.tmdbApiKey);

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T;

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(env.tmdbReadToken ? { authorization: `Bearer ${env.tmdbReadToken}` } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TMDB ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }

  const value = (await res.json()) as T;
  cache.set(key, { at: Date.now(), value });
  return value;
}

/* ------------------------------- mapping --------------------------------- */

const img = (p: string | null | undefined, size: string) => (p ? `${IMG}/${size}${p}` : null);

const year = (date: string | null | undefined) =>
  date && date.length >= 4 ? date.slice(0, 4) : null;

type RawItem = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  overview?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  media_type?: string;
};

/**
 * TMDB list endpoints return genre *ids*; detail endpoints return genre
 * *objects*. This table lets a summary carry real genre names either way, which
 * matters because the home screen's genre chips filter on the name.
 */
const GENRE_NAMES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  // series-specific ids
  10759: 'Action',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War',
};

function genresOf(m: RawItem): string[] {
  if (m.genres?.length) return m.genres.map((g) => g.name);
  return (m.genre_ids ?? []).map((id) => GENRE_NAMES[id]).filter((n): n is string => Boolean(n));
}

function toSummary(m: RawItem, type: 'movie' | 'series'): CatalogSummary {
  return {
    id: String(m.id),
    type,
    title: m.title || m.name || 'Untitled',
    year: year(m.release_date || m.first_air_date),
    posterUrl: img(m.poster_path, 'w342'),
    score: normaliseScore(m.vote_average),
    overview: m.overview || '',
    genres: genresOf(m),
  };
}

/** TMDB genre ids for the genre chips, keyed by the slug the frontend sends. */
export const TMDB_GENRE_IDS: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  fantasy: 14,
  history: 36,
  horror: 27,
  mystery: 9648,
  romance: 10749,
  'sci-fi': 878,
  thriller: 53,
};

/* -------------------------------- queries -------------------------------- */

export async function getTrending(type: 'movie' | 'series' = 'movie'): Promise<CatalogSummary[]> {
  const path = type === 'series' ? '/trending/tv/week' : '/trending/movie/week';
  const data = await tmdb<{ results: RawItem[] }>(path);
  return data.results.map((m) => toSummary(m, type));
}

export async function getPopular(type: 'movie' | 'series' = 'movie'): Promise<CatalogSummary[]> {
  const path = type === 'series' ? '/tv/popular' : '/movie/popular';
  const data = await tmdb<{ results: RawItem[] }>(path, { page: '1' });
  return data.results.map((m) => toSummary(m, type));
}

export async function getTopRated(type: 'movie' | 'series' = 'movie'): Promise<CatalogSummary[]> {
  const path = type === 'series' ? '/tv/top_rated' : '/movie/top_rated';
  const data = await tmdb<{ results: RawItem[] }>(path, { page: '1' });
  return data.results.map((m) => toSummary(m, type));
}

export async function search(
  query: string,
  type: 'movie' | 'series' | 'all' = 'all',
): Promise<CatalogSummary[]> {
  const q = query.trim();
  if (!q) return [];

  if (type === 'movie' || type === 'series') {
    const path = type === 'series' ? '/search/tv' : '/search/movie';
    const data = await tmdb<{ results: RawItem[] }>(path, {
      query: q,
      include_adult: 'false',
      page: '1',
    });
    return data.results.map((m) => toSummary(m, type));
  }

  // `all` uses the multi endpoint and drops the `person` results, which have no
  // poster or score and would render as empty cards.
  const data = await tmdb<{ results: RawItem[] }>('/search/multi', {
    query: q,
    include_adult: 'false',
    page: '1',
  });
  return data.results
    .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
    .map((m) => toSummary(m, m.media_type === 'tv' ? 'series' : 'movie'));
}

/** Genre-filtered discovery, used by the home rails and the search sidebar. */
export async function discover(opts: {
  type: 'movie' | 'series';
  genreId?: number;
  yearFrom?: number;
  yearTo?: number;
  minScore?: number;
  sort?: string;
}): Promise<CatalogSummary[]> {
  const params: Record<string, string> = {
    page: '1',
    include_adult: 'false',
    sort_by: opts.sort || 'popularity.desc',
  };
  if (opts.genreId) params.with_genres = String(opts.genreId);
  if (opts.minScore) params['vote_average.gte'] = String(opts.minScore);

  if (opts.type === 'movie') {
    if (opts.yearFrom) params['primary_release_date.gte'] = `${opts.yearFrom}-01-01`;
    if (opts.yearTo) params['primary_release_date.lte'] = `${opts.yearTo}-12-31`;
  } else {
    if (opts.yearFrom) params['first_air_date.gte'] = `${opts.yearFrom}-01-01`;
    if (opts.yearTo) params['first_air_date.lte'] = `${opts.yearTo}-12-31`;
  }

  const path = opts.type === 'series' ? '/discover/tv' : '/discover/movie';
  const data = await tmdb<{ results: RawItem[] }>(path, params);
  return data.results.map((m) => toSummary(m, opts.type));
}

type RawDetail = RawItem & {
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number;
  tagline?: string | null;
  vote_count?: number;
  videos?: { results: { key: string; site: string; type: string; official: boolean }[] };
  credits?: {
    cast: { id: number; name: string; character?: string; roles?: { character: string }[]; profile_path?: string | null }[];
  };
  aggregate_credits?: {
    cast: { id: number; name: string; roles?: { character: string }[]; profile_path?: string | null }[];
  };
  release_dates?: {
    results: { iso_3166_1: string; release_dates: { certification: string }[] }[];
  };
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
  similar?: { results: RawItem[] };
  recommendations?: { results: RawItem[] };
};

export async function getDetail(
  id: string,
  type: 'movie' | 'series',
): Promise<CatalogDetail | null> {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;

  const isMovie = type === 'movie';
  const append = isMovie
    ? 'videos,credits,release_dates,similar,recommendations'
    : 'videos,aggregate_credits,content_ratings,similar,recommendations';

  let data: RawDetail;
  try {
    data = await tmdb<RawDetail>(`/${isMovie ? 'movie' : 'tv'}/${numeric}`, {
      append_to_response: append,
    });
  } catch (err) {
    if (err instanceof CatalogNotConfiguredError) throw err;
    // A bad id surfaces as a 404 from TMDB — treat as "not found", not a crash.
    if (err instanceof Error && err.message.includes('404')) return null;
    throw err;
  }

  const trailer =
    data.videos?.results.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ??
    data.videos?.results.find((v) => v.site === 'YouTube' && v.type === 'Trailer');

  const certification = isMovie
    ? (data.release_dates?.results
        .find((r) => r.iso_3166_1 === 'US')
        ?.release_dates.map((d) => d.certification)
        .find((c) => c && c.trim()) ?? null)
    : (data.content_ratings?.results.find((r) => r.iso_3166_1 === 'US')?.rating || null);

  const rawCast = isMovie ? data.credits?.cast : data.aggregate_credits?.cast;
  const cast: CatalogCredit[] = (rawCast ?? []).slice(0, 16).map((c) => {
    // Films put the character on `character`; series aggregate credits nest it
    // under `roles[]`. Read the field directly rather than narrowing with `in`
    // — on a union where only one arm declares the property, that narrowing
    // widens the value to `unknown` and the whole expression collapses to `{}`.
    const direct = (c as { character?: unknown }).character;
    return {
      id: String(c.id),
      name: c.name,
      role: (typeof direct === 'string' ? direct : '') || c.roles?.[0]?.character || '',
      photoUrl: img(c.profile_path, 'w185'),
    };
  });

  // Series have no single runtime; the seasons count is the useful analogue.
  const runtimeMinutes = isMovie ? (data.runtime ?? null) : (data.episode_run_time?.[0] ?? null);
  const runtime = isMovie
    ? runtimeLabel(data.runtime)
    : data.number_of_seasons
      ? `${data.number_of_seasons} season${data.number_of_seasons === 1 ? '' : 's'}`
      : runtimeLabel(runtimeMinutes);

  // `similar` is often thin or empty; recommendations fill the row.
  const similarRaw = [...(data.similar?.results ?? []), ...(data.recommendations?.results ?? [])];
  const seen = new Set<number>();
  const similar = similarRaw
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .slice(0, 6)
    .map((m) => toSummary(m, type));

  return {
    ...toSummary(data, type),
    backdropUrl: img(data.backdrop_path, 'w1280'),
    tagline: data.tagline || null,
    runtime,
    runtimeMinutes,
    certification,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    voteCount: data.vote_count ?? 0,
    cast,
    similar,
  };
}
