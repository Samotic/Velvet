import { RateLimit } from '../models/RateLimit';

/**
 * Per-user action limiting, backed by Mongo with a TTL sweep.
 *
 * Follow spam is the standard abuse pattern on a social graph: a script that
 * follows thousands of accounts to farm follow-backs. Two windows, because one
 * cannot express both shapes of it — 20/minute stops the burst, 60/hour stops
 * the patient version that stays under the per-minute cap all day.
 */

export type LimitWindow = { limit: number; seconds: number };

/** §9's caps. */
export const FOLLOW_LIMITS: LimitWindow[] = [
  { limit: 20, seconds: 60 },
  { limit: 60, seconds: 60 * 60 },
];

export type LimitResult =
  | { ok: true }
  | { ok: false; retryAfter: number };

/**
 * Consumes one unit against every window, and reports the first breach.
 *
 * Counts are incremented **before** the check, so concurrent requests cannot
 * both read "59" and both proceed. The cost is that a rejected call still
 * consumes a unit, which is the right way round: it makes hammering the
 * endpoint extend the lockout rather than reset it.
 */
export async function consume(
  userId: string,
  action: string,
  windows: LimitWindow[] = FOLLOW_LIMITS,
): Promise<LimitResult> {
  const now = Date.now();

  for (const w of windows) {
    const ms = w.seconds * 1000;
    // Fixed window: everything in the same slice shares a key.
    const windowStart = Math.floor(now / ms) * ms;
    const key = `${userId}:${action}:${windowStart}`;
    const expiresAt = new Date(windowStart + ms);

    const doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (doc.count > w.limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((windowStart + ms - now) / 1000)) };
    }
  }

  return { ok: true };
}

/**
 * Hands a consumed unit back.
 *
 * Only for work that provably never happened — an upload refused because the
 * server has no Cloudinary credentials never reached Cloudinary, so charging
 * for it turns a misconfigured deployment into a rate-limited one and replaces
 * an honest 503 with a misleading 429.
 *
 * A genuine upload failure is **not** refunded: that request did reach the
 * provider and cost what the limit exists to bound.
 *
 * `count: { $gt: 0 }` guards the case where the window rolled between the
 * consume and the refund, so a stray decrement cannot drive a fresh window
 * negative and hand out free requests.
 */
export async function refund(
  userId: string,
  action: string,
  windows: LimitWindow[] = FOLLOW_LIMITS,
): Promise<void> {
  const now = Date.now();
  for (const w of windows) {
    const ms = w.seconds * 1000;
    const windowStart = Math.floor(now / ms) * ms;
    await RateLimit.updateOne(
      { key: `${userId}:${action}:${windowStart}`, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  }
}
