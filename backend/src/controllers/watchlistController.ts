import type { Request, Response } from 'express';

import { Rating } from '../models/Rating';
import { WatchlistItem, WATCH_STATUSES, type WatchStatus } from '../models/WatchlistItem';
import { fail, ok } from '../utils/http';
import { isContentType, isObjectId, str } from '../utils/validation';

/** Reads the shared body fields every write shares. */
function readItem(body: Record<string, unknown>) {
  return {
    contentId: str(body.contentId),
    contentType: body.contentType,
    contentTitle: str(body.contentTitle),
    poster: typeof body.poster === 'string' ? body.poster : null,
    year: typeof body.year === 'string' ? body.year : null,
  };
}

const isStatus = (v: unknown): v is WatchStatus =>
  typeof v === 'string' && (WATCH_STATUSES as readonly string[]).includes(v);

/**
 * Attaches each row's own rating, so a watchlist card can show the score the
 * user gave without a request per card. One extra query for the whole list.
 */
async function withRatings(userId: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return rows;

  const ratings = await Rating.find({ userId }).select('contentId contentType rating').lean();
  const key = (t: unknown, i: unknown) => `${String(t)}:${String(i)}`;
  const byKey = new Map(ratings.map((r) => [key(r.contentType, r.contentId), r.rating]));

  return rows.map((r) => ({
    ...r,
    myRating: byKey.get(key(r.contentType, r.contentId)) ?? null,
  }));
}

/**
 * GET /api/watchlist — the caller's list, or a public one via `?userId=`.
 *
 * `?status=` narrows to a single tab.
 */
export async function list(req: Request, res: Response): Promise<Response> {
  try {
    const requested = str(req.query.userId);
    const userId = requested && isObjectId(requested) ? requested : req.user!.userId;

    const filter: Record<string, unknown> = { userId };
    const status = str(req.query.status);
    if (isStatus(status)) filter.status = status;

    const rows = await WatchlistItem.find(filter).sort({ createdAt: -1 }).limit(500);
    const items = await withRatings(userId, rows.map((r) => r.toJSON() as Record<string, unknown>));

    return ok(res, { items });
  } catch (err) {
    console.error('watchlist list error:', err);
    return fail(res, 'Could not load your watchlist', 500);
  }
}

/** POST /api/watchlist — add, or update the status of something already saved. */
export async function add(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = readItem(body);

    if (!item.contentId) return fail(res, 'Which title?', 422);
    if (!isContentType(item.contentType)) return fail(res, 'Unrecognised content type', 422);

    const status = isStatus(body.status) ? body.status : 'want';

    const doc = await WatchlistItem.findOneAndUpdate(
      { userId: req.user!.userId, contentId: item.contentId, contentType: item.contentType },
      { $set: { ...item, status }, $setOnInsert: { progressPercent: 0 } },
      { new: true, upsert: true, runValidators: true },
    );

    return ok(res, { item: doc.toJSON() }, 201);
  } catch (err) {
    console.error('watchlist add error:', err);
    return fail(res, 'Could not save that', 500);
  }
}

/**
 * POST /api/watchlist/toggle — add if absent, remove if present.
 *
 * The server owns the decision rather than the client sending "add" or
 * "remove": two tabs toggling the same poster would otherwise race and settle
 * on whichever intent arrived last, not on a consistent state.
 */
export async function toggle(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = readItem(body);

    if (!item.contentId) return fail(res, 'Which title?', 422);
    if (!isContentType(item.contentType)) return fail(res, 'Unrecognised content type', 422);

    const key = {
      userId: req.user!.userId,
      contentId: item.contentId,
      contentType: item.contentType,
    };

    const existing = await WatchlistItem.findOne(key).select('_id');
    if (existing) {
      await WatchlistItem.deleteOne({ _id: existing._id });
      return ok(res, { saved: false });
    }

    await WatchlistItem.create({ ...key, ...item, status: 'want' });
    return ok(res, { saved: true }, 201);
  } catch (err) {
    console.error('watchlist toggle error:', err);
    return fail(res, 'Could not update your watchlist', 500);
  }
}

/** PUT /api/watchlist/:id — change status or progress. */
export async function update(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'Not found', 404);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!isStatus(body.status)) return fail(res, 'Unrecognised status', 422);
      patch.status = body.status;
      // Finishing something implies completion; leaving a half-filled bar on a
      // finished row reads as a bug.
      if (body.status === 'finished' && body.progressPercent === undefined) {
        patch.progressPercent = 100;
      }
    }
    if (body.progressPercent !== undefined) {
      const n = Number(body.progressPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) return fail(res, 'Progress is 0–100', 422);
      patch.progressPercent = Math.round(n);
    }

    // Scoped by userId as well as id, so one user can't edit another's row.
    const doc = await WatchlistItem.findOneAndUpdate(
      { _id: id, userId: req.user!.userId },
      patch,
      { new: true, runValidators: true },
    );
    if (!doc) return fail(res, 'Not found', 404);

    return ok(res, { item: doc.toJSON() });
  } catch (err) {
    console.error('watchlist update error:', err);
    return fail(res, 'Could not update that', 500);
  }
}

/** DELETE /api/watchlist/:id */
export async function remove(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'Not found', 404);

    const result = await WatchlistItem.deleteOne({ _id: id, userId: req.user!.userId });
    if (result.deletedCount === 0) return fail(res, 'Not found', 404);

    return ok(res, { removed: true });
  } catch (err) {
    console.error('watchlist remove error:', err);
    return fail(res, 'Could not remove that', 500);
  }
}
