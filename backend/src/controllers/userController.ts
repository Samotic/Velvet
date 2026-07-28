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

    return ok(res, { user: publicProfile(user, viewerId(req), filmCount) });
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

/** POST /api/users/:id/follow */
export async function follow(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    const me = req.user!.userId;

    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);
    if (targetId === me) return fail(res, 'You cannot follow yourself', 422);

    const target = await User.findById(targetId).select('_id displayName');
    if (!target) return fail(res, 'User not found', 404);

    // $addToSet keeps this idempotent — a double-tap can't produce duplicates
    // or inflate the follower count.
    await Promise.all([
      User.updateOne({ _id: me }, { $addToSet: { following: target._id } }),
      User.updateOne({ _id: target._id }, { $addToSet: { followers: new Types.ObjectId(me) } }),
    ]);

    await notify({ userId: target._id, type: 'follow', fromUserId: me });

    return ok(res, { following: true });
  } catch (err) {
    console.error('follow error:', err);
    return fail(res, 'Could not follow that user', 500);
  }
}

/** DELETE /api/users/:id/follow */
export async function unfollow(req: Request, res: Response): Promise<Response> {
  try {
    const targetId = req.params.id;
    const me = req.user!.userId;
    if (!isObjectId(targetId)) return fail(res, 'User not found', 404);

    await Promise.all([
      User.updateOne({ _id: me }, { $pull: { following: new Types.ObjectId(targetId) } }),
      User.updateOne({ _id: targetId }, { $pull: { followers: new Types.ObjectId(me) } }),
    ]);

    return ok(res, { following: false });
  } catch (err) {
    console.error('unfollow error:', err);
    return fail(res, 'Could not unfollow that user', 500);
  }
}

/** Shared by the followers and following lists. */
async function listSide(req: Request, res: Response, side: 'followers' | 'following') {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'User not found', 404);

    const owner = await User.findById(id).select(side).lean();
    if (!owner) return fail(res, 'User not found', 404);

    const ids = (owner[side] ?? []) as Types.ObjectId[];
    const users = await User.find({ _id: { $in: ids } }).lean();

    const viewer = viewerId(req);
    // The counts on each row are the row's own, so no extra query per user.
    return ok(res, { users: users.map((u) => publicProfile(u, viewer, 0)) });
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

/** GET /api/users/search?q= — prefix match on handle or display name. */
export async function search(req: Request, res: Response): Promise<Response> {
  try {
    const q = str(req.query.q);
    if (!q) return ok(res, { users: [] });

    const re = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ $or: [{ username: re }, { displayName: re }] })
      .limit(25)
      .lean();

    const viewer = viewerId(req);
    return ok(res, { users: users.map((u) => publicProfile(u, viewer, 0)) });
  } catch (err) {
    console.error('user search error:', err);
    return fail(res, 'Could not search people', 500);
  }
}
