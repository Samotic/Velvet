/**
 * Real HTTP coverage for message editing and soft deletion, driven by actual
 * `curl` against a real listening server.
 *
 *   cd backend && npx tsx scripts/verify-message-edit-delete.ts
 *
 * The database is `mongodb-memory-server`, never the developer's — fixtures
 * here include a message backdated past the edit window and a voice note that
 * was never uploaded, neither of which belongs in real data.
 *
 * `curl` rather than supertest on purpose: these are the §7 items that can be
 * checked without a browser, and the point of the exercise is to see the
 * request and the response as the wire carries them.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Conversation } from '../src/models/Conversation';
import { Follow } from '../src/models/Follow';
import { Message } from '../src/models/Message';
import { User } from '../src/models/User';

/** Port 0 = let the OS pick a free one. A fixed port strands the whole run if
 *  a previous crash left a listener behind. */
let BASE = '';

const HOUR = 60 * 60 * 1000;

type Account = { id: string; token: string; username: string };

let pass = 0;
let fail = 0;

const run$ = promisify(execFile);

/**
 * Runs a real curl, prints the command and the raw response, returns both.
 *
 * **Async, not `spawnSync`.** The server under test runs in this same process,
 * so a synchronous child would block the event loop that has to answer the
 * request — curl waits for a reply Node cannot send until curl exits, and the
 * script deadlocks. Awaiting yields the loop back to Express between calls.
 */
async function curl(
  label: string,
  args: string[],
  shown: string,
): Promise<{ status: number; body: string }> {
  console.log(`\n─── ${label}`);
  console.log(`$ ${shown}`);

  const { stdout } = await run$('curl', ['-s', '-w', '\n<<%{http_code}>>', ...args], {
    encoding: 'utf8',
  });

  const m = stdout.match(/\n<<(\d{3})>>$/);
  const status = m ? Number(m[1]) : 0;
  const body = stdout.replace(/\n<<\d{3}>>$/, '');

  console.log(`${status} ${body}`);
  return { status, body };
}

function expect(name: string, got: number, want: number, body = ''): void {
  if (got === want) {
    pass++;
    console.log(`  ✓ ${name} → ${want}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} → expected ${want}, got ${got}  ${body}`);
  }
}

const auth = (t: string) => ['-H', `Authorization: Bearer ${t}`];
const json = ['-H', 'Content-Type: application/json'];

async function run(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  let server: Server | null = null;

  try {
    await connectDb(mongo.getUri());
    await Promise.all([User.init(), Follow.init(), Message.init(), Conversation.init()]);

    const app = createApp();
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address();
    BASE = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
    console.log(`server listening on ${BASE}\n`);

    /* --- fixtures ------------------------------------------------------- */

    async function register(username: string): Promise<Account> {
      const { stdout } = await run$(
        'curl',
        [
          '-s',
          `${BASE}/api/auth/register`,
          ...json,
          '-d',
          JSON.stringify({
            email: `${username}@velvet.test`,
            username,
            displayName: `${username} Display`,
            password: 'password123',
          }),
        ],
        { encoding: 'utf8' },
      );
      const data = JSON.parse(stdout).data;
      return { id: data.user.id, token: data.token, username };
    }

    const alice = await register('alice');
    const bob = await register('bob');

    // Messaging is gated on a verified address and a mutual follow. Both are
    // set directly: this script is testing edit and delete, not onboarding.
    await User.updateMany({}, { $set: { emailVerified: true } });
    await Follow.create([
      { followerId: alice.id, followingId: bob.id, status: 'accepted' },
      { followerId: bob.id, followingId: alice.id, status: 'accepted' },
    ]);

    const convo = await Conversation.create({
      participants: [alice.id, bob.id].sort().map((id) => new Types.ObjectId(id)),
      unread: new Map<string, number>(),
    });

    const make = async (over: Record<string, unknown> = {}) =>
      Message.create({
        conversationId: convo._id,
        senderId: alice.id,
        receiverId: bob.id,
        kind: 'text',
        text: 'original text',
        read: false,
        ...over,
      });

    const fresh = await make();
    const forDeleteMe = await make({ text: 'hide me' });
    const forTombstone = await make({
      kind: 'image',
      text: '',
      mediaUrl: 'https://res.cloudinary.com/demo/image/upload/v1712345678/velvet/messages/images/abc123.jpg',
      mediaPublicId: 'velvet/messages/images/abc123',
      mediaResourceType: 'image',
    });
    const voice = await make({
      kind: 'audio',
      text: '',
      mediaUrl: 'https://res.cloudinary.com/demo/video/upload/v1712345678/velvet/messages/audio/xyz789.webm',
      mediaPublicId: 'velvet/messages/audio/xyz789',
      mediaResourceType: 'video',
      mediaDuration: 4.2,
    });

    /**
     * Backdated past the 48h window. Cannot be done over the API — which is
     * the point: the window is enforced on `createdAt`, not on a client claim.
     *
     * Written through the **native driver**. Mongoose marks a timestamps-managed
     * `createdAt` immutable, so a model `updateOne` drops the `$set` silently
     * and the fixture comes back with today's date — which is exactly what
     * happened on the first run of this script, and made a working 403 look
     * like a 200.
     */
    const old = await make({ text: 'too old to edit' });
    await mongoose.connection.db!.collection('messages').updateOne(
      { _id: old._id as unknown as Types.ObjectId },
      { $set: { createdAt: new Date(Date.now() - 49 * HOUR) } },
    );
    const backdated = await Message.findById(old._id);
    const ageHours = Math.round((Date.now() - (backdated?.createdAt.getTime() ?? 0)) / HOUR);
    console.log(`  (backdated fixture is ${ageHours}h old — window is 48h)`);

    console.log('fixtures:');
    console.log(`  alice=${alice.id}  bob=${bob.id}  conversation=${convo._id}`);
    console.log(`  fresh=${fresh._id}  old=${old._id}  voice=${voice._id}`);
    console.log(`  forDeleteMe=${forDeleteMe._id}  forTombstone=${forTombstone._id}`);

    /* --- 1. non-sender PATCH → 403 -------------------------------------- */

    let r = await curl(
      'Recipient tries to edit the sender\'s message',
      ['-X', 'PATCH', `${BASE}/api/messages/${fresh._id}`, ...auth(bob.token), ...json,
       '-d', '{"text":"hijacked"}'],
      `curl -X PATCH ${BASE}/api/messages/${fresh._id} \\\n    -H 'Authorization: Bearer $BOB' -H 'Content-Type: application/json' \\\n    -d '{"text":"hijacked"}'`,
    );
    expect('non-sender PATCH', r.status, 403, r.body);
    const untouched = await Message.findById(fresh._id);
    console.log(`  DB: text=${JSON.stringify(untouched?.text)} editedAt=${String(untouched?.editedAt)}`);

    /* --- 2. DELETE without scope → 400 ---------------------------------- */

    r = await curl(
      'DELETE with no scope',
      ['-X', 'DELETE', `${BASE}/api/messages/${fresh._id}`, ...auth(alice.token)],
      `curl -X DELETE ${BASE}/api/messages/${fresh._id} \\\n    -H 'Authorization: Bearer $ALICE'`,
    );
    expect('missing scope', r.status, 400, r.body);

    /* --- 3. expired window → 403 ---------------------------------------- */

    r = await curl(
      'Edit a message older than EDIT_WINDOW_MS (49h)',
      ['-X', 'PATCH', `${BASE}/api/messages/${old._id}`, ...auth(alice.token), ...json,
       '-d', '{"text":"late edit"}'],
      `curl -X PATCH ${BASE}/api/messages/${old._id} \\\n    -H 'Authorization: Bearer $ALICE' -H 'Content-Type: application/json' \\\n    -d '{"text":"late edit"}'`,
    );
    expect('expired edit window', r.status, 403, r.body);

    /* --- 4. empty edit → 400 -------------------------------------------- */

    r = await curl(
      'Edit to whitespace only',
      ['-X', 'PATCH', `${BASE}/api/messages/${fresh._id}`, ...auth(alice.token), ...json,
       '-d', '{"text":"   "}'],
      `curl -X PATCH ${BASE}/api/messages/${fresh._id} \\\n    -H 'Authorization: Bearer $ALICE' -H 'Content-Type: application/json' \\\n    -d '{"text":"   "}'`,
    );
    expect('empty edit', r.status, 400, r.body);

    /* --- 5. edit a voice note → 400 ------------------------------------- */

    r = await curl(
      'Edit a voice note',
      ['-X', 'PATCH', `${BASE}/api/messages/${voice._id}`, ...auth(alice.token), ...json,
       '-d', '{"text":"caption"}'],
      `curl -X PATCH ${BASE}/api/messages/${voice._id} \\\n    -H 'Authorization: Bearer $ALICE' -H 'Content-Type: application/json' \\\n    -d '{"text":"caption"}'`,
    );
    expect('edit a voice note', r.status, 400, r.body);

    /* --- 5b. a legitimate edit, for contrast ---------------------------- */

    r = await curl(
      'Sender edits their own fresh message',
      ['-X', 'PATCH', `${BASE}/api/messages/${fresh._id}`, ...auth(alice.token), ...json,
       '-d', '{"text":"edited text"}'],
      `curl -X PATCH ${BASE}/api/messages/${fresh._id} \\\n    -H 'Authorization: Bearer $ALICE' -H 'Content-Type: application/json' \\\n    -d '{"text":"edited text"}'`,
    );
    expect('legitimate edit', r.status, 200, r.body);
    const edited = await Message.findById(fresh._id);
    console.log(
      `  DB: text=${JSON.stringify(edited?.text)}  editedAt=${edited?.editedAt ? 'set' : 'null'}  ` +
        `editHistory=${JSON.stringify(edited?.editHistory.map((h) => h.text))}`,
    );

    /* --- 6. delete for me: invisibility --------------------------------- */

    r = await curl(
      'Alice deletes a message for herself only',
      ['-X', 'DELETE', `${BASE}/api/messages/${forDeleteMe._id}?scope=me`, ...auth(alice.token)],
      `curl -X DELETE '${BASE}/api/messages/${forDeleteMe._id}?scope=me' \\\n    -H 'Authorization: Bearer $ALICE'`,
    );
    expect('delete for me', r.status, 200, r.body);

    const aliceThread = await curl(
      "Alice's thread — the hidden message must be absent",
      [`${BASE}/api/messages/${bob.id}`, ...auth(alice.token)],
      `curl ${BASE}/api/messages/${bob.id} -H 'Authorization: Bearer $ALICE'`,
    );
    const bobThread = await curl(
      "Bob's thread — the same message must still be present",
      [`${BASE}/api/messages/${alice.id}`, ...auth(bob.token)],
      `curl ${BASE}/api/messages/${alice.id} -H 'Authorization: Bearer $BOB'`,
    );

    const inAlice = aliceThread.body.includes(String(forDeleteMe._id));
    const inBob = bobThread.body.includes(String(forDeleteMe._id));
    expect('hidden from the deleter', inAlice ? 1 : 0, 0);
    expect('still visible to the other participant', inBob ? 1 : 0, 1);

    const stillThere = await Message.findById(forDeleteMe._id);
    console.log(
      `  DB: document kept, text=${JSON.stringify(stillThere?.text)}  ` +
        `deletedFor=[${stillThere?.deletedFor.map(String).join(', ')}]  (alice=${alice.id})`,
    );

    /* --- 7. delete for everyone: tombstone ------------------------------ */

    const before = await Message.findById(forTombstone._id);
    console.log(
      `\n  DB before: text=${JSON.stringify(before?.text)}  mediaUrl=${before?.mediaUrl ? 'set' : 'null'}  ` +
        `publicId=${before?.mediaPublicId}`,
    );

    r = await curl(
      'Alice deletes an image message for everyone',
      ['-X', 'DELETE', `${BASE}/api/messages/${forTombstone._id}`, ...auth(alice.token), ...json,
       '-d', '{"scope":"everyone"}'],
      `curl -X DELETE ${BASE}/api/messages/${forTombstone._id} \\\n    -H 'Authorization: Bearer $ALICE' -H 'Content-Type: application/json' \\\n    -d '{"scope":"everyone"}'`,
    );
    expect('delete for everyone', r.status, 200, r.body);

    // Read raw, so these are the stored values and not Mongoose defaults.
    const raw = await mongoose.connection
      .db!.collection('messages')
      .findOne({ _id: forTombstone._id as unknown as Types.ObjectId });

    console.log('\n  RAW tombstone document (native driver):');
    console.log(
      JSON.stringify(
        {
          _id: raw?._id,
          kind: raw?.kind,
          text: raw?.text,
          mediaUrl: raw?.mediaUrl,
          mediaPublicId: raw?.mediaPublicId,
          editHistory: raw?.editHistory,
          deletedForEveryone: raw?.deletedForEveryone,
          deletedAt: raw?.deletedAt,
          deletedBy: raw?.deletedBy,
        },
        null,
        2,
      )
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );

    expect('tombstone flag set', raw?.deletedForEveryone === true ? 1 : 0, 1);
    expect('text cleared', raw?.text === '' ? 1 : 0, 1);
    expect('mediaUrl cleared', raw?.mediaUrl === null ? 1 : 0, 1);
    expect('document kept, not removed', raw ? 1 : 0, 1);

    const bobAfter = await curl(
      "Bob's thread — tombstone present, content gone",
      [`${BASE}/api/messages/${alice.id}`, ...auth(bob.token)],
      `curl ${BASE}/api/messages/${alice.id} -H 'Authorization: Bearer $BOB'`,
    );
    expect(
      'tombstone still delivered to the recipient',
      bobAfter.body.includes(String(forTombstone._id)) ? 1 : 0,
      1,
    );

    const convoAfter = await Conversation.findById(convo._id);
    console.log(`\n  lastFor after the retraction:`);
    for (const [k, v] of convoAfter?.lastFor ?? new Map()) {
      console.log(`    ${k} → ${JSON.stringify(v.text)}  fromMe=${String(v.senderId) === k}`);
    }

    console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed`);
  } finally {
    if (server) await new Promise<void>((r2) => server!.close(() => r2()));
    await disconnectDb().catch(() => {});
    await mongo.stop().catch(() => {});
  }

  if (fail) process.exit(1);
}

run().catch(async (err) => {
  console.error('verify failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
