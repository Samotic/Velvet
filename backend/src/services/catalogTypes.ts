import type { ContentType } from '../models/User';

/**
 * The one shape the frontend consumes for every catalogue kind. TMDB films,
 * TMDB series and IGDB games all map into this, so a poster grid never has to
 * know which source a row came from.
 */
export interface CatalogSummary {
  id: string;
  type: ContentType;
  title: string;
  year: string | null;
  posterUrl: string | null;
  /** 0-10, one decimal. Null when the source has no score yet. */
  score: number | null;
  overview: string;
  genres: string[];
}

export interface CatalogDetail extends CatalogSummary {
  backdropUrl: string | null;
  tagline: string | null;
  /** Human label, e.g. "2h 46m" for film, "3 seasons" for series. */
  runtime: string | null;
  /** Raw minutes behind `runtime`; null for games and series. Recorded on a
   *  rating so watch-hour totals can be derived. */
  runtimeMinutes: number | null;
  /** US content rating for film/series, age rating for games. */
  certification: string | null;
  trailerUrl: string | null;
  /** Source vote count, shown next to the source score. */
  voteCount: number;
  cast: CatalogCredit[];
  similar: CatalogSummary[];
}

export interface CatalogCredit {
  id: string;
  name: string;
  /** Character for film/series; developer role for games. */
  role: string;
  photoUrl: string | null;
}

/** Thrown when the source's credentials are absent — the route answers 503. */
export class CatalogNotConfiguredError extends Error {
  constructor(public source: 'tmdb' | 'igdb') {
    super(`${source.toUpperCase()} credentials are not configured`);
    this.name = 'CatalogNotConfiguredError';
  }
}

export function runtimeLabel(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Source scores are 0-10; the design shows one decimal everywhere. */
export function normaliseScore(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || value <= 0) return null;
  return Math.round(value * 10) / 10;
}

/**
 * Artwork the advisor attaches to a reply.
 *
 * Not generated — resolved. The advisor recommends titles as `[[Title]]`
 * markers, the reply already gets searched against the catalogue to turn those
 * into links, and the poster is sitting unused in that same search response.
 * So this costs no model call and no extra catalogue call: it is a field that
 * was already fetched and thrown away.
 *
 * Carried as its own array on the message rather than inside the prose. The
 * text may stream one day; this cannot, because it needs the completed reply
 * to know which titles were named. Keeping them separate means the client
 * never has to parse half-arrived markdown for a URL.
 */
export interface AdvisorMedia {
  /** The catalogue pair, same as everywhere else. */
  contentId: string;
  contentType: ContentType;
  title: string;
  /** A TMDB or IGDB CDN URL. Never ours, never proxied. */
  url: string;
  /**
   * What the image is. Only `poster` today.
   *
   * `backdrop` is deliberately absent rather than optional-and-unimplemented:
   * `search()` returns a `CatalogSummary`, which has no backdrop — that lives
   * on `CatalogDetail`, behind one extra request per title. Adding it is a cost
   * decision, so the field names the kind and the shape is ready when someone
   * takes it.
   */
  kind: 'poster';
  /**
   * Width ÷ height, so the client can reserve the box before the bytes land.
   *
   * A ratio rather than pixel dimensions because the search response carries no
   * dimensions — writing width and height here would mean inventing numbers.
   * The ratio is a fixed convention per source and is not a guess.
   */
  aspect: number;
}

/** TMDB posters are a fixed 2:3. */
export const POSTER_ASPECT = 2 / 3;
