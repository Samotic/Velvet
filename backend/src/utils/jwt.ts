import jwt from 'jsonwebtoken';

import { env } from '../config/env';

/** Claims carried in the JWT (spec: { userId, username, email }). */
export interface AuthTokenPayload {
  userId: string;
  username: string;
  email: string;
  /**
   * The account's `tokenVersion` at the moment this token was signed.
   *
   * `requireAuth` compares it against the stored value on every request, which
   * is what lets a password reset or a logout end sessions that are already
   * out in the world. A JWT cannot be recalled; this is how one is disowned.
   */
  tokenVersion: number;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

/**
 * Throws if the token is missing/expired/tampered — callers must try/catch.
 *
 * A **missing** `tokenVersion` is rejected outright rather than defaulted.
 * Every token signed before this claim existed lacks it, and defaulting would
 * let all of them through unchecked — a revocation mechanism that silently
 * exempts every session predating it protects nobody. The cost is that those
 * sessions end once, at deploy: everybody signs in again, and from then on the
 * check is real.
 */
export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === 'string') throw new Error('Malformed token');

  const { userId, username, email, tokenVersion } = decoded as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof username !== 'string' || typeof email !== 'string') {
    throw new Error('Malformed token payload');
  }
  if (typeof tokenVersion !== 'number') {
    throw new Error('Token predates session revocation — sign in again');
  }
  return { userId, username, email, tokenVersion };
}
