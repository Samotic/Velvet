import type { NextRequest } from 'next/server';

import { ONBOARDED_COOKIE, SESSION_COOKIE } from './cookieNames';

/**
 * Reads the session for the middleware gate.
 *
 * ── This does not verify the signature, and that is correct ──
 * Verifying would need `JWT_SECRET`, which lives in `backend/.env` and must
 * never reach the frontend bundle — the whole architecture rests on the browser
 * holding no server secret.
 *
 * It doesn't need to. This function answers one question: *which page should
 * this navigation land on?* Authorisation is enforced separately and
 * unconditionally by `requireAuth` on the Express API, which does verify the
 * signature on every request. The worst a forged cookie achieves is rendering a
 * shell whose every data call then returns 401 and logs the session out.
 *
 * So: routing hint here, real enforcement at the API. Never move an
 * authorisation decision into this file.
 *
 * Runs in the Edge runtime, so no Node crypto and no `Buffer` — `atob` only.
 */

export interface Session {
  userId: string;
  username: string;
  email: string;
  /** 0 none, 1 profile, 2 avatar, 3 taste. From its own cookie. */
  onboardingStep: number;
  /** Step 1 is the only required one, so this is simply `step >= 1`. */
  onboardingComplete: boolean;
}

/** Decodes a JWT's payload segment. Returns null on anything malformed. */
function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // base64url → base64, then pad to a multiple of four for atob.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function verifySession(req: NextRequest): Session | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = decodePayload(token);
  if (!payload) return null;

  const { userId, username, email, exp } = payload;
  if (typeof userId !== 'string' || typeof username !== 'string' || typeof email !== 'string') {
    return null;
  }

  // Expiry is honoured here so a stale tab doesn't sit on app routes it will be
  // 401'd out of the moment it fetches anything. `exp` is in seconds.
  if (typeof exp === 'number' && exp * 1000 <= Date.now()) return null;

  const step = Number(req.cookies.get(ONBOARDED_COOKIE)?.value);
  const onboardingStep = Number.isFinite(step) ? Math.max(0, Math.min(3, step)) : 0;

  return {
    userId,
    username,
    email,
    onboardingStep,
    onboardingComplete: onboardingStep >= 1,
  };
}
