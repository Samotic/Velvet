import type { Types } from 'mongoose';

import type { IRating } from '../models/Rating';
import type { IUser } from '../models/User';

/**
 * Response shaping.
 *
 * The API's job at the edge is to hand the UI exactly what it renders and
 * nothing more — no Mongo internals, no other people's private fields, no
 * `likes` array of a thousand ObjectIds where a count and a boolean will do.
 *
 * These helpers are the single place that mapping happens, so a field can't
 * leak from one controller that another remembered to strip. They mirror
 * `lib/contentTypes.ts` and `lib/authTypes.ts` on the frontend.
 */

/** A Mongoose doc that has been `.lean()`d or populated — id plus fields. */
type WithId<T> = T & { _id: Types.ObjectId };

const idOf = (v: unknown): string =>
  typeof v === 'object' && v !== null && '_id' in v
    ? String((v as { _id: unknown })._id)
    : String(v);

/* --------------------------------- users --------------------------------- */

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
  profilePhoto: string | null;
}

/**
 * The author block attached to reviews, replies, activity and notifications.
 *
 * Accepts an unpopulated ObjectId too: a `fromUserId` that was never populated
 * would otherwise throw here, and a missing avatar is a better outcome than a
 * 500 on the notifications list.
 */
export function userRef(u: unknown): UserRef | null {
  if (!u) return null;
  if (typeof u === 'string' || !(typeof u === 'object' && 'username' in u)) return null;

  const doc = u as WithId<IUser>;
  return {
    id: idOf(doc),
    username: doc.username,
    displayName: doc.displayName,
    profilePhoto: doc.profilePhoto ?? null,
  };
}

/**
 * The viewer's relationship to the profile, in both directions.
 *
 * Passed in rather than derived here, because the edges live in the `follows`
 * collection now and this function is synchronous. Handing it in also lets a
 * list endpoint resolve every row in one query instead of one query per row.
 */
export interface ViewerRelation {
  /** viewer → this user. */
  outgoing: 'pending' | 'accepted' | null;
  /** this user → viewer. */
  incoming: 'pending' | 'accepted' | null;
}

export const NO_RELATION: ViewerRelation = { outgoing: null, incoming: null };

/**
 * A public profile as seen by `viewerId`.
 *
 * `isFollowing` and `isMe` are viewer-relative, which is why this can't be a
 * method on the model — the same document serialises differently per request.
 *
 * Counts read the denormalized fields, not array lengths: the arrays are
 * deprecated and, more to the point, a pending request must never be counted
 * as a follower.
 */
export function publicProfile(
  u: WithId<IUser>,
  viewerId: string | null,
  filmCount: number,
  rel: ViewerRelation = NO_RELATION,
): Record<string, unknown> {
  const id = idOf(u);
  return {
    id,
    username: u.username,
    displayName: u.displayName,
    profilePhoto: u.profilePhoto ?? null,
    bio: u.bio ?? '',
    age: u.age,
    gender: u.gender,
    favouriteGenres: u.favouriteGenres ?? [],
    favouriteMood: u.favouriteMood,
    pinnedFilms: u.pinnedFilms ?? [],
    followerCount: u.followerCount ?? 0,
    followingCount: u.followingCount ?? 0,
    filmCount,
    isPro: Boolean(u.isPro),
    profileVisibility: u.profileVisibility ?? 'public',
    /** Only an accepted edge is a follow. A pending one is `followRequested`. */
    isFollowing: rel.outgoing === 'accepted',
    /** Drives the third button state: Follow → Requested → Following. */
    followRequested: rel.outgoing === 'pending',
    // The other direction, and not redundant: messaging requires the follow to
    // be mutual, so the UI needs both halves to know whether to offer it.
    isFollowedBy: rel.incoming === 'accepted',
    isMe: viewerId === id,
    createdAt: u.createdAt,
  };
}

/* -------------------------------- reviews -------------------------------- */

/**
 * A rating/review for the UI.
 *
 * `likes` becomes `likeCount` + `likedByMe`: the client needs to render a
 * number and a filled-or-not heart, and shipping the raw array would leak who
 * liked what and grow without bound.
 */
export function review(r: WithId<IRating>, viewerId: string | null): Record<string, unknown> {
  const likes = r.likes ?? [];
  return {
    id: idOf(r),
    user: userRef(r.userId),
    contentId: r.contentId,
    contentType: r.contentType,
    contentTitle: r.contentTitle,
    poster: r.poster ?? null,
    rating: r.rating,
    review: r.review ?? '',
    likeCount: likes.length,
    likedByMe: viewerId ? likes.some((l) => idOf(l) === viewerId) : false,
    replies: (r.replies ?? []).map((rep) => ({
      id: String(rep._id ?? ''),
      user: userRef(rep.userId),
      text: rep.text,
      createdAt: rep.createdAt,
    })),
    createdAt: r.createdAt,
  };
}

/** The 1–5 histogram the detail screen's distribution chart draws. */
export function distribution(rows: { rating: number }[]): [number, number, number, number, number] {
  const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of rows) {
    const i = Math.min(Math.max(Math.round(r.rating), 1), 5) - 1;
    dist[i] += 1;
  }
  return dist;
}
