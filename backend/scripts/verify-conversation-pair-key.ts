/**
 * The conversation pair key, and the migration that puts it in place.
 *
 *   cd backend && npm run verify:pairkey
 *
 * The bug: `participants_1` was unique on an array field, and uniqueness on an
 * array applies per *element* — so every user could be in one conversation,
 * ever. This rebuilds exactly that shape on mongodb-memory-server, the way
 * production has it, and checks:
 *
 *   - the old index really does refuse a user's second conversation
 *   - new code against the UNMIGRATED database breaks a thread that exists —
 *     it opens empty and a send 500s — which is why the migration runs first
 *   - a dry run writes nothing
 *   - --apply backfills the keys and swaps the indexes
 *   - afterwards the existing thread's history is back and sends append to it,
 *     a user can hold two conversations, and a duplicate pair is still refused
 *   - a second --apply is a no-op, and the schema agrees with the database
 *
 * `autoIndex` is off for the connection, as in production, so nothing builds
 * indexes behind the migration's back. The migration runs as a child process —
 * it reads the URI through `config/env`, which snapshots at import — and the URI
 * is asserted local before it is spawned.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Conversation } from '../src/models/Conversation';
import { pairKeyFor } from '../src/models/conversationKey';
import { Follow } from '../src/models/Follow';
import { Message } from '../src/models/Message';
import { User } from '../src/models/User';

const run$ = promisify(execFile);

let pass = 0;
let fail = 0;

const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (s: string) => console.log(`\n${s}`);

/** Runs the migration under test against the in-memory server. */
async function migrate(uri: string, apply: boolean): Promise<string> {
  // A typo in the override must not be able to reach a real database.
  if (!/(127\.0\.0\.1|localhost)/.test(uri)) {
    throw new Error(`refusing to run against a non-local URI: ${uri}`);
  }

  const { stdout } = await run$(
    'npx',
    ['tsx', 'scripts/migrate-conversation-pair-key.ts', ...(apply ? ['--apply'] : [])],
    {
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, MONGODB_URI: uri },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return stdout;
}

/** The duplicate-key message if `fn` hit one, `null` if it succeeded. */
async function duplicateKey(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { code?: number; message?: string };
    return e.code === 11000 ? (e.message ?? 'E11000') : `not a duplicate key: ${e.message}`;
  }
}

async function main(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();

  try {
    // `connectDb` reads NODE_ENV when called, so flipping it for the connect
    // alone turns autoIndex off. The app's own config snapshotted 'test' at
    // import and is unaffected.
    process.env.NODE_ENV = 'production';
    await connectDb(uri);
    process.env.NODE_ENV = 'test';

    const raw = mongoose.connection.db!.collection('conversations');
    const app = createApp();
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    async function account(username: string) {
      const r = await request(app).post('/api/auth/register').send({
        email: `${username}@velvet.test`,
        username,
        displayName: username,
        password: 'password123',
      });
      return { id: r.body.data.user.id as string, token: r.body.data.token as string };
    }

    const send = (from: { token: string }, to: { id: string }, text: string) =>
      request(app).post(`/api/messages/${to.id}/send`).set(auth(from.token)).send({ text });

    const openThread = (as: { token: string }, other: { id: string }) =>
      request(app).get(`/api/messages/${other.id}`).set(auth(as.token));

    /* --- the production shape -------------------------------------------- */

    section('Production shape — participants_1 unique, no pairKey');

    await raw.createIndex({ participants: 1 }, { unique: true, name: 'participants_1' });
    await raw.createIndex({ lastMessageAt: -1 }, { name: 'lastMessageAt_-1' });

    const alice = await account('alice');
    const bob = await account('bob');
    const carol = await account('carol');

    // Messaging needs verified addresses and a mutual follow.
    await User.updateMany({}, { $set: { emailVerified: true } });
    await Follow.create(
      [
        [alice, bob],
        [alice, carol],
        [bob, carol],
      ].flatMap(([x, y]) => [
        { followerId: x.id, followingId: y.id, status: 'accepted' },
        { followerId: y.id, followingId: x.id, status: 'accepted' },
      ]),
    );

    const legacy = (a: string, b: string) => ({
      participants: [a, b].sort().map((id) => new Types.ObjectId(id)),
      lastMessage: '',
      lastMessageAt: null,
      lastSenderId: null,
      lastFor: {},
      unread: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // The thread alice and bob already have, written by the old code: no key.
    const { insertedId: existingId } = await raw.insertOne(legacy(alice.id, bob.id));
    await Message.create({
      conversationId: existingId,
      senderId: alice.id,
      receiverId: bob.id,
      kind: 'text',
      text: 'from before the migration',
      read: false,
    });

    const blocked = await duplicateKey(() => raw.insertOne(legacy(alice.id, carol.id)));
    check(
      "the old index refuses alice's second conversation",
      blocked?.includes('participants_1') === true,
      blocked ?? 'the insert succeeded',
    );

    /* --- new code, unmigrated database ----------------------------------- */

    section('New code before the migration — an existing thread breaks');

    const early = await openThread(alice, bob);
    check(
      'the existing thread opens empty',
      early.status === 200 && early.body.data.messages.length === 0,
      `status ${early.status}, ${early.body?.data?.messages?.length} messages`,
    );

    const earlySend = await send(alice, bob, 'into the existing thread');
    check('a send into it answers 500', earlySend.status === 500, `status ${earlySend.status}`);

    /* --- dry run --------------------------------------------------------- */

    section('Dry run');

    const dry = await migrate(uri, false);
    check('it says it is a dry run', dry.includes('Dry run. Nothing will be written.'));
    check('it plans the backfill', dry.includes('backfill pairKey on 1'), dry);
    check(
      'it plans the index swap',
      dry.includes('create pairKey_1 unique') &&
        dry.includes('drop participants_1 and recreate it without unique'),
      dry,
    );

    check('nothing written: no keys', (await raw.countDocuments({ pairKey: { $exists: true } })) === 0);
    const dryIndexes = await raw.indexes();
    check(
      'nothing written: participants_1 still unique',
      dryIndexes.find((i) => i.name === 'participants_1')?.unique === true,
    );
    check('nothing written: no pairKey_1', !dryIndexes.some((i) => i.name === 'pairKey_1'));

    /* --- apply ----------------------------------------------------------- */

    section('Apply');

    const applied = await migrate(uri, true);
    check('it announces itself', applied.includes('APPLY MODE'));
    check('it completes', applied.includes('✓ migration complete'), applied);

    const migrated = await raw.findOne({ _id: existingId });
    check(
      'the existing thread has its key',
      migrated?.pairKey === pairKeyFor(alice.id, bob.id),
      String(migrated?.pairKey),
    );

    const indexes = await raw.indexes();
    check('pairKey_1 is unique', indexes.find((i) => i.name === 'pairKey_1')?.unique === true);
    const members = indexes.find((i) => i.name === 'participants_1');
    check('participants_1 survives, not unique', members !== undefined && members.unique !== true);

    /* --- the product, afterwards ----------------------------------------- */

    section('After the migration');

    const history = await openThread(alice, bob);
    check(
      'the existing thread shows its history again',
      history.status === 200 &&
        history.body.data.messages.some((m: { text: string }) => m.text === 'from before the migration'),
      `status ${history.status}`,
    );

    const into = await send(alice, bob, 'into the existing thread');
    check('a send into it succeeds', into.status === 201, `status ${into.status}`);
    check(
      'and lands in that same conversation',
      String(into.body.data?.message?.conversationId) === String(existingId),
    );

    const second = await send(alice, carol, 'a second conversation');
    check(
      'alice can start a second conversation',
      second.status === 201,
      `status ${second.status} ${JSON.stringify(second.body)}`,
    );

    const reply = await send(carol, alice, 'a reply from the other side');
    check(
      'a reply from the other side joins it rather than opening a third',
      reply.status === 201 &&
        reply.body.data.message.conversationId === second.body.data?.message?.conversationId,
    );

    check(
      'alice is in two conversations',
      (await Conversation.countDocuments({ participants: alice.id })) === 2,
    );

    const inbox = await request(app).get('/api/messages/conversations').set(auth(alice.token));
    check(
      "alice's inbox lists both",
      inbox.body.data?.conversations?.length === 2,
      JSON.stringify(inbox.body),
    );

    // Two first messages at once. Whether they actually interleave is up to the
    // event loop; either way both must succeed and leave one thread. When they
    // do race, the loser's retry has to look up by the key that rejected it.
    const [r1, r2] = await Promise.all([send(bob, carol, 'race one'), send(carol, bob, 'race two')]);
    check(
      'simultaneous first messages both succeed',
      r1.status === 201 && r2.status === 201,
      `${r1.status} / ${r2.status}`,
    );
    check(
      'and share one conversation',
      (await Conversation.countDocuments({ pairKey: pairKeyFor(bob.id, carol.id) })) === 1,
    );

    /* --- still unique ---------------------------------------------------- */

    section('The pair is still unique');

    const dupRaw = await duplicateKey(() =>
      raw.insertOne({ ...legacy(bob.id, alice.id), pairKey: pairKeyFor(bob.id, alice.id) }),
    );
    check(
      'a second alice–bob document is refused by pairKey_1',
      dupRaw?.includes('pairKey_1') === true,
      dupRaw ?? 'the insert succeeded',
    );

    const dupModel = await duplicateKey(() =>
      Conversation.create({
        participants: [new Types.ObjectId(bob.id), new Types.ObjectId(alice.id)],
      }),
    );
    check(
      'so is one created through the model, in the other order',
      dupModel?.includes('pairKey_1') === true,
      dupModel ?? 'the create succeeded',
    );

    let selfError = '';
    try {
      await Conversation.create({
        participants: [new Types.ObjectId(alice.id), new Types.ObjectId(alice.id)],
      });
    } catch (err) {
      selfError = (err as Error).name;
    }
    check('a conversation with yourself is refused', selfError === 'ValidationError', selfError || 'created');

    /* --- re-run ---------------------------------------------------------- */

    section('Re-run');

    const again = await migrate(uri, true);
    check('a second apply has nothing to do', again.includes('already migrated — nothing to do'), again);

    const diff = await Conversation.diffIndexes();
    check(
      'the schema and the migrated database agree',
      diff.toDrop.length === 0 && diff.toCreate.length === 0,
      JSON.stringify(diff),
    );

    console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed`);
  } finally {
    await disconnectDb().catch(() => {});
    await mongo.stop().catch(() => {});
  }

  if (fail) process.exit(1);
}

main().catch(async (err) => {
  console.error('verify failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
