import type { Types } from 'mongoose';

/**
 * The identity of a two-person thread: both user ids as hex strings, sorted,
 * joined with `:`.
 *
 *   "6a7b4d208537ab8ca9074921:6a7b5eab8537ab8ca90749f3"
 *
 * Order-independent by construction, so `(a, b)` and `(b, a)` are one key
 * whatever order `participants` happens to be stored in. Lowercased because an
 * id can arrive from a URL, and ObjectId hex is case-insensitive while string
 * comparison is not.
 *
 * Its own module, with no model in it, so the migration can derive keys without
 * registering `Conversation` — which would have Mongoose try to build the new
 * schema's indexes against a collection that has not been migrated yet.
 */
export function pairKeyFor(a: string | Types.ObjectId, b: string | Types.ObjectId): string {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join(':');
}
