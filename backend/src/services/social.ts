import mongoose, { Types, type ClientSession } from 'mongoose';

import { env } from '../config/env';
import { emitToUser } from '../lib/socket';
import { Block } from '../models/Block';
import { Follow, type FollowStatus, type IFollow } from '../models/Follow';
import { FollowRequest } from '../models/FollowRequest';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { NO_RELATION, notificationPayload, type ViewerRelation } from '../utils/serialize';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/** Serialize a pair's transitions on standalone Mongo too. Replica sets also
 * use transactions, which protect the same writes across API processes. */
const pairWrites = new Map<string, Promise<void>>();
async function withPairWrite<T>(a: string, b: string, fn: () => Promise<T>): Promise<T> {
  const key = [a.toLowerCase(), b.toLowerCase()].sort().join(':');
  const previous = pairWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pairWrites.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (pairWrites.get(key) === current) pairWrites.delete(key);
  }
}

/** Standalone deployments can repair interrupted writes with reconcileCounters. */
export async function withTxn<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  if (!env.supportsTransactions) return fn(null);
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
}

export async function isBlockedBetween(a: string, b: string, session: ClientSession | null = null): Promise<boolean> {
  return Boolean(await Block.findOne({
    $or: [
      { blockerId: oid(a), blockedId: oid(b) },
      { blockerId: oid(b), blockedId: oid(a) },
    ],
  }).select('_id').session(session));
}

export type FollowOutcome = { status: FollowStatus; created: boolean; followId: Types.ObjectId };
type Edge = IFollow & { _id: Types.ObjectId };

/** Backfill old edges when touched, preserving their original approval. */
async function ensureRequest(edge: Edge, session: ClientSession | null): Promise<void> {
  await FollowRequest.updateOne(
    { _id: edge._id },
    { $setOnInsert: { from: edge.followerId, to: edge.followingId, status: edge.status, createdAt: edge.createdAt } },
    { upsert: true, session: session ?? undefined, timestamps: false },
  );
  if (edge.status === 'pending') {
    await User.updateOne(
      { _id: edge.followingId, 'followRequests.from': { $ne: edge.followerId } },
      { $push: { followRequests: { from: edge.followerId, createdAt: edge.createdAt } } },
      { session: session ?? undefined },
    );
  }
}

export async function refreshNotificationCount(userId: string, session: ClientSession | null = null): Promise<number> {
  const unread = await Notification.countDocuments({ userId: oid(userId), read: false }).session(session);
  await User.updateOne({ _id: oid(userId) }, { $set: { unreadNotificationCount: unread } }, { session: session ?? undefined });
  return unread;
}

async function requestNotification(edge: Edge, type: 'follow_request' | 'follow_accepted', session: ClientSession | null): Promise<void> {
  const userId = type === 'follow_request' ? edge.followingId : edge.followerId;
  await Notification.updateOne(
    { userId, type, followId: edge._id },
    { $setOnInsert: {
      userId, type, followId: edge._id,
      fromUserId: type === 'follow_request' ? edge.followerId : edge.followingId,
      actionState: type === 'follow_request' ? 'pending' : null,
      read: false,
    } },
    { upsert: true, session: session ?? undefined },
  );
  await refreshNotificationCount(String(userId), session);
}

async function publishNotification(userId: string, followId: Types.ObjectId, type: 'follow_request' | 'follow_accepted'): Promise<void> {
  const notification = await Notification.findOne({ userId, followId, type })
    .populate('fromUserId', 'username displayName profilePhoto')
    .lean();
  if (notification) emitToUser(userId, 'notification:new', notificationPayload(notification));
}

function changed(userId: string, otherId: string): void {
  emitToUser(userId, 'follow:changed', { userId: otherId });
  emitToUser(userId, 'notification:changed', {});
}

/** Every new edge begins pending, regardless of profile content visibility. */
export async function createFollow(followerId: string, followingId: string): Promise<FollowOutcome> {
  return withPairWrite(followerId, followingId, async () => {
    const perform = () => withTxn(async (session) => {
      if (await isBlockedBetween(followerId, followingId, session)) throw new FollowForbiddenError();
      const target = await User.findById(followingId).select('_id').session(session);
      const sender = await User.findById(followerId).select('_id').session(session);
      if (!target || !sender) throw new NotFoundError();
      const existing = await Follow.findOne({ followerId: oid(followerId), followingId: oid(followingId) }).session(session);
      if (existing) {
        await ensureRequest(existing, session);
        return { status: existing.status, created: false, followId: existing._id };
      }
      const [edge] = await Follow.create([
        { followerId: oid(followerId), followingId: oid(followingId), status: 'pending' },
      ], { session: session ?? undefined });
      await ensureRequest(edge, session);
      await applyCounters('pending', followerId, followingId, 1, session);
      await requestNotification(edge, 'follow_request', session);
      return { status: edge.status, created: true, followId: edge._id };
    });
    let result: FollowOutcome;
    try {
      result = await perform();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // A competing API process inserted the unique pair first. Retry against
      // its committed edge; no counters or notifications are duplicated.
      result = await perform();
    }
    if (result.created) {
      await publishNotification(followingId, result.followId, 'follow_request');
      changed(followingId, followerId);
      emitToUser(followerId, 'follow:changed', { userId: followingId });
    }
    return result;
  });
}

/** Called only while holding this pair's lock, including from blockUser. */
async function removeEdge(followerId: string, followingId: string, session: ClientSession | null): Promise<FollowStatus | null> {
  const edge = await Follow.findOneAndDelete(
    { followerId: oid(followerId), followingId: oid(followingId) },
    { session: session ?? undefined },
  );
  if (!edge) return null;
  await applyCounters(edge.status, followerId, followingId, -1, session);
  if (edge.status === 'pending') {
    // Cancellation is not a recipient's decline and leaves no request to act on.
    await FollowRequest.deleteOne({ _id: edge._id, status: 'pending' }, { session: session ?? undefined });
    await Notification.deleteMany({ followId: edge._id, type: 'follow_request' }, { session: session ?? undefined });
    await refreshNotificationCount(followingId, session);
  }
  return edge.status;
}

export async function removeFollow(followerId: string, followingId: string): Promise<FollowStatus | null> {
  return withPairWrite(followerId, followingId, async () => {
    const status = await withTxn((session) => removeEdge(followerId, followingId, session));
    if (status) {
      changed(followingId, followerId);
      emitToUser(followerId, 'follow:changed', { userId: followingId });
    }
    return status;
  });
}

/** Authorization derives the recipient from auth and the edge; an optional id
 * pins legacy actions to the exact request shown on their notification. */
export async function resolveFollow(
  requesterId: string,
  recipientId: string,
  decision: 'accepted' | 'declined',
  expectedId?: string,
): Promise<void> {
  return withPairWrite(requesterId, recipientId, async () => {
    const result = await withTxn(async (session) => {
      if (await isBlockedBetween(requesterId, recipientId, session)) throw new FollowForbiddenError();
      const edge = await Follow.findOne({
        followerId: oid(requesterId), followingId: oid(recipientId),
        ...(expectedId ? { _id: oid(expectedId) } : {}),
      }).session(session);
      if (!edge) {
        if (decision === 'declined') {
          const declined = await FollowRequest.exists({
            from: oid(requesterId), to: oid(recipientId), status: 'declined',
            ...(expectedId ? { _id: oid(expectedId) } : {}),
          }).session(session);
          if (declined) return null;
        }
        throw new RequestGoneError();
      }
      if (edge.status === 'accepted') {
        if (decision === 'accepted') return null;
        throw new RequestGoneError();
      }
      await ensureRequest(edge, session);
      const opts = { session: session ?? undefined };
      if (decision === 'accepted') {
        const updated = await Follow.updateOne(
          { _id: edge._id, status: 'pending' },
          { $set: { status: 'accepted', respondedAt: new Date() } }, opts,
        );
        if (!updated.modifiedCount) throw new RequestGoneError();
        await applyCounters('pending', requesterId, recipientId, -1, session);
        await applyCounters('accepted', requesterId, recipientId, 1, session);
      } else {
        const removed = await Follow.deleteOne({ _id: edge._id, status: 'pending' }, opts);
        if (!removed.deletedCount) throw new RequestGoneError();
        await applyCounters('pending', requesterId, recipientId, -1, session);
      }
      await FollowRequest.updateOne({ _id: edge._id }, { $set: { status: decision } }, opts);
      if (decision === 'accepted') {
        await Notification.updateMany(
          { userId: oid(recipientId), followId: edge._id, type: 'follow_request' },
          { $set: { actionState: 'accepted', read: true } }, opts,
        );
        await requestNotification(edge, 'follow_accepted', session);
      } else {
        // Marked, not deleted. The card keeps its place reading "Declined" —
        // a row vanishing under the user's finger is disorienting, and it is
        // the only thing that ever writes the enum's third state.
        await Notification.updateMany(
          { userId: oid(recipientId), followId: edge._id, type: 'follow_request' },
          { $set: { actionState: 'declined', read: true } }, opts,
        );
      }
      await refreshNotificationCount(recipientId, session);
      return edge._id;
    });
    if (result) {
      changed(recipientId, requesterId);
      // A decline is silent for the requester, including sockets.
      if (decision === 'accepted') {
        await publishNotification(requesterId, result, 'follow_accepted');
        changed(requesterId, recipientId);
      }
    }
  });
}

/** Counters and the User arrays change only after a successful edge transition. */
export async function applyCounters(
  status: FollowStatus,
  followerId: string,
  followingId: string,
  delta: 1 | -1,
  session: ClientSession | null,
): Promise<void> {
  const opts = { session: session ?? undefined };
  if (status === 'accepted') {
    const arrayOp = delta === 1 ? '$addToSet' : '$pull';
    // Transaction operations must be sequential on the same session.
    await User.updateOne({ _id: oid(followerId) }, {
      $inc: { followingCount: delta }, [arrayOp]: { following: oid(followingId) },
    }, opts);
    await User.updateOne({ _id: oid(followingId) }, {
      $inc: { followerCount: delta }, [arrayOp]: { followers: oid(followerId) },
    }, opts);
    return;
  }
  await User.updateOne({ _id: oid(followingId) }, {
    $inc: { pendingRequestCount: delta },
    ...(delta === -1 ? { $pull: { followRequests: { from: oid(followerId) } } } : {}),
  }, opts);
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new FollowForbiddenError();
  await withPairWrite(blockerId, blockedId, async () => {
    await withTxn(async (session) => {
      await Block.updateOne(
        { blockerId: oid(blockerId), blockedId: oid(blockedId) },
        { $setOnInsert: { blockerId: oid(blockerId), blockedId: oid(blockedId) } },
        { upsert: true, session: session ?? undefined },
      );
      await removeEdge(blockerId, blockedId, session);
      await removeEdge(blockedId, blockerId, session);
      await Notification.deleteMany({ $or: [
        { userId: oid(blockerId), fromUserId: oid(blockedId) },
        { userId: oid(blockedId), fromUserId: oid(blockerId) },
      ] }, { session: session ?? undefined });
      await refreshNotificationCount(blockerId, session);
      await refreshNotificationCount(blockedId, session);
    });
    changed(blockerId, blockedId);
    changed(blockedId, blockerId);
  });
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await withPairWrite(blockerId, blockedId, async () => {
    await Block.deleteOne({ blockerId: oid(blockerId), blockedId: oid(blockedId) });
  });
}

export class NotFoundError extends Error {
  constructor() { super('User not found'); this.name = 'NotFoundError'; }
}
export class RequestGoneError extends Error {
  constructor() { super('That request is no longer available'); this.name = 'RequestGoneError'; }
}
export class FollowForbiddenError extends Error {
  constructor() { super("Can't follow this account"); this.name = 'FollowForbiddenError'; }
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
