import type { Request, Response } from 'express';

import { Follow } from '../models/Follow';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import { WatchlistItem } from '../models/WatchlistItem';
import { viewerId } from '../middleware/auth';
import { userStats } from '../services/stats';
import { checkViewById, PRIVATE_MESSAGE } from '../services/visibility';
import { fail, ok } from '../utils/http';
import { userRef, type UserRef } from '../utils/serialize';
import { isObjectId } from '../utils/validation';

/**
 * The activity feed.
 *
 * There is no Activity collection: an activity item is a *view* over ratings
 * and watchlist writes, which are the only two things a user actually does to
 * a title. A third collection duplicating them would be one more thing to keep
 * consistent for no new information.
 */

const AUTHOR = 'username displayName profilePhoto';

interface ActivityItem {
  id: string;
  user: UserRef;
  action: 'rated' | 'reviewed' | 'watchlisted' | 'finished';
  contentId: string;
  contentType: string;
  contentTitle: string;
  poster: string | null;
  rating?: number | null;
  createdAt: Date;
}

/** Ratings and watchlist rows, merged and ordered by recency. */
async function itemsFor(userIds: unknown[], limit: number): Promise<ActivityItem[]> {
  const [ratings, saves] = await Promise.all([
    Rating.find({ userId: { $in: userIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', AUTHOR)
      .lean(),
    WatchlistItem.find({ userId: { $in: userIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', AUTHOR)
      .lean(),
  ]);

  const out: ActivityItem[] = [];

  for (const r of ratings) {
    const user = userRef(r.userId);
    if (!user) continue;
    out.push({
      id: `rating:${String(r._id)}`,
      user,
      // A rating with words is a review; without them it's just a score.
      action: r.review ? 'reviewed' : 'rated',
      contentId: r.contentId,
      contentType: r.contentType,
      contentTitle: r.contentTitle,
      poster: r.poster ?? null,
      rating: r.rating,
      createdAt: r.createdAt,
    });
  }

  for (const w of saves) {
    const user = userRef(w.userId);
    if (!user) continue;
    // A "want to watch" row is the interesting social signal; a finished one
    // is usually already covered by the rating above it.
    out.push({
      id: `watchlist:${String(w._id)}`,
      user,
      action: w.status === 'finished' ? 'finished' : 'watchlisted',
      contentId: w.contentId,
      contentType: w.contentType,
      contentTitle: w.contentTitle,
      poster: w.poster ?? null,
      createdAt: w.createdAt,
    });
  }

  return out
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/** GET /api/activity/feed — what the people you follow have been watching. */
export async function feed(req: Request, res: Response): Promise<Response> {
  try {
    // Accepted edges only: a pending request gives no access to their activity.
    const edges = await Follow.find({ followerId: req.user!.userId, status: 'accepted' })
      .select('followingId')
      .lean();

    const following = edges.map((e) => e.followingId);
    // Following nobody is an empty feed, not an error — the UI has a state for
    // it that points at finding people.
    if (!following.length) return ok(res, { items: [] });

    return ok(res, { items: await itemsFor(following, 20) });
  } catch (err) {
    console.error('activity feed error:', err);
    return fail(res, 'Could not load the feed', 500);
  }
}

/** GET /api/activity/user/:userId — one person's recent activity. */
export async function forUser(req: Request, res: Response): Promise<Response> {
  try {
    const { userId } = req.params;
    if (!isObjectId(userId)) return fail(res, 'User not found', 404);

    /**
     * The same gate as the ratings list, and arguably the one that matters
     * most: activity is not only what someone has watched but when, which is
     * the closest thing here to a live record of a person's evenings.
     */
    const view = await checkViewById(viewerId(req), userId);
    if (!view.ok) {
      return view.reason === 'private'
        ? fail(res, PRIVATE_MESSAGE, 403)
        : fail(res, 'User not found', 404);
    }

    return ok(res, { items: await itemsFor([userId], 20) });
  } catch (err) {
    console.error('user activity error:', err);
    return fail(res, 'Could not load that activity', 500);
  }
}

/** GET /api/activity/user/:userId/stats — the profile's stats section. */
export async function statsForUser(req: Request, res: Response): Promise<Response> {
  try {
    const { userId } = req.params;
    if (!isObjectId(userId)) return fail(res, 'User not found', 404);

    // Aggregate figures are still content: hours watched and a genre
    // breakdown describe the person as surely as the titles behind them.
    const view = await checkViewById(viewerId(req), userId);
    if (!view.ok) {
      return view.reason === 'private'
        ? fail(res, PRIVATE_MESSAGE, 403)
        : fail(res, 'User not found', 404);
    }

    const s = await userStats(userId);
    return ok(res, { ...s, averageRating: s.avgRating });
  } catch (err) {
    console.error('user stats error:', err);
    return fail(res, 'Could not load those stats', 500);
  }
}
