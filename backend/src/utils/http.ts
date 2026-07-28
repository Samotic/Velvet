import type { Response } from 'express';

/**
 * Response envelope helpers enforcing the API contract:
 *   success → { data: ... }
 *   error   → { error: "message" }
 */

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data });
}

export function fail(res: Response, message: string, status = 400): Response {
  return res.status(status).json({ error: message });
}
