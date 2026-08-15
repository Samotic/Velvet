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

/* ------------------------- user-authored free text ------------------------ */

/**
 * Everything a user types that another user will read goes through here:
 * reviews, review replies, messages, advisor prompts, bios, display names.
 *
 * ── Why, given React already escapes ──
 * It does, and there is no `dangerouslySetInnerHTML` anywhere in the app, so a
 * stored `<script>` cannot execute in the current client. That is one renderer's
 * behaviour, not a property of the data. The moment this text reaches something
 * that is not React — an email body, an export, a future native client, a
 * webhook — the escaping is gone and the payload is live. Storing it clean means
 * the safety travels with the data instead of depending on the reader.
 *
 * ── What it does, in order ──
 * Order matters. Tags are removed only after script/style bodies are gone, or
 * `<script>alert(1)</script>` would shed its tags and leave `alert(1)` sitting
 * in the text as though the user had typed it.
 */

/** C0/C1 controls, minus the whitespace people legitimately type. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Zero-width and bidi-override characters — invisible, and used for spoofing. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * Elements whose *content* is dangerous, not just their tags. Matched with an
 * optional closing tag so an unterminated `<script>foo` is caught too.
 */
const ACTIVE_ELEMENTS = /<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?(?:<\/\s*\1\s*>|$)/gi;

/** Any remaining tag, including malformed ones. Inner text is kept. */
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>/g;

/** HTML comments, which can hide conditional-comment payloads. */
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

/** URI schemes that execute. `data:` is included for `data:text/html`. */
const ACTIVE_URI = /\b(?:javascript|vbscript|livescript|mocha|data)\s*:/gi;

/** Inline event handlers, in case a tag was written without angle brackets. */
const INLINE_HANDLER = /\bon[a-z]{3,}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/** More than two consecutive newlines is layout abuse, not paragraphing. */
const EXCESS_NEWLINES = /\n{3,}/g;

export interface SanitizedText {
  /** Safe to store and to render anywhere, escaped or not. */
  text: string;
  /** True when sanitising actually removed something. */
  modified: boolean;
}

/**
 * Strips markup and active content from a user-supplied string.
 *
 * Deliberately *strips* rather than escapes. Escaping here would double-encode:
 * React escapes again at render, so a stored `&lt;b&gt;` shows the user the
 * literal `<b>` they never meant to publish.
 *
 * Angle brackets that are not part of a tag survive — "a < b" and "I <3 this"
 * are things people write in reviews, and rejecting them would be a worse bug
 * than the one being prevented.
 */
export function sanitizeText(v: unknown, maxLength = 5000): SanitizedText {
  const raw = str(v);
  if (!raw) return { text: '', modified: false };

  const text = raw
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE, '')
    .replace(HTML_COMMENT, '')
    .replace(ACTIVE_ELEMENTS, '')
    .replace(HTML_TAG, '')
    .replace(INLINE_HANDLER, '')
    .replace(ACTIVE_URI, '')
    .replace(EXCESS_NEWLINES, '\n\n')
    .trim()
    .slice(0, maxLength);

  return { text, modified: text !== raw.slice(0, maxLength) };
}

/** The common case: just the cleaned string. */
export const clean = (v: unknown, maxLength = 5000): string => sanitizeText(v, maxLength).text;
