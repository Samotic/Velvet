import mongoose, { Types, type ClientSession } from 'mongoose';

import { env } from '../config/env';
import { Block } from '../models/Block';
import { Follow, type FollowStatus } from '../models/Follow';
import { User } from '../models/User';
import { NO_RELATION, type ViewerRelation } from '../utils/serialize';

/**
 * The follow graph's write path. Every edge change goes through here, because
 * an edge and its counters must move together — a route that writes one and
 * forgets the other is how `followerCount` starts lying.
 */

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/**
 * Runs `fn` inside a transaction where the deployment supports one.
 *
 * On standalone Mongo there are no transactions, so `fn` runs with a null
 * session and its writes land individually. That is a real weakening — a crash
 * between two writes leaves the counter out of step — and it is why
 * `reconcileCounters.ts` exists rather than being optional.
 */
export async function withTxn<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  if (!env.supportsTransactions) return fn(null);

  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

/** Either direction. Blocking is mutual in effect even though the record isn't. */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const found = await Block.findOne({
    $or: [
      { blockerId: oid(a), blockedId: oid(b) },
      { blockerId: oid(b), blockedId: oid(a) },
    ],
  }).select('_id');
  return Boolean(found);
}

export type FollowOutcome = {
  status: FollowStatus;
  /** True only on the call that actually created the edge — gates the notification. */
  created: boolean;
  /** The edge's id, carried on the notification so accept/decline can resolve it. */
  followId: Types.ObjectId;
};

/**
 * Creates the edge, or reports the one already there.
 *
 * **Idempotent by design.** Two taps race two inserts; the unique index rejects
 * the loser with 11000 and we read back the winner. The caller gets a success
 * either way, because from the user's point of view pressing Follow twice and
 * being followed once is the correct outcome, not an error.
 *
 * `created` tells the caller whether this call is the one that made the edge —
 * only then should a notification fire, or a double-tap sends two.
 */
export async function createFollow(
  followerId: string,
  followingId: string,
): Promise<FollowOutcome> {
  const target = await User.findById(followingId).select('profileVisibility');
  if (!target) throw new NotFoundError();

  // A private account's follows need approval; a public one's do not.
  const status: FollowStatus = target.profileVisibility === 'private' ? 'pending' : 'accepted';

  const existing = await Follow.findOne({
    followerId: oid(followerId),
    followingId: oid(followingId),
  }).select('status');
  if (existing) return { status: existing.status, created: false, followId: existing._id };

  try {
    return await withTxn(async (session) => {
      const [edge] = await Follow.create(
        [
          {
            followerId: oid(followerId),
            followingId: oid(followingId),
            status,
            respondedAt: status === 'accepted' ? new Date() : null,
          },
        ],
        { session: session ?? undefined },
      );

      await applyCounters(status, followerId, followingId, +1, session);
      return { status: edge.status, created: true, followId: edge._id };
    });
  } catch (err) {
    // Lost the insert race. The winner's edge is the truth; report it.
    if (isDuplicateKey(err)) {
      const raced = await Follow.findOne({
        followerId: oid(followerId),
        followingId: oid(followingId),
      }).select('status');
      if (raced) return { status: raced.status, created: false, followId: raced._id };
    }
    throw err;
  }
}

/**
 * Unfollow, or cancel one's own pending request — the same delete either way,
 * differing only in which counters move.
 *
 * Returns the status that was removed, or null if there was nothing to remove.
 * Null is not an error: DELETE is idempotent, and unfollowing someone you do
 * not follow has already achieved what the caller wanted.
 */
export async function removeFollow(
  followerId: string,
  followingId: string,
): Promise<FollowStatus | null> {
  return withTxn(async (session) => {
    const edge = await Follow.findOneAndDelete(
      { followerId: oid(followerId), followingId: oid(followingId) },
      { session: session ?? undefined },
    );
    if (!edge) return null;

    await applyCounters(edge.status, followerId, followingId, -1, session);
    return edge.status;
  });
}

/**
 * Moves the counters for one edge appearing (+1) or disappearing (-1).
 *
 * An accepted edge is a real follow on both sides. A pending one is neither —
 * it only sits in the target's request queue, so counting it as a follower
 * would both inflate the number and leak that someone had asked.
 */
export async function applyCounters(
  status: FollowStatus,
  followerId: string,
  followingId: string,
  delta: 1 | -1,
  session: ClientSession | null,
): Promise<void> {
  const opts = session ? { session } : {};

  if (status === 'accepted') {
    await Promise.all([
      User.updateOne({ _id: oid(followerId) }, { $inc: { followingCount: delta } }, opts),
      User.updateOne({ _id: oid(followingId) }, { $inc: { followerCount: delta } }, opts),
    ]);
    return;
  }

  await User.updateOne(
    { _id: oid(followingId) },
    { $inc: { pendingRequestCount: delta } },
    opts,
  );
}

/** Thrown when the follow target does not exist, so the route can answer 404. */
export class NotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'NotFoundError';
  }
}

export function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * The viewer's relationship to a batch of users, in **one** query rather than
 * one per row. The notifications feed renders a Follow-back button per card,
 * and resolving that per card is the N+1 this exists to prevent.
 */
export async function followStatusMap(
  viewerId: string,
  targetIds: string[],
): Promise<Map<string, FollowStatus>> {
  const map = new Map<string, FollowStatus>();
  if (!targetIds.length) return map;

  const rows = await Follow.find({
    followerId: oid(viewerId),
    followingId: { $in: targetIds.map(oid) },
  })
    .select('followingId status')
    .lean();

  for (const r of rows) map.set(String(r.followingId), r.status);
  return map;
}

/**
 * Both edges between two users, in one query.
 *
 * Returns the neutral relation when there is no viewer, so an anonymous read
 * serialises as "follows nobody" rather than needing a branch at every call.
 */
export async function relationBetween(
  viewerId: string | null,
  targetId: string,
): Promise<ViewerRelation> {
  if (!viewerId || viewerId === targetId) return { ...NO_RELATION };

  const rows = await Follow.find({
    $or: [
      { followerId: oid(viewerId), followingId: oid(targetId) },
      { followerId: oid(targetId), followingId: oid(viewerId) },
    ],
  })
    .select('followerId status')
    .lean();

  const rel: ViewerRelation = { outgoing: null, incoming: null };
  for (const r of rows) {
    if (String(r.followerId) === String(viewerId)) rel.outgoing = r.status;
    else rel.incoming = r.status;
  }
  return rel;
}

/**
 * The same, for a whole page of users — **two** queries total, not two per row.
 *
 * People search and the follower/following lists both render a relationship on
 * every row; resolving them individually is the N+1 that makes a 25-row list
 * fire 50 queries.
 */
export async function relationMap(
  viewerId: string | null,
  targetIds: string[],
): Promise<Map<string, ViewerRelation>> {
  const map = new Map<string, ViewerRelation>();
  for (const id of targetIds) map.set(id, { outgoing: null, incoming: null });
  if (!viewerId || !targetIds.length) return map;

  const ids = targetIds.map(oid);
  const rows = await Follow.find({
    $or: [
      { followerId: oid(viewerId), followingId: { $in: ids } },
      { followerId: { $in: ids }, followingId: oid(viewerId) },
    ],
  })
    .select('followerId followingId status')
    .lean();

  for (const r of rows) {
    const outgoing = String(r.followerId) === String(viewerId);
    const other = outgoing ? String(r.followingId) : String(r.followerId);
    const rel = map.get(other);
    if (!rel) continue;
    if (outgoing) rel.outgoing = r.status;
    else rel.incoming = r.status;
  }
  return map;
}

/** True when both directions exist and are accepted. Never stored — derived. */
export async function areMutual(a: string, b: string): Promise<boolean> {
  const n = await Follow.countDocuments({
    status: 'accepted',
    $or: [
      { followerId: oid(a), followingId: oid(b) },
      { followerId: oid(b), followingId: oid(a) },
    ],
  });
  return n === 2;
}
