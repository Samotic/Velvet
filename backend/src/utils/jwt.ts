import jwt from 'jsonwebtoken';

import { env } from '../config/env';

/** Claims carried in the JWT (spec: { userId, username, email }). */
export interface AuthTokenPayload {
  userId: string;
  username: string;
  email: string;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

/** Throws if the token is missing/expired/tampered — callers must try/catch. */
export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === 'string') throw new Error('Malformed token');

  const { userId, username, email } = decoded as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof username !== 'string' || typeof email !== 'string') {
    throw new Error('Malformed token payload');
  }
  return { userId, username, email };
}
