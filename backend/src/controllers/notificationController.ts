import type { Request, Response } from 'express';

import { Notification } from '../models/Notification';
import { fail, ok } from '../utils/http';
import { userRef } from '../utils/serialize';
import { isObjectId } from '../utils/validation';

const AUTHOR = 'username displayName profilePhoto';

/** Shapes a notification for the UI: `fromUserId` becomes a `from` block. */
function toJson(n: Record<string, unknown> & { _id: unknown }) {
  return {
    id: String(n._id),
    type: n.type,
    from: userRef(n.fromUserId),
    contentId: n.contentId ?? null,
    contentType: n.contentType ?? null,
    contentTitle: n.contentTitle ?? null,
    read: Boolean(n.read),
    createdAt: n.createdAt,
  };
}

/** GET /api/notifications?limit= — newest first, with the unread total. */
export async function list(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 50;

    const [rows, unread] = await Promise.all([
      Notification.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('fromUserId', AUTHOR)
        .lean(),
      Notification.countDocuments({ userId, read: false }),
    ]);

    return ok(res, { notifications: rows.map(toJson), unread });
  } catch (err) {
    console.error('notifications list error:', err);
    return fail(res, 'Could not load your notifications', 500);
  }
}

/** PUT /api/notifications/read-all */
export async function readAll(req: Request, res: Response): Promise<Response> {
  try {
    await Notification.updateMany(
      { userId: req.user!.userId, read: false },
      { $set: { read: true } },
    );
    return ok(res, { read: true });
  } catch (err) {
    console.error('readAll error:', err);
    return fail(res, 'Could not mark those as read', 500);
  }
}

/** PUT /api/notifications/:id/read */
export async function readOne(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'Not found', 404);

    // Scoped by userId so one user can't mark another's notifications read.
    const result = await Notification.updateOne(
      { _id: id, userId: req.user!.userId },
      { $set: { read: true } },
    );
    if (result.matchedCount === 0) return fail(res, 'Not found', 404);

    return ok(res, { read: true });
  } catch (err) {
    console.error('readOne error:', err);
    return fail(res, 'Could not update that notification', 500);
  }
}
