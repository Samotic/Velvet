import type { NextFunction, Request, Response } from 'express';

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

/** The viewer's id, or null when the request is anonymous. */
export const viewerId = (req: Request): string | null => req.user?.userId ?? null;
