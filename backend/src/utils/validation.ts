/** Input validators shared by the controllers. Mirrored on the frontend so the
 *  same rules apply on both sides (spec: validate on BOTH ends). */

import { Types } from 'mongoose';

import { CONTENT_TYPES, GENDERS, MOODS, type ContentType, type Gender, type Mood } from '../models/User';

// Pragmatic email check — not RFC-perfect, but rejects the obvious mistakes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && EMAIL_RE.test(v.trim());

export const isUsername = (v: unknown): v is string =>
  typeof v === 'string' && USERNAME_RE.test(v.trim());

export const isValidPassword = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 8;

export const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/** Escapes a string so it can be used literally inside a RegExp. */
export const escapeRegex = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* --------------------------- onboarding fields ---------------------------- */

/** 13 is the floor the spec sets on the age step. */
export const isValidAge = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 13 && v <= 120;

export const isGender = (v: unknown): v is Gender =>
  typeof v === 'string' && (GENDERS as string[]).includes(v);

export const isMood = (v: unknown): v is Mood =>
  typeof v === 'string' && (MOODS as readonly string[]).includes(v);

export const isContentType = (v: unknown): v is ContentType =>
  typeof v === 'string' && (CONTENT_TYPES as string[]).includes(v);

/** The taste step requires at least three genres. */
export const MIN_GENRES = 3;

/** Normalises a genre array: strings only, trimmed, de-duplicated, capped. */
export function cleanGenres(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const g of v) {
    if (typeof g !== 'string') continue;
    const t = g.trim();
    if (t) seen.add(t);
  }
  return [...seen].slice(0, 30);
}

/* -------------------------------- misc ----------------------------------- */

export const isObjectId = (v: unknown): v is string =>
  typeof v === 'string' && Types.ObjectId.isValid(v);

/** A 1-5 star rating. */
export const isRatingValue = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * Reads `limit` / `page` query params into a safe skip/limit pair.
 * Defaults to 30 per page, hard-capped at 100 so a client can't ask for
 * everything at once.
 */
export function pageParams(
  query: Record<string, unknown>,
  defaultLimit = 30,
): { limit: number; skip: number; page: number } {
  const rawLimit = Number(query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : defaultLimit;

  const rawPage = Number(query.page);
  const page = Number.isFinite(rawPage) && rawPage > 1 ? Math.floor(rawPage) : 1;

  return { limit, skip: (page - 1) * limit, page };
}

/** First query-string value, whatever Express handed us. */
export function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return '';
}
