import type { Request, Response } from 'express';

import { CatalogNotConfiguredError, type CatalogSummary } from '../services/catalogTypes';
import * as igdb from '../services/igdb';
import * as tmdb from '../services/tmdb';
import { fail, ok } from '../utils/http';
import { str } from '../utils/validation';

/**
 * The catalogue proxy.
 *
 * Everything the browser sees about films, series and games comes through
 * here, so the TMDB and IGDB credentials never leave the server and all three
 * sources arrive in one shape. Public: browsing doesn't require an account.
 */

/** A source without credentials is a setup problem, not a server fault. */
function handle(res: Response, err: unknown, what: string): Response {
  if (err instanceof CatalogNotConfiguredError) {
    return fail(
      res,
      err.source === 'igdb'
        ? 'Games are unavailable: IGDB credentials are not configured on this server.'
        : 'The catalogue is unavailable: TMDB credentials are not configured on this server.',
      503,
    );
  }
  console.error(`${what} error:`, err);
  return fail(res, `Could not load ${what}`, 502);
}

/** Interleaves rails so a mixed grid alternates rather than clumping by source. */
function interleave(...lists: CatalogSummary[][]): CatalogSummary[] {
  const out: CatalogSummary[] = [];
  const longest = Math.max(...lists.map((l) => l.length), 0);
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

/* ------------------------------- browsing -------------------------------- */

/**
 * GET /api/tmdb/trending — the home grid.
 *
 * Named for the default rail but carries the whole browse vocabulary:
 * `?type=` (movie|series|game), `?genre=`, `?sort=` (trending|popular|top).
 * With no type it blends films and series, and adds games when IGDB is
 * configured. A missing IGDB key drops games silently rather than failing the
 * whole grid — the rest of the catalogue still works.
 */
export async function trending(req: Request, res: Response): Promise<Response> {
  const type = str(req.query.type);
  const genre = str(req.query.genre);
  const sort = str(req.query.sort) || 'trending';

  try {
    // A genre filter goes through /discover, which is the only TMDB endpoint
    // that can filter a rail by genre.
    if (genre) {
      const genreId = tmdb.TMDB_GENRE_IDS[genre.toLowerCase()];
      if (!genreId) return ok(res, { items: [] });

      const sortBy =
        sort === 'top' ? 'vote_average.desc' : sort === 'popular' ? 'popularity.desc' : undefined;

      if (type === 'game') return ok(res, { items: [] });
      if (type === 'movie' || type === 'series') {
        const items = await tmdb.discover({ type, genreId, sort: sortBy, minScore: sort === 'top' ? 6 : undefined });
        return ok(res, { items });
      }

      const [films, series] = await Promise.all([
        tmdb.discover({ type: 'movie', genreId, sort: sortBy, minScore: sort === 'top' ? 6 : undefined }),
        tmdb.discover({ type: 'series', genreId, sort: sortBy, minScore: sort === 'top' ? 6 : undefined }),
      ]);
      return ok(res, { items: interleave(films, series) });
    }

    const pick = (t: 'movie' | 'series') =>
      sort === 'popular' ? tmdb.getPopular(t) : sort === 'top' ? tmdb.getTopRated(t) : tmdb.getTrending(t);

    if (type === 'game') {
      const items = sort === 'top' ? await igdb.getTopRatedGames() : await igdb.getPopularGames();
      return ok(res, { items });
    }
    if (type === 'movie' || type === 'series') {
      return ok(res, { items: await pick(type) });
    }

    const [films, series, games] = await Promise.all([
      pick('movie'),
      pick('series'),
      (sort === 'top' ? igdb.getTopRatedGames() : igdb.getPopularGames()).catch(() => []),
    ]);
    return ok(res, { items: interleave(films, series, games) });
  } catch (err) {
    return handle(res, err, 'the catalogue');
  }
}

/* -------------------------------- search --------------------------------- */

/** GET /api/tmdb/search?q=&type= — searches every source unless narrowed. */
export async function search(req: Request, res: Response): Promise<Response> {
  const q = str(req.query.q);
  const type = str(req.query.type);
  if (!q) return ok(res, { items: [] });

  try {
    if (type === 'game') return ok(res, { items: await igdb.searchGames(q) });
    if (type === 'movie' || type === 'series') {
      return ok(res, { items: await tmdb.search(q, type) });
    }

    const [screen, games] = await Promise.all([
      tmdb.search(q, 'all'),
      igdb.searchGames(q).catch(() => []),
    ]);
    return ok(res, { items: [...screen, ...games] });
  } catch (err) {
    return handle(res, err, 'search results');
  }
}

/** GET /api/igdb/search?q= — games only. */
export async function searchGames(req: Request, res: Response): Promise<Response> {
  const q = str(req.query.q);
  if (!q) return ok(res, { items: [] });
  try {
    return ok(res, { items: await igdb.searchGames(q) });
  } catch (err) {
    return handle(res, err, 'game search results');
  }
}

/* -------------------------------- detail --------------------------------- */

/** GET /api/tmdb/movie/:id */
export async function movieDetail(req: Request, res: Response): Promise<Response> {
  try {
    const item = await tmdb.getDetail(req.params.id, 'movie');
    if (!item) return fail(res, 'Not found', 404);
    return ok(res, { item });
  } catch (err) {
    return handle(res, err, 'this film');
  }
}

/** GET /api/tmdb/series/:id */
export async function seriesDetail(req: Request, res: Response): Promise<Response> {
  try {
    const item = await tmdb.getDetail(req.params.id, 'series');
    if (!item) return fail(res, 'Not found', 404);
    return ok(res, { item });
  } catch (err) {
    return handle(res, err, 'this series');
  }
}

/** GET /api/igdb/game/:id */
export async function gameDetail(req: Request, res: Response): Promise<Response> {
  try {
    const item = await igdb.getGame(req.params.id);
    if (!item) return fail(res, 'Not found', 404);
    return ok(res, { item });
  } catch (err) {
    return handle(res, err, 'this game');
  }
}
