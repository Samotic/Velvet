import type { Request, Response } from 'express';
import { Types } from 'mongoose';

import { Notification } from '../models/Notification';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import { viewerId } from '../middleware/auth';
import {
  isValidImageDataUrl,
  uploadProfilePhoto,
  UploadNotConfiguredError,
} from '../services/cloudinary';
import {
  blockUser,
  createFollow,
  isBlockedBetween,
  NotFoundError,
  relationBetween,
  relationMap,
  removeFollow,
  unblockUser,
} from '../services/social';
import { consume } from '../services/rateLimit';
import { Follow } from '../models/Follow';
import { fail, ok } from '../utils/http';
import { notify } from '../utils/notify';
import { publicProfile } from '../utils/serialize';
import {
  cleanGenres,
  escapeRegex,
  isContentType,
  isGender,
  isMood,
  isObjectId,
  isValidAge,
  str,
} from '../utils/validation';

/* ------------------------------- profiles -------------------------------- */

/** GET /api/users/:username — a public profile, viewer-aware. */
export async function getByUsername(req: Request, res: Response): Promise<Response> {
  try {
    const username = str(req.params.username);
    const user = await User.findOne({
      username: new RegExp(`^${escapeRegex(username)}$`, 'i'),
    }).lean();
    if (!user) return fail(res, 'User not found', 404);

    // "Films" on a profile means titles they've rated — rating is what marks
    // something watched in this schema.
    const filmCount = await Rating.countDocuments({ userId: user._id });

    const viewer = viewerId(req);
    const rel = await relationBetween(viewer, String(user._id));

    return ok(res, { user: publicProfile(user, viewer, filmCount, rel) });
  } catch (err) {
    console.error('getByUsername error:', err);
    return fail(res, 'Could not load that profile', 500);
  }
}

/** PUT /api/users/me — partial update; only sent fields change. */
export async function updateMe(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.displayName === 'string') {
      const name = body.displayName.trim();
      if (!name) return fail(res, 'Display name cannot be empty', 422);
      patch.displayName = name;
    }
    // A bio can legitimately be cleared, so an empty string is a real value.
    if (typeof body.bio === 'string') patch.bio = body.bio.trim().slice(0, 160);
    if (body.age !== undefined) {
      if (!isValidAge(body.age)) return fail(res, 'Age must be 13 or over', 422);
      patch.age = body.age;
    }
    if (body.gender !== undefined) {
      if (!isGender(body.gender)) return fail(res, 'Unrecognised gender', 422);
      patch.gender = body.gender;
    }
    if (body.favouriteMood !== undefined) {
      if (!isMood(body.favouriteMood)) return fail(res, 'Unrecognised mood', 422);
      patch.favouriteMood = body.favouriteMood;
    }
    if (body.favouriteGenres !== undefined) patch.favouriteGenres = cleanGenres(body.favouriteGenres);

    if (Array.isArray(body.pinnedFilms)) {
      const pins = body.pinnedFilms
        .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
        .filter((p) => typeof p.contentId === 'string' && isContentType(p.contentType))
        .slice(0, 5)
        .map((p) => ({
          contentId: String(p.contentId),
          contentType: p.contentType,
          title: str(p.title),
          poster: typeof p.poster === 'string' ? p.poster : null,
        }));
      patch.pinnedFilms = pins;
    }

    const user = await User.findByIdAndUpdate(req.user!.userId, patch, {
      new: true,
      runValidators: true,
    });
    if (!user) return fail(res, 'User not found', 404);

    return ok(res, { user: user.toJSON() });
  } catch (err) {
    console.error('updateMe error:', err);
    return fail(res, 'Could not save your profile', 500);
  }
}

/**
 * POST /api/users/me/photo — profile photo upload.
 *
 * The body is `{ file: "data:image/...;base64,..." }`. A data URL rather than
 * multipart keeps the server free of a file-upload dependency and means the
 * payload is validated by a regex before a byte is forwarded to Cloudinary.
 */
export async function uploadPhoto(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const file = body.file;

    if (!isValidImageDataUrl(file)) {
      return fail(res, 'Send a PNG, JPEG, WebP or GIF image under 6MB', 422);
    }

    const url = await uploadProfilePhoto(file, req.user!.userId);
    const user = await User.findByIdAndUpdate(
      req.user!.userId,
      { profilePhoto: url },
      { new: true },
    );
    if (!user) return fail(res, 'User not found', 404);

    return ok(res, { user: user.toJSON() });
  } catch (err) {
    if (err instanceof UploadNotConfiguredError) return fail(res, err.message, 503);
    console.error('uploadPhoto error:', err);
    return fail(res, 'Could not upload that photo', 500);
  }
}

/* -------------------------------- follows -------------------------------- */

/**
 * POST /api/users/:id/follow
 *
 * Returns `{ status: 'accepted' | 'pending' }` — accepted for a public target,
 * pending for a private one. **Idempotent**: calling it again reports the
 * current state as a success rather than erroring, because pressing Follow
 * twice and ending up following once is what the user meant.
 */
export async function follow(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    const me = req.user!.userId;

    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);
    // 400, not 422: a self-follow is a malformed request, not a rejected one.
    if (targetId === me) return fail(res, 'You cannot follow yourself', 400);

    // Deliberately generic, and identical whichever way the block runs.
    // "You are blocked" confirms the block to the person probing for it.
    if (await isBlockedBetween(me, targetId)) {
      return fail(res, "Can't follow this account", 403);
    }

    const limit = await consume(me, 'follow');
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      return fail(res, `RATE_LIMITED: Slow down for a minute.|${limit.retryAfter}`, 429);
    }

    const outcome = await createFollow(me, targetId);

    // Only on the call that actually created the edge — otherwise a double-tap
    // sends two notifications for one follow.
    if (outcome.created) {
      await notify({
        userId: targetId,
        type: outcome.status === 'pending' ? 'follow_request' : 'new_follower',
        fromUserId: me,
        followId: String(outcome.followId),
      });
    }

    return ok(res, { status: outcome.status });
  } catch (err) {
    if (err instanceof NotFoundError) return fail(res, 'User not found', 404);
    console.error('follow error:', err);
    return fail(res, 'Could not follow that user', 500);
  }
}

/**
 * DELETE /api/users/:id/follow — unfollow, or cancel one's own pending request.
 *
 * Also clears the target's `follow_request` notification: cancelling a request
 * should leave nothing behind for them to accept, or they'd act on a request
 * that no longer exists and get a 410.
 */
export async function unfollow(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    const me = req.user!.userId;
    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);

    const removed = await removeFollow(me, targetId);

    if (removed === 'pending') {
      await Notification.deleteMany({
        userId: new Types.ObjectId(targetId),
        fromUserId: new Types.ObjectId(me),
        type: 'follow_request',
        actionState: 'pending',
      });
    }

    return ok(res, { status: null });
  } catch (err) {
    console.error('unfollow error:', err);
    return fail(res, 'Could not unfollow that user', 500);
  }
}

/* -------------------------------- blocking ------------------------------- */

/** POST /api/users/:id/block — severs the relationship in both directions. */
export async function block(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    const me = req.user!.userId;

    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);
    if (targetId === me) return fail(res, 'You cannot block yourself', 400);

    const target = await User.findById(targetId).select('_id');
    if (!target) return fail(res, 'User not found', 404);

    await blockUser(me, targetId);
    return ok(res, { blocked: true });
  } catch (err) {
    console.error('block error:', err);
    return fail(res, 'Could not block that account', 500);
  }
}

/** DELETE /api/users/:id/block — lifts it. Restores nothing. */
export async function unblock(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);

    await unblockUser(req.user!.userId, targetId);
    return ok(res, { blocked: false });
  } catch (err) {
    console.error('unblock error:', err);
    return fail(res, 'Could not unblock that account', 500);
  }
}

/**
 * Shared by the followers and following lists.
 *
 * Reads the edge collection, filtered to `accepted` — a pending request is not
 * a follower, and listing it would disclose that someone had asked.
 */
async function listSide(req: Request, res: Response, side: 'followers' | 'following') {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'User not found', 404);

    const owner = await User.findById(id).select('_id').lean();
    if (!owner) return fail(res, 'User not found', 404);

    // "followers" = edges pointing at the owner; "following" = edges from them.
    const edges = await Follow.find(
      side === 'followers'
        ? { followingId: owner._id, status: 'accepted' }
        : { followerId: owner._id, status: 'accepted' },
    )
      .sort({ createdAt: -1 })
      .limit(200)
      .select('followerId followingId')
      .lean();

    const ids = edges.map((e) => (side === 'followers' ? e.followerId : e.followingId));
    const users = await User.find({ _id: { $in: ids } }).lean();

    const viewer = viewerId(req);
    // One query for the whole page's relationships, not one per row.
    const rels = await relationMap(viewer, users.map((u) => String(u._id)));

    return ok(res, {
      users: users.map((u) => publicProfile(u, viewer, 0, rels.get(String(u._id)))),
    });
  } catch (err) {
    console.error(`${side} error:`, err);
    return fail(res, `Could not load ${side}`, 500);
  }
}

/** GET /api/users/:id/followers */
export const followers = (req: Request, res: Response) => listSide(req, res, 'followers');

/** GET /api/users/:id/following */
export const following = (req: Request, res: Response) => listSide(req, res, 'following');

/* -------------------------------- search --------------------------------- */

/**
 * GET /api/users/search?q= — handle matches first, then display-name matches.
 *
 * The handle is the identity here: `username` is unique and indexed, while
 * `displayName` is neither, so ten people can all be "Sam". Ranking handles
 * above names is what makes the right person findable.
 *
 * Both patterns are **anchored**. The previous version built an unanchored
 * regex, which despite its "prefix match" comment matched anywhere in the
 * string — searching "a" returned nearly every account, and no index could
 * serve it, so every keystroke scanned the collection.
 */
export async function search(req: Request, res: Response): Promise<Response> {
  try {
    const q = str(req.query.q).trim();
    if (!q) return ok(res, { users: [] });

    const safe = escapeRegex(q);
    // A handle search is a prefix search: "am" must not match "sam".
    const handleRe = new RegExp(`^${safe}`, 'i');
    // Names match at any word start, so "taylor" finds "Sam Taylor" but "aylo"
    // finds nobody — loose enough for surnames, tight enough to stay meaningful.
    const nameRe = new RegExp(`(^|\\s)${safe}`, 'i');

    // Over-fetch, because the 25 we want are the best 25 across both groups
    // rather than whichever 25 Mongo happened to return first.
    const rows = await User.find({ $or: [{ username: handleRe }, { displayName: nameRe }] })
      .limit(50)
      .lean();

    const byHandle = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      (a.username ?? '').localeCompare(b.username ?? '');
    const matchesHandle = (u: (typeof rows)[number]) => handleRe.test(u.username ?? '');

    const ranked = [
      ...rows.filter(matchesHandle).sort(byHandle),
      ...rows.filter((u) => !matchesHandle(u)).sort(byHandle),
    ].slice(0, 25);

    const viewer = viewerId(req);
    const rels = await relationMap(viewer, ranked.map((u) => String(u._id)));
    return ok(res, {
      users: ranked.map((u) => publicProfile(u, viewer, 0, rels.get(String(u._id)))),
    });
  } catch (err) {
    console.error('user search error:', err);
    return fail(res, 'Could not search people', 500);
  }
}
