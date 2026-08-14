/**
 * Cookie names, in a plain module with no `'use client'` directive.
 *
 * Both sides need these: the browser writes the cookies (lib/sessionCookie.ts,
 * a client module) and the middleware reads them (lib/auth/session.ts, which
 * runs on the edge). Importing plain data *out* of a client module hands the
 * server a client reference proxy that throws at request time rather than build
 * time — the same trap `lib/onboarding.ts` exists to avoid. So the shared
 * constants live here, where either environment can import them safely.
 */

/** Holds the JWT, mirrored from localStorage so middleware can see a session. */
export const SESSION_COOKIE = 'velvet.session';

/** '1' once onboarding is finished. Separate: it changes without a new token. */
export const ONBOARDED_COOKIE = 'velvet.onboarded';
