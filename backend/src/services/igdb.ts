import { configured, env } from '../config/env';

import {
  CatalogNotConfiguredError,
  normaliseScore,
  type CatalogCredit,
  type CatalogDetail,
  type CatalogSummary,
} from './catalogTypes';

/**
 * IGDB client for the Games catalogue.
 *
 * IGDB authenticates with a Twitch app access token obtained from the client
 * id/secret, so there are two steps: mint (and cache) a token, then POST an
 * APIcalypse query to the endpoint. Tokens last ~60 days; we refresh a minute
 * before expiry rather than tracking it precisely.
 *
 * Queries are the APIcalypse DSL, not JSON — `fields a,b; where x = 1;`.
 */

const BASE = 'https://api.igdb.com/v4';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (!configured.igdb()) throw new CatalogNotConfiguredError('igdb');
  if (token && Date.now() < token.expiresAt) return token.value;

  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', env.igdbClientId);
  url.searchParams.set('client_secret', env.igdbClientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`IGDB auth failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(body.expires_in - 60, 60) * 1000,
  };
  return token.value;
}

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000;

async function igdb<T>(endpoint: string, query: string): Promise<T> {
  const key = `${endpoint}::${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T;

  const accessToken = await getToken();
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.igdbClientId,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    body: query,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`IGDB ${endpoint} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }

  const value = (await res.json()) as T;
  cache.set(key, { at: Date.now(), value });
  return value;
}

/* ------------------------------- mapping --------------------------------- */

/** IGDB image urls are templated by size slug. */
const img = (imageId: string | undefined | null, size: string) =>
  imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;

type RawGame = {
  id: number;
  name?: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number; // unix seconds
  total_rating?: number; // 0-100
  total_rating_count?: number;
  cover?: { image_id?: string };
  artworks?: { image_id?: string }[];
  screenshots?: { image_id?: string }[];
  genres?: { name?: string }[];
  age_ratings?: { rating?: number }[];
  involved_companies?: {
    developer?: boolean;
    publisher?: boolean;
    company?: { id?: number; name?: string; logo?: { image_id?: string } };
  }[];
  videos?: { video_id?: string }[];
  similar_games?: RawGame[];
};

const SUMMARY_FIELDS =
  'id,name,summary,first_release_date,total_rating,cover.image_id,genres.name';

const DETAIL_FIELDS =
  'id,name,summary,storyline,first_release_date,total_rating,total_rating_count,' +
  'cover.image_id,artworks.image_id,screenshots.image_id,genres.name,age_ratings.rating,' +
  'involved_companies.developer,involved_companies.publisher,involved_companies.company.id,' +
  'involved_companies.company.name,involved_companies.company.logo.image_id,videos.video_id,' +
  `similar_games.${SUMMARY_FIELDS.split(',').join(',similar_games.')}`;

function yearOf(unixSeconds: number | undefined): string | null {
  if (!unixSeconds) return null;
  return String(new Date(unixSeconds * 1000).getUTCFullYear());
}

function toSummary(g: RawGame): CatalogSummary {
  return {
    id: String(g.id),
    type: 'game',
    title: g.name || 'Untitled',
    year: yearOf(g.first_release_date),
    posterUrl: img(g.cover?.image_id, 'cover_big'),
    // IGDB rates 0-100; everything else in Velvet is 0-10.
    score: normaliseScore(typeof g.total_rating === 'number' ? g.total_rating / 10 : null),
    overview: g.summary || '',
    genres: (g.genres ?? []).map((x) => x.name).filter((n): n is string => Boolean(n)),
  };
}

/** IGDB age_ratings.rating is an enum id; these are the ESRB values we surface. */
const ESRB: Record<number, string> = {
  6: 'RP',
  7: 'EC',
  8: 'E',
  9: 'E10+',
  10: 'T',
  11: 'M',
  12: 'AO',
};

/* -------------------------------- queries -------------------------------- */

/** Popular games — IGDB has no "trending", so recent + highly rated stands in. */
export async function getPopularGames(): Promise<CatalogSummary[]> {
  const cutoff = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365 * 3;
  const games = await igdb<RawGame[]>(
    'games',
    `fields ${SUMMARY_FIELDS};` +
      ` where total_rating != null & total_rating_count > 20 & cover != null` +
      ` & first_release_date > ${cutoff};` +
      ' sort total_rating desc; limit 24;',
  );
  return games.map(toSummary);
}

export async function getTopRatedGames(): Promise<CatalogSummary[]> {
  const games = await igdb<RawGame[]>(
    'games',
    `fields ${SUMMARY_FIELDS};` +
      ' where total_rating != null & total_rating_count > 200 & cover != null;' +
      ' sort total_rating desc; limit 24;',
  );
  return games.map(toSummary);
}

export async function searchGames(query: string): Promise<CatalogSummary[]> {
  const q = query.trim();
  if (!q) return [];
  // Escape double quotes so a title containing one can't break out of the DSL string.
  const safe = q.replace(/"/g, '\\"');
  const games = await igdb<RawGame[]>(
    'games',
    `search "${safe}"; fields ${SUMMARY_FIELDS}; where cover != null; limit 24;`,
  );
  return games.map(toSummary);
}

export async function getGame(id: string): Promise<CatalogDetail | null> {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;

  const rows = await igdb<RawGame[]>('games', `fields ${DETAIL_FIELDS}; where id = ${numeric};`);
  const g = rows[0];
  if (!g) return null;

  const companies = g.involved_companies ?? [];
  const cast: CatalogCredit[] = companies
    .filter((c) => c.company?.name)
    .slice(0, 16)
    .map((c) => ({
      id: String(c.company?.id ?? c.company?.name),
      name: c.company!.name!,
      role: c.developer ? 'Developer' : c.publisher ? 'Publisher' : 'Studio',
      photoUrl: img(c.company?.logo?.image_id, 'thumb'),
    }));

  const certification =
    (g.age_ratings ?? [])
      .map((r) => (typeof r.rating === 'number' ? ESRB[r.rating] : undefined))
      .find((v): v is string => Boolean(v)) ?? null;

  const backdropId = g.artworks?.[0]?.image_id ?? g.screenshots?.[0]?.image_id;
  const video = g.videos?.[0]?.video_id;

  return {
    ...toSummary(g),
    // The storyline is longer and reads better on the detail hero when present.
    overview: g.summary || g.storyline || '',
    backdropUrl: img(backdropId, '1080p'),
    tagline: null,
    runtime: null,
    runtimeMinutes: null,
    certification,
    trailerUrl: video ? `https://www.youtube.com/watch?v=${video}` : null,
    voteCount: g.total_rating_count ?? 0,
    cast,
    similar: (g.similar_games ?? []).slice(0, 6).map(toSummary),
  };
}
