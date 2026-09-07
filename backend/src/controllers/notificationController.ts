import type { Request, Response } from 'express';
import { Types } from 'mongoose';

import { Follow } from '../models/Follow';
import { Notification } from '../models/Notification';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import {
  followStatusMap,
  FollowForbiddenError,
  RequestGoneError,
  resolveFollow,
} from '../services/social';
import { fail, ok } from '../utils/http';
import { notificationPayload, userRef } from '../utils/serialize';
import { isObjectId, str } from '../utils/validation';

const AUTHOR = 'username displayName profilePhoto';

/**
 * Shapes a notification for the UI.
 *
 * Carries everything a card needs to render — actor identity, avatar, social
 * proof, and the viewer's relationship to that actor — so the client never
 * follows up with a second request per row. That N+1 is the thing this
 * endpoint exists to avoid.
 *
 * The mapping itself lives in `notificationPayload` because the socket push
 * needs the identical shape; two copies of it is how a live-arriving row ends
 * up rendering differently from the same row after a reload.
 */
function toJson(
  n: Record<string, unknown> & { _id: unknown },
  viewerFollows: 'pending' | 'accepted' | null,
  ratingCount: number,
) {
  return notificationPayload(n, { viewerFollows, ratingCount });
}

/**
 * GET /api/notifications?cursor=&limit=20 — newest first, cursor-paginated.
 *
 * The cursor is the previous page's oldest `createdAt`, not an offset. Offsets
 * skip or repeat rows when something new arrives mid-scroll, which on a feed
 * that grows from the top is the normal case rather than the edge case.
 */
export async function list(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;

    const cursor = str(req.query.cursor);
    const filter: Record<string, unknown> = { userId };
    if (cursor) {
      const at = new Date(cursor);
      if (!Number.isNaN(at.getTime())) filter.createdAt = { $lt: at };
    }

    // One extra row tells us whether another page exists without a count query.
    const rows = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate('fromUserId', AUTHOR)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Every actor on the page, resolved in two queries rather than two per row.
    const actorIds = [
      ...new Set(
        page
          .map((n) => userRef(n.fromUserId)?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [followMap, ratingCounts, unread] = await Promise.all([
      followStatusMap(userId, actorIds),
      ratingCountsFor(actorIds),
      Notification.countDocuments({ userId, read: false }),
    ]);

    return ok(res, {
      notifications: page.map((n) => {
        const actorId = userRef(n.fromUserId)?.id ?? '';
        return toJson(n, followMap.get(actorId) ?? null, ratingCounts.get(actorId) ?? 0);
      }),
      unread,
      nextCursor: hasMore ? page[page.length - 1]?.createdAt : null,
    });
  } catch (err) {
    console.error('notifications list error:', err);
    return fail(res, 'Could not load your notifications', 500);
  }
}

/**
 * "142 rated" under each actor. One grouped aggregation for the page, because
 * a countDocuments per row is the same N+1 in a different costume.
 */
async function ratingCountsFor(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;

  const rows: Array<{ _id: Types.ObjectId; n: number }> = await Rating.aggregate([
    { $match: { userId: { $in: ids.map((i) => new Types.ObjectId(i)) } } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);

  for (const r of rows) out.set(String(r._id), r.n);
  return out;
}

/** GET /api/notifications/count — cheap, hit by the bell's polling loop. */
export async function count(req: Request, res: Response): Promise<Response> {
  try {
    const unread = await Notification.countDocuments({
      userId: req.user!.userId,
      read: false,
    });
    return ok(res, { unread });
  } catch (err) {
    console.error('notification count error:', err);
    return fail(res, 'Could not load your notification count', 500);
  }
}

/**
 * POST /api/notifications/read — `{ ids?: string[] }`, or all when omitted.
 *
 * Always scoped by `userId`, so passing someone else's id marks nothing.
 */
export async function markRead(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const raw = (req.body ?? {}).ids;
    const ids = Array.isArray(raw) ? raw.filter((i): i is string => isObjectId(i)) : null;

    const filter: Record<string, unknown> = { userId, read: false };
    if (ids) filter._id = { $in: ids.map((i) => new Types.ObjectId(i)) };

    await Notification.updateMany(filter, { $set: { read: true } });

    // Recomputed rather than decremented: the update is a bulk write whose
    // exact effect we'd otherwise have to guess at.
    const unread = await Notification.countDocuments({ userId, read: false });
    await User.updateOne({ _id: userId }, { $set: { unreadNotificationCount: unread } });

    return ok(res, { unread });
  } catch (err) {
    console.error('markRead error:', err);
    return fail(res, 'Could not mark those as read', 500);
  }
}

/** PUT /api/notifications/read-all — kept for the existing UI. */
export async function readAll(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
    await User.updateOne({ _id: userId }, { $set: { unreadNotificationCount: 0 } });
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

    const userId = req.user!.userId;
    // Scoped by userId so one user can't mark another's notifications read.
    const result = await Notification.updateOne(
      { _id: id, userId },
      { $set: { read: true } },
    );
    if (result.matchedCount === 0) return fail(res, 'Not found', 404);

    const unread = await Notification.countDocuments({ userId, read: false });
    await User.updateOne({ _id: userId }, { $set: { unreadNotificationCount: unread } });

    return ok(res, { read: true });
  } catch (err) {
    console.error('readOne error:', err);
    return fail(res, 'Could not update that notification', 500);
  }
}

/* --------------------------- follow requests ----------------------------- */

/**
 * The notification card's Accept / Decline, addressed by **edge id**.
 *
 * `/api/users/:id/accept-follow` names the requester and is what the profile
 * and the request queue call. This pair exists because a notification row knows
 * the edge it was raised for and not much else, and pinning the action to that
 * exact edge is what stops a card that has been sitting on screen from
 * resolving a *newer* request from the same person.
 *
 * Both delegate to `resolveFollow`, so the transaction, the counters, the
 * request history and the sockets are the same ones the primary route uses —
 * two implementations of "accept a follow" is two sets of counters to drift.
 *
 * Three failures, each a status the client can act on:
 *
 *   404 — `:id` is not an id at all
 *   403 — the edge exists but the caller is not its target. **Authorization
 *         reads the edge, never the request body.** Trusting a client-supplied
 *         id here would let anyone accept anyone's request.
 *   410 — it was pending a moment ago and is gone now, because the requester
 *         cancelled while this user was reading the notification. Routine, and
 *         specifically not a 500.
 */
async function actOnRequest(
  req: Request,
  res: Response,
  decision: 'accepted' | 'declined',
): Promise<Response> {
  const verb = decision === 'accepted' ? 'accept' : 'decline';
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'Request not found', 404);

    const me = req.user!.userId;
    const edge = await Follow.findById(id).select('followerId followingId').lean();
    if (!edge) return fail(res, 'GONE: That request is no longer available', 410);

    // Only the person being followed may answer.
    if (String(edge.followingId) !== me) {
      return fail(res, 'You cannot act on that request', 403);
    }

    await resolveFollow(String(edge.followerId), me, decision, id);
    return ok(res, { status: decision });
  } catch (err) {
    if (err instanceof RequestGoneError) {
      return fail(res, 'GONE: That request is no longer available', 410);
    }
    if (err instanceof FollowForbiddenError) return fail(res, "Can't act on that request", 403);
    console.error(`${verb}Request error:`, err);
    return fail(res, `Could not ${verb} that request`, 500);
  }
}

/** POST /api/follow-requests/:id/accept — `:id` is the Follow edge. */
export const acceptRequest = (req: Request, res: Response): Promise<Response> =>
  actOnRequest(req, res, 'accepted');

/**
 * POST /api/follow-requests/:id/decline
 *
 * The card stays in the list showing "Declined" rather than disappearing — a
 * row vanishing under the user's finger is disorienting — which is why the
 * outcome is held on the notification and not read back from the edge. The
 * edge is deleted.
 */
export const declineRequest = (req: Request, res: Response): Promise<Response> =>
  actOnRequest(req, res, 'declined');
