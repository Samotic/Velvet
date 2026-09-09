import type { Request, Response } from 'express';
import { Types } from 'mongoose';

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
  FollowForbiddenError,
  isBlockedBetween,
  NotFoundError,
  relationBetween,
  relationMap,
  removeFollow,
  RequestGoneError,
  resolveFollow,
  unblockUser,
} from '../services/social';
import { consume } from '../services/rateLimit';
import { canViewContent, checkViewById, PRIVATE_MESSAGE } from '../services/visibility';
import { Follow, type FollowStatus } from '../models/Follow';
import { fail, ok } from '../utils/http';
import { publicProfile, restrictedProfile } from '../utils/serialize';
import {
  cleanGenres,
  clean,
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

    const viewer = viewerId(req);
    const rel = await relationBetween(viewer, String(user._id));

    /**
     * A private account still has a findable profile — you cannot ask to
     * follow someone you cannot reach — but a non-follower gets the shell
     * only. The count query is skipped rather than computed and discarded:
     * `filmCount` is one of the fields being withheld.
     */
    if (!(await canViewContent(viewer, user))) {
      return ok(res, { user: restrictedProfile(user, viewer, rel) });
    }

    // "Films" on a profile means titles they've rated — rating is what marks
    // something watched in this schema.
    const filmCount = await Rating.countDocuments({ userId: user._id });

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
      // Sanitised, so a name made entirely of markup comes back empty and is
      // refused here rather than being stored as a blank byline.
      const name = clean(body.displayName, 60);
      if (!name) return fail(res, 'Display name cannot be empty', 422);
      patch.displayName = name;
    }
    // A bio can legitimately be cleared, so an empty string is a real value.
    if (typeof body.bio === 'string') patch.bio = clean(body.bio, 160);
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

    /**
     * The privacy toggle. Switching to private deliberately does **not**
     * convert existing followers into pending requests — they were accepted
     * under the terms in force at the time, and silently revoking access to
     * people who already had it would be a surprise in the wrong direction.
     * It governs who may follow from now on.
     */
    if (body.profileVisibility !== undefined) {
      if (body.profileVisibility !== 'public' && body.profileVisibility !== 'private') {
        return fail(res, 'Unrecognised profile visibility', 422);
      }
      patch.profileVisibility = body.profileVisibility;
    }

    /**
     * Read receipts. Mutual — see the note on the model.
     *
     * Nothing retroactive happens at either edge. Turning it off cannot unsend
     * a receipt already delivered, and turning it on does not disclose reads
     * that happened while it was off *as they happened* — the stored `read`
     * flag is released to the sender only when the pair is opted in at the
     * moment of the request, so the disclosure follows the current setting
     * rather than the setting at the time of reading.
     */
    if (body.readReceipts !== undefined) {
      if (typeof body.readReceipts !== 'boolean') {
        return fail(res, 'Read receipts must be true or false', 422);
      }
      patch.readReceipts = body.readReceipts;
    }

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
 * Every follow begins as a request, whoever the target is.
 *
 * The two entry points differ only in the words they answer with: the current
 * client reads `requested` / `following`, while `POST /:id/follow` predates the
 * approval flow and still reads the raw edge status. Sharing the body keeps the
 * validation, the block check and the rate limit in one place — three copies of
 * a permission check is how one of them ends up missing.
 */
async function sendFollowRequest(
  req: Request,
  res: Response,
  label: (status: FollowStatus) => string,
): Promise<Response> {
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

    /**
     * The notification, its socket push and the counters all happen inside
     * `createFollow`, on the transaction that creates the edge. Sending one
     * from here as well is what put the unread badge permanently one ahead of
     * the list — the row was upserted once but counted twice.
     */
    const outcome = await createFollow(me, targetId);
    return ok(res, { status: label(outcome.status) });
  } catch (err) {
    if (err instanceof NotFoundError) return fail(res, 'User not found', 404);
    if (err instanceof FollowForbiddenError) return fail(res, "Can't follow this account", 403);
    console.error('follow request error:', err);
    return fail(res, 'Could not send that follow request', 500);
  }
}

/**
 * POST /api/users/:id/follow-request
 *
 * Returns `{ status: 'requested' }` for a new or still-pending ask, and
 * `{ status: 'following' }` when the edge is already accepted. **Idempotent**:
 * pressing Follow twice reports the current state as a success rather than
 * erroring, because ending up following once is what the user meant.
 */
export const followRequest = (req: Request, res: Response): Promise<Response> =>
  sendFollowRequest(req, res, (status) => (status === 'accepted' ? 'following' : 'requested'));

/**
 * POST /api/users/:id/follow — the pre-approval route, kept working.
 *
 * Answers with the raw edge status (`pending` / `accepted`) so clients written
 * against it keep parsing the same values.
 */
export const follow = (req: Request, res: Response): Promise<Response> =>
  sendFollowRequest(req, res, (status) => status);

/**
 * Accept or decline the request `:id` sent to the caller.
 *
 * **Authorization comes from the session, never the URL.** `:id` names the
 * requester; the recipient is always `req.user`, so there is no id a caller can
 * supply that makes them the target of someone else's request.
 */
async function respondToRequest(
  req: Request,
  res: Response,
  decision: 'accepted' | 'declined',
): Promise<Response> {
  const verb = decision === 'accepted' ? 'accept' : 'decline';
  try {
    const requesterId = req.params.id;
    const me = req.user!.userId;

    if (!isObjectId(requesterId)) return fail(res, 'Request not found', 404);
    if (requesterId === me) return fail(res, 'You cannot act on your own request', 400);

    await resolveFollow(requesterId, me, decision);
    return ok(res, { status: decision === 'accepted' ? 'following' : 'declined' });
  } catch (err) {
    // Routine, and specifically not a 500: the requester cancelled while this
    // user was reading the notification.
    if (err instanceof RequestGoneError) {
      return fail(res, 'GONE: That request is no longer available', 410);
    }
    if (err instanceof FollowForbiddenError) return fail(res, "Can't act on that request", 403);
    console.error(`${verb} follow error:`, err);
    return fail(res, `Could not ${verb} that request`, 500);
  }
}

/** POST /api/users/:id/accept-follow — `:id` asked to follow the caller. */
export const acceptFollow = (req: Request, res: Response): Promise<Response> =>
  respondToRequest(req, res, 'accepted');

/**
 * POST /api/users/:id/decline-follow
 *
 * The requester is **not** notified: telling someone they were rejected is
 * hostile and creates pressure to ask again. Nothing stops them re-requesting
 * later — stopping that permanently is what blocking is for.
 */
export const declineFollow = (req: Request, res: Response): Promise<Response> =>
  respondToRequest(req, res, 'declined');

/**
 * DELETE /api/users/:id/follow — unfollow, or withdraw one's own request.
 *
 * One route for both because from the presser's side it is one gesture: undo.
 * Reports `not_following` even when there was nothing to undo, so a double-tap
 * settles on the state the user asked for instead of erroring.
 *
 * Cancelling also clears the target's request notification, which
 * `removeFollow` does on the same transaction as the edge deletion — doing it
 * here instead would leave a card that accepts into a 410.
 */
export async function unfollow(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    const me = req.user!.userId;
    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);

    await removeFollow(me, targetId);

    return ok(res, { status: 'not_following' });
  } catch (err) {
    console.error('unfollow error:', err);
    return fail(res, 'Could not unfollow that user', 500);
  }
}

/**
 * GET /api/users/me/follow-requests?limit=&cursor= — the pending queue.
 *
 * Newest first, and **cursor-paginated on `(createdAt, _id)` rather than an
 * offset**: requests arrive and are answered while the list is on screen, and
 * an offset silently skips or repeats a row every time the set shifts under it.
 * The id is the tie-break, because two requests can share a millisecond and a
 * date-only cursor would drop whichever of them sorted second.
 *
 * `total` is the whole queue, not this page — it is what the "Follow Requests
 * (N)" heading and the profile link count.
 */
export async function followRequests(req: Request, res: Response): Promise<Response> {
  try {
    const me = new Types.ObjectId(req.user!.userId);

    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;

    const pending = { followingId: me, status: 'pending' as const };
    const filter: Record<string, unknown> = { ...pending };

    const cursor = str(req.query.cursor);
    if (cursor) {
      const [at, id] = cursor.split('|');
      const when = new Date(at);
      if (!Number.isNaN(when.getTime())) {
        filter.$or = isObjectId(id)
          ? [{ createdAt: { $lt: when } }, { createdAt: when, _id: { $lt: new Types.ObjectId(id) } }]
          : [{ createdAt: { $lt: when } }];
      }
    }

    // One extra row tells us whether another page exists without a second count.
    const [edges, total] = await Promise.all([
      Follow.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean(),
      Follow.countDocuments(pending),
    ]);

    const hasMore = edges.length > limit;
    const page = hasMore ? edges.slice(0, limit) : edges;

    /**
     * The senders in one query, and **explicitly projected**. A card shows an
     * avatar, a name and a follower count; selecting the whole document would
     * put the requester's email address in a response the recipient has no
     * business reading.
     */
    const senders = await User.find({ _id: { $in: page.map((e) => e.followerId) } })
      .select('username displayName profilePhoto followerCount')
      .lean();
    const byId = new Map(senders.map((u) => [String(u._id), u]));

    // flatMap drops any edge whose sender was deleted mid-page rather than
    // rendering a card with nobody on it.
    const requests = page.flatMap((edge) => {
      const sender = byId.get(String(edge.followerId));
      if (!sender) return [];
      return [{
        id: String(edge._id),
        createdAt: edge.createdAt,
        from: {
          id: String(sender._id),
          username: sender.username,
          displayName: sender.displayName,
          profilePhoto: sender.profilePhoto ?? null,
          followerCount: sender.followerCount ?? 0,
        },
      }];
    });

    const last = page[page.length - 1];
    return ok(res, {
      requests,
      total,
      nextCursor:
        hasMore && last ? `${new Date(last.createdAt).toISOString()}|${String(last._id)}` : null,
    });
  } catch (err) {
    console.error('followRequests error:', err);
    return fail(res, 'Could not load your follow requests', 500);
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

    const owner = await User.findById(id).select('_id profileVisibility').lean();
    if (!owner) return fail(res, 'User not found', 404);

    /**
     * A private account's social graph is content too. Who someone follows is
     * often more revealing than what they have rated, and it was the one list
     * a stranger could page through 200 at a time.
     */
    if (!(await canViewContent(viewerId(req), owner))) {
      return fail(res, PRIVATE_MESSAGE, 403);
    }

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
