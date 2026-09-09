import type { NextFunction, Request, Response } from 'express';

import { User } from '../models/User';
import { fail } from '../utils/http';
import { verifyToken } from '../utils/jwt';

/** Pulls a Bearer token out of the Authorization header, or null. */
function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Verifies a Bearer JWT, checks it has not been revoked, and attaches the
 * decoded payload to `req.user`.
 *
 * ── Why this reads the database ──
 * A JWT is a bearer credential: once signed it is valid until it expires, and
 * these live seven days. Signature verification alone cannot tell a current
 * session from one the user has since ended, so a stolen token survived both a
 * password reset and a logout. The only way to disown an already-issued token
 * is to compare it against something mutable, and that something has to be
 * read.
 *
 * ── What it costs ──
 * One `findById` on the primary key, projected to two fields and `.lean()`, on
 * every authenticated request. On Atlas in the same region that is roughly
 * 1–3ms; it is an `_id` hit, so it does not degrade as the collection grows.
 *
 * The routes that also use `requireVerified` pay **nothing extra**: that
 * middleware used to do this same lookup itself, and now reuses what this one
 * loaded. So verified routes are unchanged, and everything else gains one
 * indexed read. That is the price of being able to end a session, and it is
 * the cheapest mechanism that actually works — a denylist needs storage and
 * eviction, and short-lived tokens plus refresh needs a second endpoint and a
 * rotation story.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    fail(res, 'Authentication required', 401);
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    fail(res, 'Invalid or expired token', 401);
    return;
  }

  try {
    const user = await User.findById(payload.userId).select('tokenVersion emailVerified').lean();
    if (!user) {
      // The account is gone. A token for a deleted user is not a server error.
      fail(res, 'Invalid or expired token', 401);
      return;
    }

    /**
     * The revocation check.
     *
     * `tokenVersion` starts at 1 and the claim is required, so a token from
     * before this existed fails at `verifyToken` above rather than here — see
     * the note there. This branch catches the live case: a token signed before
     * a reset or a logout bumped the number.
     */
    if (payload.tokenVersion !== (user.tokenVersion ?? 1)) {
      fail(res, 'Session ended. Please sign in again.', 401);
      return;
    }

    req.user = payload;
    // Handed forward so `requireVerified` does not repeat the same read.
    req.authUser = { emailVerified: Boolean(user.emailVerified) };
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    fail(res, 'Could not verify your session', 500);
  }
}

/**
 * Attaches req.user when a valid token is present, and carries on regardless.
 *
 * Used by routes that are public but render differently when signed in — a
 * detail page shows community reviews to everyone, but only the signed-in
 * viewer's own likes come back marked. A bad token is treated as "signed out"
 * rather than an error, so an expired session degrades to the public view
 * instead of blanking the page.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      /* treated as anonymous */
    }
  }
  next();
}

/**
 * Requires a confirmed email address on top of a valid session.
 *
 * Guards the two features that can reach other people or spend money — the
 * advisor and messaging. Browsing, rating and onboarding stay open, so a new
 * account is never stuck staring at a wall while it waits for an email.
 *
 * `emailVerified` is read from the database rather than carried in the JWT: the
 * token lives for seven days, and a user who verifies in the meantime must not
 * have to sign out and back in for the app to notice. Costs one indexed lookup
 * on the handful of routes that use it.
 *
 * Answers 403 with a machine-readable marker so the client can tell "verify
 * your email" apart from an ordinary permission failure.
 */
export async function requireVerified(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    /**
     * Reuses the read `requireAuth` already did.
     *
     * This used to issue its own `findById`, which meant every verified route
     * hit the user document twice once `requireAuth` started reading it. The
     * fallback is kept for the theoretical case of this running without
     * `requireAuth` in front of it — every route mounts them together, but a
     * middleware that silently trusts its predecessor ran is one refactor away
     * from a hole.
     */
    const verified =
      req.authUser?.emailVerified ??
      (await User.findById(req.user!.userId).select('emailVerified').lean())?.emailVerified;

    if (verified === undefined) {
      fail(res, 'User not found', 404);
      return;
    }
    if (!verified) {
      fail(res, 'EMAIL_NOT_VERIFIED: Verify your email address to use this feature', 403);
      return;
    }
    next();
  } catch (err) {
    console.error('requireVerified error:', err);
    fail(res, 'Could not check your account status', 500);
  }
}

/** The viewer's id, or null when the request is anonymous. */
export const viewerId = (req: Request): string | null => req.user?.userId ?? null;
