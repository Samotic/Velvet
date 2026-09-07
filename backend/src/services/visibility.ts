import { Types } from 'mongoose';

import { Follow } from '../models/Follow';
import { User } from '../models/User';
import { relationBetween } from './social';

/**
 * Who may see a user's content.
 *
 * `profileVisibility` existed on the model, was writable from settings, and was
 * returned in the profile payload — but nothing ever *checked* it. A private
 * account was private only in the interface, while the API served the same
 * account's ratings, activity and follower list to anyone who asked, signed in
 * or not. This module is the check that was missing.
 *
 * One rule, in one place, because the alternative is five endpoints each
 * deciding for itself and four of them eventually being right. Every read path
 * that serves *another* user's content calls in here.
 *
 * The rule: content is visible when the account is public, when you are the
 * owner, or when you are an **accepted** follower. A pending request is not a
 * follow — treating it as one would mean asking to follow were enough to see
 * everything, which is the whole thing approval exists to prevent.
 */

export type Visibility = 'public' | 'private';

/** The shape this needs from an already-loaded user. */
export interface VisibilitySubject {
  _id: Types.ObjectId | string;
  profileVisibility?: Visibility | null;
}

/**
 * Whether `viewerId` may see `owner`'s content.
 *
 * Takes an already-loaded owner so a caller that has one does not fetch it
 * twice. `viewerId` is null for an anonymous request, which can only ever see
 * a public account — a private profile is not visible to the logged-out web at
 * all, which is the part that matters most.
 */
export async function canViewContent(
  viewerId: string | null,
  owner: VisibilitySubject,
): Promise<boolean> {
  if ((owner.profileVisibility ?? 'public') === 'public') return true;
  if (!viewerId) return false;
  if (String(owner._id) === String(viewerId)) return true;

  const rel = await relationBetween(viewerId, String(owner._id));
  return rel.outgoing === 'accepted';
}

/** What a lookup by id concluded. Distinguishes "no such user" from "not yours". */
export type ViewCheck =
  | { ok: true; owner: VisibilitySubject }
  | { ok: false; reason: 'not_found' | 'private' };

/**
 * Loads a user by id and decides in one step, for endpoints that only have an
 * id in the URL.
 *
 * A private account answers `private` rather than `not_found`. Hiding its
 * existence sounds safer but is not: the username is already discoverable by
 * search and by the profile page, and a 404 here would leave the client unable
 * to tell "this person does not exist" from "you need to follow them" — so it
 * could not offer the Follow button that is the way out.
 */
export async function checkViewById(
  viewerId: string | null,
  targetId: string,
): Promise<ViewCheck> {
  if (!Types.ObjectId.isValid(targetId)) return { ok: false, reason: 'not_found' };

  const owner = await User.findById(targetId).select('_id profileVisibility').lean();
  if (!owner) return { ok: false, reason: 'not_found' };

  const allowed = await canViewContent(viewerId, owner as VisibilitySubject);
  return allowed
    ? { ok: true, owner: owner as VisibilitySubject }
    : { ok: false, reason: 'private' };
}

/**
 * The same rule, asked about many authors at once.
 *
 * A list of reviews on a film carries up to a hundred different authors, and
 * calling `canViewContent` per row would be a hundred round trips on a page
 * that renders for anyone. This answers in two queries regardless of the
 * count: one for the authors' visibility, one for the viewer's accepted edges
 * among whichever of them are private.
 *
 * It is deliberately the *same* three conditions as `canViewContent` — public,
 * self, accepted follower — expressed as a set membership instead of a
 * lookup. If that rule ever changes it has to change in both, which is why
 * they sit next to each other in one file rather than one living beside its
 * caller.
 *
 * Returns the subset of `authorIds` the viewer is allowed to see.
 */
export async function visibleAuthors(
  viewerId: string | null,
  authorIds: (Types.ObjectId | string)[],
): Promise<Set<string>> {
  const wanted = [...new Set(authorIds.map(String))].filter((id) => Types.ObjectId.isValid(id));
  if (!wanted.length) return new Set();

  const owners = await User.find({ _id: { $in: wanted } })
    .select('_id profileVisibility')
    .lean();

  const allowed = new Set<string>();
  const privateIds: string[] = [];

  for (const owner of owners) {
    const id = String(owner._id);
    if ((owner.profileVisibility ?? 'public') === 'public') allowed.add(id);
    else if (viewerId && id === viewerId) allowed.add(id);
    else privateIds.push(id);
  }

  // Anonymous viewers never clear a private account, so the second query is
  // skipped outright rather than run with a null follower.
  if (!viewerId || !privateIds.length) return allowed;

  const edges = await Follow.find({
    followerId: new Types.ObjectId(viewerId),
    followingId: { $in: privateIds.map((id) => new Types.ObjectId(id)) },
    status: 'accepted',
  })
    .select('followingId')
    .lean();

  for (const edge of edges) allowed.add(String(edge.followingId));
  return allowed;
}

/** The one sentence every restricted endpoint answers with. */
export const PRIVATE_MESSAGE = 'This account is private';
