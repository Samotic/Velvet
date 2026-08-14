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
 * Verifies a Bearer JWT and attaches the decoded payload to req.user.
 * Responds 401 when the header is missing or the token is invalid/expired.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) {
    fail(res, 'Authentication required', 401);
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    fail(res, 'Invalid or expired token', 401);
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
    const user = await User.findById(req.user!.userId).select('emailVerified');
    if (!user) {
      fail(res, 'User not found', 404);
      return;
    }
    if (!user.emailVerified) {
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
