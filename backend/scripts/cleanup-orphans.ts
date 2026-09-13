/**
 * Removes data left behind by accounts that no longer exist.
 *
 *   cd backend && npx tsx scripts/cleanup-orphans.ts            # dry run
 *   cd backend && npx tsx scripts/cleanup-orphans.ts --apply    # writes
 *
 * **Dry run is the default, and `--apply` is required to write anything.**
 * That is the opposite of `reconcileCounters.ts`, deliberately: that script
 * only ever writes a count recomputed from the edges, so a stray invocation
 * converges. This one *deletes documents*. A flag you must remember to add to
 * make it safe is a flag someone will forget, so the safety is the default and
 * the destruction is the thing you have to ask for.
 *
 * ## Why this exists
 *
 * There is **no delete-account endpoint** (see the known gap in CLAUDE.md), so
 * every account that has ever gone away went away by hand, in the database,
 * leaving every reference to it in place. The visible symptom is a thread whose
 * other participant 404s: the conversation is listed nowhere, but its URL still
 * resolves, the thread cannot load, and until recently the composer was still
 * offered and every send failed silently.
 *
 * ## Scope
 *
 * Three things, and only these three:
 *
 *   1. Conversations with a participant that no longer exists — and their
 *      messages, which have nowhere to belong once the thread is gone.
 *   2. Messages whose `conversationId` points at no conversation at all,
 *      which is the same wreckage from an earlier pass or a partial delete.
 *   3. `Follow` edges naming a user that no longer exists.
 *
 * Then the follower/following mirrors are recomputed — **after** the edges are
 * purged, never before. Order is load-bearing: `reconcileCounters.ts` derives
 * counts from the edges, so running it while dangling edges survive writes a
 * count that faithfully includes deleted people. That is exactly how a
 * remaining account came to report two followers with one real mutual left.
 *
 * Everything *else* that references a user is **counted and reported, never
 * touched** — notifications, ratings and their likes and replies, watchlist
 * items, blocks, follow-request history, advisor transcripts, cached feeds and
 * stats. Deciding what a correct account deletion does with each of those is
 * the gap CLAUDE.md now records; guessing at it here, on production data, in a
 * script written to fix a different problem, is not the place to settle it.
 *
 * Cloudinary assets are likewise only reported. Deleting a message document
 * strands its upload, so the ids are appended to the stranded-media list for a
 * later sweep rather than destroyed on the way past — a stranded asset costs
 * storage, and a wrongly destroyed one is gone.
 *
 * Idempotent: a second run finds nothing to do.
 */
import 'dotenv/config';

import mongoose, { Types } from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { Conversation } from '../src/models/Conversation';
import { Follow } from '../src/models/Follow';
import { Message } from '../src/models/Message';
import { User } from '../src/models/User';
import { recordStrandedMedia, strandedMediaFile } from '../src/services/strandedMedia';

const APPLY = process.argv.includes('--apply');

const label = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  console.log(
    APPLY
      ? '\n*** APPLY MODE — this will delete documents ***\n'
      : '\nDry run. Nothing will be written. Re-run with --apply to act.\n',
  );

  /* --- who actually exists --------------------------------------------- */

  const live = new Set(
    (await User.find({}).select('_id').lean()).map((u) => String(u._id)),
  );
  console.log(`${label(live.size, 'live account')}\n`);

  if (!live.size) {
    // A cleanup that finds no users at all is far more likely to be pointed at
    // the wrong database than to have found a genuinely empty one, and every
    // action below would be a full wipe. Stop.
    throw new Error('refusing to run: the users collection is empty');
  }

  /* --- 1. conversations whose other side is gone ------------------------ */

  const convos = await Conversation.find({}).select('_id participants').lean();
  const orphanedConvos = convos.filter((c) =>
    (c.participants ?? []).some((p) => !live.has(String(p))),
  );

  console.log(`── conversations: ${convos.length} total, ${orphanedConvos.length} orphaned`);
  for (const c of orphanedConvos) {
    const missing = (c.participants ?? []).map(String).filter((p) => !live.has(p));
    const count = await Message.countDocuments({ conversationId: c._id });
    console.log(
      `   ${String(c._id)}  ${label(count, 'message')}  missing: ${missing.join(', ')}`,
    );
  }

  const orphanedConvoIds = orphanedConvos.map((c) => c._id as Types.ObjectId);

  /* --- 2. messages with no surviving parent ----------------------------- */

  /**
   * Resolved through `distinct` rather than by scanning messages.
   *
   * The obvious version — find every message whose `conversationId` is not in
   * the orphaned list, then filter in JS — reads the entire collection into
   * this process to answer a question about a handful of ids. `distinct` asks
   * Mongo for the ids only, and the ones with no surviving conversation are
   * then a set difference.
   */
  const allConvoIds = new Set(convos.map((c) => String(c._id)));
  const referenced: Types.ObjectId[] = await Message.distinct('conversationId');
  const parentlessConvoIds = referenced.filter((id) => !allConvoIds.has(String(id)));
  const parentless = parentlessConvoIds.length
    ? await Message.countDocuments({ conversationId: { $in: parentlessConvoIds } })
    : 0;

  const inOrphanedConvos = await Message.countDocuments({
    conversationId: { $in: orphanedConvoIds },
  });

  console.log(
    `\n── messages: ${inOrphanedConvos} in orphaned conversations, ` +
      `${parentless} with no conversation at all`,
  );

  /* --- media that would be stranded ------------------------------------- */

  /** Every message this run would delete: both categories, one predicate. */
  const doomedFilter = {
    conversationId: { $in: [...orphanedConvoIds, ...parentlessConvoIds] },
  };

  const withMedia = await Message.find({
    ...doomedFilter,
    mediaPublicId: { $ne: null },
  })
    .select('_id kind mediaUrl mediaPublicId mediaResourceType')
    .lean();

  console.log(`\n── Cloudinary: ${label(withMedia.length, 'asset')} would be stranded`);
  for (const m of withMedia) {
    console.log(`   ${m.kind}  ${m.mediaPublicId}  (${m.mediaResourceType})`);
  }
  if (withMedia.length) {
    /**
     * **Appended** to the stranded-media list, through the API's own
     * `recordStrandedMedia` — never written over it.
     *
     * The file is not this script's report alone any more. The API records
     * every Cloudinary destroy that fails in it (`services/strandedMedia.ts`),
     * and apart from a log line those rows exist nowhere else; replacing the
     * file, as this script once did, erased them. The shared function brings
     * the rest with it: an asset already listed is not listed twice, so a dry
     * run followed by an apply adds each asset once; appends are serialised;
     * and an unreadable file is moved aside rather than overwritten.
     *
     * `ORPHANED_MEDIA_FILE` overrides the path, and `verify-cleanup-orphans.ts`
     * always points it at a temp file: the default is relative to the working
     * directory, `backend/`, which is where the real list lives.
     */
    for (const m of withMedia) {
      await recordStrandedMedia({
        messageId: String(m._id),
        kind: m.kind ?? null,
        publicId: m.mediaPublicId ?? null,
        resourceType: m.mediaResourceType ?? null,
        mediaUrl: m.mediaUrl ?? null,
        reason: 'its message belongs to an account that no longer exists (cleanup-orphans)',
      });
    }
    console.log(
      `   appended to ${strandedMediaFile()} — NOT destroyed. Sweep them deliberately,\n` +
        `   once you are certain these assets belong to nothing that is still live.`,
    );
  }

  /* --- 3. follow edges naming someone who is gone ----------------------- */

  const edges = await Follow.find({}).select('_id followerId followingId status').lean();
  const danglingEdges = edges.filter(
    (e) => !live.has(String(e.followerId)) || !live.has(String(e.followingId)),
  );

  console.log(`\n── follow edges: ${edges.length} total, ${danglingEdges.length} dangling`);
  for (const e of danglingEdges) {
    const gone = [
      !live.has(String(e.followerId)) ? `follower ${String(e.followerId)}` : null,
      !live.has(String(e.followingId)) ? `following ${String(e.followingId)}` : null,
    ]
      .filter(Boolean)
      .join(' + ');
    console.log(`   ${String(e._id)}  ${e.status}  gone: ${gone}`);
  }

  /* --- what is out of scope, so nobody assumes it was handled ----------- */

  const db = mongoose.connection.db!;
  const liveIds = [...live].map((id) => new Types.ObjectId(id));

  /**
   * These counts read collections by name rather than through a model, because
   * importing eleven models to count rows in them is a lot of surface for a
   * report. The cost is that a renamed collection would answer `0` — which
   * reads as "nothing orphaned here" and is the most misleading answer this
   * script could give — so the names are checked against the database first
   * and a miss is shouted about, not silently counted.
   */
  const present = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const expected = [
    'notifications', 'ratings', 'watchlistitems', 'blocks', 'followrequests',
    'aichatmessages', 'feedcaches', 'userstats', 'userneighbors',
  ];
  const missingCollections = expected.filter((n) => !present.has(n));
  if (missingCollections.length) {
    console.log(
      `\n!! these collections were not found, so their counts below are meaningless:\n` +
        `   ${missingCollections.join(', ')}\n` +
        `   A model's collection name has probably changed. Fix this list before\n` +
        `   trusting the out-of-scope report.`,
    );
  }

  const outOfScope: [string, number][] = [
    ['notifications (userId)', await db.collection('notifications').countDocuments({ userId: { $nin: liveIds } })],
    ['notifications (fromUserId)', await db.collection('notifications').countDocuments({ fromUserId: { $nin: [...liveIds, null] } })],
    ['ratings + reviews', await db.collection('ratings').countDocuments({ userId: { $nin: liveIds } })],
    ['review likes', await db.collection('ratings').countDocuments({ likes: { $elemMatch: { $nin: liveIds } } })],
    ['review replies', await db.collection('ratings').countDocuments({ 'replies.userId': { $nin: liveIds } })],
    ['watchlist items', await db.collection('watchlistitems').countDocuments({ userId: { $nin: liveIds } })],
    ['blocks', await db.collection('blocks').countDocuments({ $or: [{ blockerId: { $nin: liveIds } }, { blockedId: { $nin: liveIds } }] })],
    ['follow-request history', await db.collection('followrequests').countDocuments({ $or: [{ from: { $nin: liveIds } }, { to: { $nin: liveIds } }] })],
    ['advisor transcripts', await db.collection('aichatmessages').countDocuments({ userId: { $nin: liveIds } })],
    ['cached feeds', await db.collection('feedcaches').countDocuments({ userId: { $nin: liveIds } })],
    ['user stats', await db.collection('userstats').countDocuments({ userId: { $nin: liveIds } })],
    ['neighbour vectors', await db.collection('userneighbors').countDocuments({ userId: { $nin: liveIds } })],
  ];

  const scopedOut = outOfScope.filter(([, n]) => n > 0);
  console.log('\n── out of scope for this script — reported, NOT deleted');
  if (!scopedOut.length) {
    console.log('   nothing orphaned in any other collection');
  } else {
    for (const [name, n] of scopedOut) console.log(`   ${String(n).padStart(5)}  ${name}`);
    console.log(
      '   These need the deletion policy CLAUDE.md records as a known gap, not a\n' +
        '   guess from here. Some of them are content other live users can see.',
    );
  }

  /* --- writes ----------------------------------------------------------- */

  const nothingToDo =
    !orphanedConvos.length && !parentless && !danglingEdges.length;

  if (nothingToDo) {
    console.log('\n✓ no orphaned conversations, messages or edges');
  } else if (!APPLY) {
    console.log(
      `\nWould delete: ${label(orphanedConvos.length, 'conversation')}, ` +
        `${label(inOrphanedConvos + parentless, 'message')}, ` +
        `${label(danglingEdges.length, 'follow edge')}.`,
    );
  } else {
    /**
     * Messages before conversations. If the run dies in between, what is left
     * behind is a childless conversation — which the next run still recognises
     * as orphaned and finishes. The other order leaves parentless messages
     * that only step 2 can find, which is a slower and less obvious recovery.
     */
    const msgs = await Message.deleteMany(doomedFilter);
    console.log(`\ndeleted ${label(msgs.deletedCount ?? 0, 'message')}`);

    const cs = await Conversation.deleteMany({ _id: { $in: orphanedConvoIds } });
    console.log(`deleted ${label(cs.deletedCount ?? 0, 'conversation')}`);

    const fs2 = await Follow.deleteMany({
      _id: { $in: danglingEdges.map((e) => e._id as Types.ObjectId) },
    });
    console.log(`deleted ${label(fs2.deletedCount ?? 0, 'follow edge')}`);
  }

  /* --- 4. the mirrors, recomputed from what survives -------------------- */

  console.log('\n── follower/following mirrors');

  const users = await User.find({})
    .select('_id username followers following followerCount followingCount')
    .lean();

  let corrected = 0;

  for (const u of users) {
    /**
     * Recomputed from the edges, and filtered against `live` regardless.
     *
     * The filter is not redundant with the purge above: in dry-run mode the
     * dangling edges are still there, and the numbers printed have to be the
     * ones an `--apply` run would land on — otherwise the dry run reports a
     * correction that does not match what actually happens.
     */
    const [followerEdges, followingEdges] = await Promise.all([
      Follow.find({ followingId: u._id, status: 'accepted' }).select('followerId').lean(),
      Follow.find({ followerId: u._id, status: 'accepted' }).select('followingId').lean(),
    ]);

    const followers = followerEdges
      .map((e) => String(e.followerId))
      .filter((id) => live.has(id));
    const following = followingEdges
      .map((e) => String(e.followingId))
      .filter((id) => live.has(id));

    const wasFollowers = (u.followers ?? []).map(String);
    const wasFollowing = (u.following ?? []).map(String);

    const same =
      wasFollowers.length === followers.length &&
      wasFollowing.length === following.length &&
      u.followerCount === followers.length &&
      u.followingCount === following.length &&
      followers.every((id) => wasFollowers.includes(id)) &&
      following.every((id) => wasFollowing.includes(id));

    if (same) continue;
    corrected += 1;

    console.log(
      `   @${u.username}  followers ${wasFollowers.length}→${followers.length} ` +
        `(count ${u.followerCount}→${followers.length})  ` +
        `following ${wasFollowing.length}→${following.length} ` +
        `(count ${u.followingCount}→${following.length})`,
    );

    if (APPLY) {
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            followers: followers.map((id) => new Types.ObjectId(id)),
            following: following.map((id) => new Types.ObjectId(id)),
            followerCount: followers.length,
            followingCount: following.length,
          },
        },
      );
    }
  }

  if (!corrected) console.log('   ✓ every mirror already matches its edges');
  else if (!APPLY) console.log(`   ${label(corrected, 'account')} would be corrected`);

  /**
   * The other counters — pending requests and unread notifications — are left
   * to `reconcileCounters.ts`, which already owns them. Two scripts writing the
   * same field is how they start disagreeing about which is authoritative.
   */
  console.log('\nRun `npx tsx scripts/reconcileCounters.ts` afterwards for the');
  console.log('remaining counters (pending requests, unread notifications).');

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('cleanup failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
