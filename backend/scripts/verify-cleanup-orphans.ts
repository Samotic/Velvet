/**
 * Proves `cleanup-orphans.ts` does what it claims, against a throwaway
 * database.
 *
 *   cd backend && npm run verify:cleanup
 *
 * This exists because that script **deletes documents**, and the only place it
 * will ever run is production — the one database nobody wants to debug it on.
 * So the logic is exercised here first, on `mongodb-memory-server`, with
 * fixtures shaped like the real wreckage: a conversation whose other
 * participant is gone, messages with no conversation at all, dangling follow
 * edges, healthy data sitting right beside all of it, and follower mirrors that
 * count people who no longer exist.
 *
 * The script under test is run as a **child process** with `MONGODB_URI`
 * pointed at the in-memory server, because it reads the URI through
 * `config/env`, which snapshots `process.env` at import — there is no in-process
 * way to redirect it after the fact. The URI is asserted to be local before the
 * child is spawned, so a mistake here cannot reach a real deployment.
 *
 * Its stranded-media list goes to a **temp directory** via `ORPHANED_MEDIA_FILE`,
 * never to `backend/orphaned-media.json`. That file holds the ids from a real
 * production dry run; a fixture overwriting it would send a later sweep after
 * assets that do not exist, while the real ones stay stranded.
 *
 * What is checked:
 *   - a dry run writes **nothing**, and reports the same numbers apply lands on
 *   - apply deletes the orphaned conversation, its messages, and the parentless
 *     messages, and leaves the healthy conversation and its messages alone
 *   - dangling edges go; the healthy edge stays
 *   - the mirrors and counters are recomputed from surviving edges
 *   - a second apply is a no-op
 *   - the stranded-media list is **appended to**, never replaced: a row the API
 *     recorded before the run survives all three runs, and the stranded asset
 *     is listed once however many runs find it
 *   - the stranded-media list lands in the temp path, and the real
 *     `orphaned-media.json` is byte-for-byte what it was before the run
 */
import './testEnv';

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { AIChatMessage } from '../src/models/AIChatMessage';
import { Block } from '../src/models/Block';
import { Conversation } from '../src/models/Conversation';
import { FeedCache } from '../src/models/FeedCache';
import { Follow } from '../src/models/Follow';
import { FollowRequest } from '../src/models/FollowRequest';
import { Message } from '../src/models/Message';
import { Notification } from '../src/models/Notification';
import { Rating } from '../src/models/Rating';
import { User } from '../src/models/User';
import { UserNeighbors } from '../src/models/UserNeighbors';
import { UserStats } from '../src/models/UserStats';
import { WatchlistItem } from '../src/models/WatchlistItem';

const run$ = promisify(execFile);

/** Where the script under test writes stranded Cloudinary ids during this run. */
const MEDIA_DIR = mkdtempSync(join(tmpdir(), 'velvet-cleanup-'));
const MEDIA_FILE = join(MEDIA_DIR, 'orphaned-media.json');

/** The file the script would write without the override — read, never written. */
const REAL_MEDIA_FILE = resolve('orphaned-media.json');

const snapshot = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8') : null;

let pass = 0;
let fail = 0;

function expect(name: string, got: unknown, want: unknown): void {
  if (got === want) {
    pass++;
    console.log(`  ✓ ${name} → ${JSON.stringify(want)}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} → expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}

/** Runs the script under test against the in-memory server. */
async function cleanup(uri: string, apply: boolean): Promise<string> {
  // A typo in the override must not be able to reach a real database.
  if (!/(127\.0\.0\.1|localhost)/.test(uri)) {
    throw new Error(`refusing to run against a non-local URI: ${uri}`);
  }

  const { stdout } = await run$(
    'npx',
    ['tsx', 'scripts/cleanup-orphans.ts', ...(apply ? ['--apply'] : [])],
    {
      encoding: 'utf8',
      shell: true,
      env: {
        ...process.env,
        MONGODB_URI: uri,
        SUPPORTS_TRANSACTIONS: 'false',
        ORPHANED_MEDIA_FILE: MEDIA_FILE,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return stdout;
}

async function main(): Promise<void> {
  const realMediaBefore = snapshot(REAL_MEDIA_FILE);

  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();

  try {
    await connectDb(uri);
    await Promise.all([User.init(), Follow.init(), Message.init(), Conversation.init()]);

    /**
     * Every collection the script's out-of-scope report reads by name, created
     * through its **model**. Not from the names the script lists, on purpose:
     * the script checks those names exist to catch a model whose collection has
     * been renamed, and creating them from that same list would make the check
     * pass by construction. They stay empty — the report is counted, not tested.
     */
    const outOfScope: { createCollection(): Promise<unknown> }[] = [
      Notification,
      Rating,
      WatchlistItem,
      Block,
      FollowRequest,
      AIChatMessage,
      FeedCache,
      UserStats,
      UserNeighbors,
    ];
    await Promise.all(outOfScope.map((m) => m.createCollection()));

    /* --- fixtures ------------------------------------------------------- */

    // Two accounts that exist, two ids that do not — the second pair standing
    // in for accounts someone removed by hand.
    const gone1 = new Types.ObjectId();
    const gone2 = new Types.ObjectId();

    const [alice, bob] = await User.create([
      {
        email: 'alice@velvet.test',
        username: 'alice',
        displayName: 'Alice',
        passwordHash: 'x',
        emailVerified: true,
        // Deliberately wrong: both mirrors still count the deleted account.
        followers: [gone1],
        following: [gone1],
        followerCount: 2,
        followingCount: 2,
      },
      {
        email: 'bob@velvet.test',
        username: 'bob',
        displayName: 'Bob',
        passwordHash: 'x',
        emailVerified: true,
        followerCount: 0,
        followingCount: 0,
      },
    ]);

    const pair = (a: Types.ObjectId, b: Types.ObjectId) =>
      [a, b].sort((x, y) => String(x).localeCompare(String(y)));

    const orphanConvo = await Conversation.create({
      participants: pair(alice._id as Types.ObjectId, gone1),
      unread: new Map<string, number>(),
    });
    const healthyConvo = await Conversation.create({
      participants: pair(alice._id as Types.ObjectId, bob._id as Types.ObjectId),
      unread: new Map<string, number>(),
    });

    // Three in the doomed thread, one of them carrying media.
    await Message.create([
      {
        conversationId: orphanConvo._id,
        senderId: alice._id,
        receiverId: gone1,
        kind: 'text',
        text: 'to a ghost',
        read: false,
      },
      {
        conversationId: orphanConvo._id,
        senderId: gone1,
        receiverId: alice._id,
        kind: 'text',
        text: 'from a ghost',
        read: false,
      },
      {
        conversationId: orphanConvo._id,
        senderId: gone1,
        receiverId: alice._id,
        kind: 'audio',
        text: '',
        mediaUrl:
          'https://res.cloudinary.com/demo/video/upload/v1/velvet/messages/audio/ghost.webm',
        mediaPublicId: 'velvet/messages/audio/ghost',
        mediaResourceType: 'video',
        read: false,
      },
    ]);

    // Two in the healthy thread — these must survive untouched.
    await Message.create([
      {
        conversationId: healthyConvo._id,
        senderId: alice._id,
        receiverId: bob._id,
        kind: 'text',
        text: 'keep me',
        read: false,
      },
      {
        conversationId: healthyConvo._id,
        senderId: bob._id,
        receiverId: alice._id,
        kind: 'text',
        text: 'keep me too',
        read: false,
      },
    ]);

    // Two messages pointing at a conversation that does not exist at all.
    const noSuchConvo = new Types.ObjectId();
    await Message.create([
      {
        conversationId: noSuchConvo,
        senderId: alice._id,
        receiverId: bob._id,
        kind: 'text',
        text: 'parentless one',
        read: false,
      },
      {
        conversationId: noSuchConvo,
        senderId: bob._id,
        receiverId: alice._id,
        kind: 'text',
        text: 'parentless two',
        read: false,
      },
    ]);

    await Follow.create([
      // Healthy, both directions.
      { followerId: alice._id, followingId: bob._id, status: 'accepted' },
      { followerId: bob._id, followingId: alice._id, status: 'accepted' },
      // Dangling: one end gone.
      { followerId: alice._id, followingId: gone1, status: 'accepted' },
      { followerId: gone1, followingId: alice._id, status: 'accepted' },
      // Dangling: both ends gone.
      { followerId: gone1, followingId: gone2, status: 'pending' },
    ]);

    console.log('fixtures seeded:');
    console.log(`  live: alice=${alice._id} bob=${bob._id}`);
    console.log(`  gone: ${gone1} ${gone2}`);
    console.log(`  conversations: orphan=${orphanConvo._id} healthy=${healthyConvo._id}`);
    console.log('  messages: 3 orphaned, 2 healthy, 2 parentless');
    console.log('  follow edges: 2 healthy, 3 dangling');
    console.log(`  stranded-media list → ${MEDIA_FILE}\n`);

    /**
     * The list is live before this script ever runs: the API records every
     * Cloudinary destroy that fails in it. Seed one such row. A script that
     * replaced the file would erase it, and those rows exist nowhere else.
     */
    const apiRow = {
      messageId: String(new Types.ObjectId()),
      kind: 'image',
      publicId: 'velvet/messages/images/failed-destroy',
      resourceType: 'image',
      mediaUrl: null,
      reason: 'destroy threw: fixture',
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(MEDIA_FILE, `${JSON.stringify([apiRow], null, 2)}\n`);
    const listed = (): { publicId: string | null }[] => JSON.parse(snapshot(MEDIA_FILE) ?? '[]');
    const listedAs = (publicId: string): number =>
      listed().filter((r) => r.publicId === publicId).length;

    /* --- 1. the dry run must not write ---------------------------------- */

    console.log('─── dry run');
    const dry = await cleanup(uri, false);
    console.log(dry.split('\n').filter((l) => l.trim()).slice(0, 4).join('\n'));

    expect('dry run says it is a dry run', dry.includes('Dry run'), true);
    expect('dry run finds the orphaned conversation', dry.includes('1 orphaned'), true);
    expect('dry run counts the parentless messages', dry.includes('2 with no conversation'), true);
    expect('dry run finds three dangling edges', dry.includes('3 dangling'), true);
    expect('dry run flags the stranded asset', dry.includes('velvet/messages/audio/ghost'), true);
    expect('dry run names no missing collection', dry.includes('were not found'), false);
    expect(
      'the stranded-media list lands in the temp path',
      snapshot(MEDIA_FILE)?.includes('velvet/messages/audio/ghost') ?? false,
      true,
    );
    expect('the row the API recorded is still there', listedAs(apiRow.publicId), 1);

    expect('nothing deleted: conversations', await Conversation.countDocuments({}), 2);
    expect('nothing deleted: messages', await Message.countDocuments({}), 7);
    expect('nothing deleted: edges', await Follow.countDocuments({}), 5);
    const aliceDry = await User.findById(alice._id).lean();
    expect('nothing written: followerCount', aliceDry?.followerCount, 2);

    /* --- 2. apply -------------------------------------------------------- */

    console.log('\n─── apply');
    const applied = await cleanup(uri, true);
    console.log(applied.split('\n').filter((l) => l.includes('deleted') || l.includes('@')).join('\n'));

    expect('apply announces itself', applied.includes('APPLY MODE'), true);

    expect('orphaned conversation gone', await Conversation.countDocuments({}), 1);
    const survivor = await Conversation.findOne({}).lean();
    expect('the survivor is the healthy one', String(survivor?._id), String(healthyConvo._id));

    expect('its messages gone, healthy kept', await Message.countDocuments({}), 2);
    const keptTexts = (await Message.find({}).select('text').lean())
      .map((m) => m.text)
      .sort()
      .join(' | ');
    expect('exactly the healthy pair survived', keptTexts, 'keep me | keep me too');

    expect('dangling edges gone', await Follow.countDocuments({}), 2);
    const edgeEnds = (await Follow.find({}).select('followerId followingId').lean()).every(
      (e) =>
        [String(alice._id), String(bob._id)].includes(String(e.followerId)) &&
        [String(alice._id), String(bob._id)].includes(String(e.followingId)),
    );
    expect('both surviving edges join live accounts', edgeEnds, true);

    const aliceAfter = await User.findById(alice._id).lean();
    expect('followerCount recomputed', aliceAfter?.followerCount, 1);
    expect('followingCount recomputed', aliceAfter?.followingCount, 1);
    expect('followers[] pruned to one', (aliceAfter?.followers ?? []).length, 1);
    expect(
      'and it is bob',
      String((aliceAfter?.followers ?? [])[0]),
      String(bob._id),
    );
    expect('following[] pruned to one', (aliceAfter?.following ?? []).length, 1);

    const bobAfter = await User.findById(bob._id).lean();
    expect("bob's counters filled in from his edges", bobAfter?.followerCount, 1);

    /* --- 3. idempotent --------------------------------------------------- */

    console.log('\n─── second apply');
    const again = await cleanup(uri, true);
    expect(
      'nothing left to do',
      again.includes('no orphaned conversations, messages or edges'),
      true,
    );
    expect('mirrors already correct', again.includes('every mirror already matches'), true);
    expect('still one conversation', await Conversation.countDocuments({}), 1);
    expect('still two messages', await Message.countDocuments({}), 2);
    expect('still two edges', await Follow.countDocuments({}), 2);

    /* --- 4. the stranded-media list was appended to --------------------- */

    console.log('\n─── the stranded-media list, after all three runs');
    console.log((snapshot(MEDIA_FILE) ?? '').replace(/^/gm, '    '));
    expect('the row the API recorded survived every run', listedAs(apiRow.publicId), 1);
    expect('the stranded asset is listed once, not once per run', listedAs('velvet/messages/audio/ghost'), 1);
    expect('and nothing else was added', listed().length, 2);

    /* --- 5. the real stranded-media list -------------------------------- */

    console.log('\n─── the real orphaned-media.json');
    expect(
      `untouched across all three runs (${REAL_MEDIA_FILE})`,
      snapshot(REAL_MEDIA_FILE) === realMediaBefore,
      true,
    );

    console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed`);
  } finally {
    await disconnectDb().catch(() => {});
    await mongo.stop().catch(() => {});
    rmSync(MEDIA_DIR, { recursive: true, force: true });
  }

  if (fail) process.exit(1);
}

main().catch(async (err) => {
  console.error('verify failed:', err);
  await mongoose.disconnect().catch(() => {});
  rmSync(MEDIA_DIR, { recursive: true, force: true });
  process.exit(1);
});
