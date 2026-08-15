import type { NextFunction, Request, Response } from 'express';

/**
 * Strips MongoDB query operators out of anything the client sent.
 *
 * ── The attack ──
 * Express parses JSON into real objects, so a body of `{"email": {"$ne": null}}`
 * hands the controller an object where it expected a string. Passed to
 * `User.findOne({ email })` that becomes `find where email != null` — the first
 * user in the collection, and a password check is the only thing left standing
 * between an attacker and someone else's account. The same shape in a `$where`
 * or `$expr` is worse.
 *
 * ── Why here and not only in the controllers ──
 * Every controller today already coerces with `str()` or a `typeof` check, so
 * nothing is currently exploitable. That is a property of thirty call sites
 * agreeing with each other, and the thirty-first is one commit away. This makes
 * it a property of the request instead: by the time any handler runs, the keys
 * cannot be operators.
 *
 * Deletes rather than escapes. Rewriting `$ne` to `_ne` would leave a key no
 * validator expects and quietly change what the caller asked for; a request
 * carrying query operators is not a request Velvet has any legitimate reading
 * of, so the operator is simply not there.
 */

/** `$` starts an operator. A dot reaches into a nested path. */
const isDangerousKey = (key: string) => key.startsWith('$') || key.includes('.');

/**
 * Depth cap. A deeply nested body is cheap to send and expensive to walk, so
 * the recursion is bounded rather than trusting the payload.
 */
const MAX_DEPTH = 12;

function scrub(value: unknown, depth: number, removed: string[]): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = scrub(value[i], depth + 1, removed);
    return value;
  }

  // A Date, Buffer or similar is not a plain object and must not be walked.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (isDangerousKey(key)) {
      removed.push(key);
      delete obj[key];
      continue;
    }
    obj[key] = scrub(obj[key], depth + 1, removed);
  }
  return obj;
}

/**
 * Applied before any route. `req.query` and `req.params` are mutated in place
 * rather than reassigned — on Express 5 they are getter-only, and assigning
 * throws at runtime on a path that would otherwise never be exercised in tests.
 */
export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  const removed: string[] = [];

  scrub(req.body, 0, removed);
  scrub(req.query, 0, removed);
  scrub(req.params, 0, removed);

  if (removed.length) {
    // Worth a line: a legitimate client never sends these, so every occurrence
    // is either an attack or a bug in a caller.
    console.warn(
      `sanitize: dropped ${removed.length} operator key(s) from ${req.method} ${req.path}: ${removed.join(', ')}`,
    );
  }

  next();
}
