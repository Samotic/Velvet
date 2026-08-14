'use client';

import { api, API_BASE, ApiError } from './api';
import type { AuthPayload, AuthUser, OnboardingProfileInput } from './authTypes';

/**
 * Email verification, password reset and the Google handoff.
 *
 * Registration and login live on `AuthProvider`, because they set the session.
 * These are the flows around the edges — the ones reached from an inbox or from
 * a signed-out page — so they are plain calls with no context to update.
 */

/* ------------------------------ verification ------------------------------ */

/** The 403 marker `requireVerified` sends. See backend/src/middleware/auth.ts. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

/** True when a failure was specifically "your address isn't verified yet". */
export function isUnverified(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.message.includes(EMAIL_NOT_VERIFIED);
}

/**
 * Opens the emailed link's token.
 *
 * Unauthenticated on purpose — the link is followed from a mail client, which
 * may well be a different browser from the one holding the session.
 */
export function verifyEmail(token: string): Promise<{ user: AuthUser }> {
  return api.post<{ user: AuthUser }>('/api/auth/verify-email', { token }, { auth: false });
}

/** Sends a fresh verification link. Requires a session — see the endpoint's note. */
export function resendVerification(): Promise<{ sent: boolean; alreadyVerified: boolean }> {
  return api.post<{ sent: boolean; alreadyVerified: boolean }>('/api/auth/resend-verification');
}

/* ---------------------------- password reset ------------------------------ */

/**
 * Always resolves when the address is well-formed, whether or not it has an
 * account — the API deliberately refuses to say which, so the UI must show the
 * same "check your inbox" either way.
 */
export function forgotPassword(email: string): Promise<{ sent: boolean }> {
  return api.post<{ sent: boolean }>('/api/auth/forgot-password', { email }, { auth: false });
}

/** Sets the new password and returns a session — the reset signs you straight in. */
export function resetPassword(token: string, newPassword: string): Promise<AuthPayload> {
  return api.post<AuthPayload>(
    '/api/auth/reset-password',
    { token, newPassword },
    { auth: false },
  );
}

/* ------------------------------- onboarding ------------------------------- */

/**
 * Step 1 — name and handle. The only required step, and the one that flips
 * `onboardingCompleted`, so the middleware gate opens the moment it succeeds.
 *
 * Returns a fresh token because the username is a JWT claim: keeping the old one
 * would leave every later request carrying a stale handle.
 */
export function saveOnboardingProfile(input: OnboardingProfileInput): Promise<AuthPayload> {
  return api.post<AuthPayload>('/api/auth/onboarding/profile', input);
}

/**
 * Records progress through the two skippable steps, so closing the tab and
 * coming back resumes rather than restarts. Monotonic server-side — skipping
 * still advances, because choosing not to add a photo is a decision.
 */
export function saveOnboardingStep(step: number): Promise<{ user: AuthUser }> {
  return api.post<{ user: AuthUser }>('/api/auth/onboarding/step', { step });
}

/* -------------------------------- google ---------------------------------- */

/**
 * Where the "Continue with Google" button points.
 *
 * A full-page navigation to the API, not a popup or a fetch: the API owns the
 * OAuth exchange (the client secret never reaches the browser), and it needs to
 * redirect to Google and back. `next` survives the round trip so a deep link
 * returns to where it started.
 */
export function googleSignInUrl(next?: string): string {
  const url = new URL(`${API_BASE}/api/auth/google`);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

/** The `?error=` codes `/api/auth/google/callback` can bounce back to /signin. */
export const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: 'Sign in with Google is not set up on this server yet.',
  google_denied: 'Google sign-in was cancelled.',
  google_state: 'That sign-in attempt expired. Please try again.',
  google_unverified: 'That Google account has an unverified email address.',
  google_failed: 'Google sign-in did not complete. Please try again.',
};
