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
