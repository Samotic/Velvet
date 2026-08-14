import jwt from 'jsonwebtoken';

import { configured, env } from '../config/env';

/**
 * Sign in with Google — the server-side authorisation-code flow.
 *
 * Called over Google's REST endpoints with `fetch` rather than pulling in
 * `googleapis`: this is two HTTP calls, and the SDK is a great deal more
 * surface than the feature is worth. The client secret never leaves this
 * process, and the browser only ever sees Google's own consent screen.
 *
 * Without GOOGLE_CLIENT_ID/SECRET the routes answer 503 and the login page
 * hides the button, so the app runs perfectly well with no Google project.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super('Sign in with Google is not configured on this server');
    this.name = 'GoogleNotConfiguredError';
  }
}

/**
 * Where Google sends the browser back to. Must match a redirect URI registered
 * in the Google Cloud console byte for byte — scheme, host, port and path.
 *
 * `GOOGLE_REDIRECT_URI` overrides it outright, so a console that was set up
 * with a different path can be matched from configuration instead of being
 * edited. The same value is sent on both legs of the flow (the consent
 * redirect and the token exchange), which is what Google requires.
 */
export const redirectUri = (): string =>
  env.googleCallbackUrl || `${env.apiUrl}/api/auth/google/callback`;

/* --------------------------------- state ---------------------------------- */

/**
 * CSRF protection for the round trip.
 *
 * The `state` parameter is a short-lived JWT signed with the server's existing
 * secret rather than a row in a session store: it needs to survive exactly one
 * redirect, and signing it means the callback can verify it without the API
 * having to hold any per-request state (which would break across restarts and
 * multiple instances).
 *
 * It also carries where to send the user afterwards, so a "sign in to continue"
 * from a deep link can come back to that page.
 */
interface StatePayload {
  nonce: string;
  next?: string;
}

export function signState(next?: string): string {
  const payload: StatePayload = { nonce: Math.random().toString(36).slice(2), next };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '10m' });
}

/** Returns the decoded state, or null when it is missing/forged/expired. */
export function verifyState(state: string): StatePayload | null {
  try {
    const decoded = jwt.verify(state, env.jwtSecret);
    if (typeof decoded === 'string') return null;
    const { nonce, next } = decoded as Record<string, unknown>;
    if (typeof nonce !== 'string') return null;
    return { nonce, next: typeof next === 'string' ? next : undefined };
  } catch {
    return null;
  }
}

/* ------------------------------- consent URL ------------------------------ */

/** The URL to bounce the browser to. */
export function authUrl(state: string): string {
  if (!configured.google()) throw new GoogleNotConfiguredError();

  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // `select_account` so a shared machine is always asked which account to use
    // rather than silently reusing whoever signed in last.
    prompt: 'select_account',
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/* ------------------------------ the exchange ------------------------------ */

/** The bits of Google's profile Velvet actually stores. */
export interface GoogleProfile {
  /** `sub` — Google's stable, unique subject id. The real key. */
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/**
 * Trades the one-time `code` for tokens, then reads the profile.
 *
 * Throws on any failure; the callback turns that into a redirect back to the
 * login page carrying an error, because at this point the user is mid-redirect
 * in a browser and a JSON error body would be a dead end.
 */
export async function exchangeCode(code: string): Promise<GoogleProfile> {
  if (!configured.google()) throw new GoogleNotConfiguredError();

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokens.access_token) {
    throw new Error(
      `Google token exchange failed: ${tokens.error_description ?? tokens.error ?? tokenRes.statusText}`,
    );
  }

  const profileRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!profileRes.ok) {
    throw new Error(`Google userinfo failed: ${profileRes.statusText}`);
  }

  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    picture?: string;
  };

  if (!profile.sub || !profile.email) {
    throw new Error('Google returned a profile with no subject id or email');
  }

  return {
    googleId: profile.sub,
    email: profile.email.trim().toLowerCase(),
    emailVerified: profile.email_verified !== false,
    // Fall back through the name fields, then the local part of the address, so
    // an account always has something to display.
    name: profile.name || profile.given_name || profile.email.split('@')[0],
    picture: profile.picture ?? null,
  };
}
