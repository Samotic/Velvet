'use client';

/**
 * A browser-readable mirror of the session, written purely so the Next.js
 * middleware can make routing decisions before any HTML is sent.
 *
 * ── Why this exists ──
 * The session of record is the JWT in localStorage, sent as `Authorization:
 * Bearer` on every API call. Middleware runs on the server and cannot see
 * localStorage — it can only read cookies. Without a cookie the gate would
 * treat every visitor as signed out and redirect them to /signin forever.
 *
 * ── Why it is not a security regression ──
 * These cookies cannot be `httpOnly`, because JavaScript has to write them.
 * That sounds worse than it is: the same token already sits in localStorage,
 * which is equally readable by any script on the origin. The threat model is
 * unchanged.
 *
 * More importantly, **nothing is authorised by these cookies**. The middleware
 * uses them to choose a redirect; the Express API independently verifies the
 * Bearer token's signature on every single request. A forged cookie buys you a
 * page render whose every data call then 401s.
 *
 * `SameSite=Lax` so the cookie rides top-level navigations (which is exactly
 * what middleware inspects) without being sent on cross-site subrequests.
 */

import { ONBOARDED_COOKIE, SESSION_COOKIE } from './auth/cookieNames';

/** Matches the backend's `jwtExpiresIn: '7d'`, so the two expire together. */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function write(name: string, value: string, maxAge: number): void {
  if (typeof document === 'undefined') return;
  // `Secure` only when actually on https — setting it on http://localhost would
  // make the browser drop the cookie and the gate would never see a session.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function erase(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Mirrors the token. Called from `setToken` so the two can never drift apart. */
export function writeSessionCookie(token: string): void {
  write(SESSION_COOKIE, token, MAX_AGE_SECONDS);
}

/**
 * Records how far onboarding has got, so middleware can route without a
 * database round trip. Kept separate from the token because it changes
 * independently of it — finishing a step must not require a new JWT.
 *
 * The *step* rather than a boolean, because three states matter, not two:
 * nothing done (force the flow), the required step done (let them in, but
 * resume if they come back), and everything done (keep them out of the flow).
 */
export function writeOnboardedCookie(step: number): void {
  write(ONBOARDED_COOKIE, String(Math.max(0, Math.min(3, Math.trunc(step)))), MAX_AGE_SECONDS);
}

/** Clears both. Called from `clearToken`, so logout tears down everything. */
export function clearSessionCookies(): void {
  erase(SESSION_COOKIE);
  erase(ONBOARDED_COOKIE);
}
