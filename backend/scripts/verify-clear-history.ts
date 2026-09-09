/**
 * Real HTTP coverage for conversation-level clearing.
 *
 *   cd backend && npm run verify:clear
 *
 * The two scopes are not variations on each other and this script is built
 * around the difference:
 *
 *   - `me` hides the whole thread from one viewer and must be invisible to the
 *     other, must not stop new messages arriving, and must zero my unread.
 *   - `everyone` retracts **only my own** messages, and only those still inside
 *     `DELETE_WINDOW_MS` — so it leaves their half and my older half exactly
 *     where they were. That asymmetry is what the UI label has to promise, so
 *     it is what the tests assert.
 *
 * `curl` against a real listening server, on `mongodb-memory-server`, for the
 * same reason as `verify-message-edit-delete.ts`: fixtures here include a
 * message backdated past the window, which cannot be created over the API.
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

let BASE = '';
const HOUR = 60 * 60 * 1000;

type Account = { id: string; token: string; username: string };

let pass = 0;
let fail = 0;

const run$ = promisify(execFile);

/** Async, never `spawnSync` — the server under test shares this event loop. */
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

function expect(name: string, got: unknown, want: unknown, extra = ''): void {
  if (got === want) {
    pass++;
    console.log(`  ✓ ${name} → ${JSON.stringify(want)}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} → expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}  ${extra}`);
  }
}

const auth = (t: string) => ['-H', `Authorization: Bearer ${t}`];
const json = ['-H', 'Content-Type: application/json'];

/** Message ids visible to `who`, in the order the thread endpoint returns them. */
async function threadIds(who: Account, otherId: string): Promise<string[]> {
  const { stdout } = await run$(
    'curl',
    ['-s', `${BASE}/api/messages/${otherId}`, ...auth(who.token)],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout) as { data?: { messages?: { id: string }[] } };
  return (parsed.data?.messages ?? []).map((m) => m.id);
}

/** One row from `who`'s sidebar, or null when the thread is not listed. */
async function sidebarRow(
  who: Account,
  otherId: string,
): Promise<{ lastMessage: string; unread: number; lastFromMe: boolean } | null> {
  const { stdout } = await run$(
    'curl',
    ['-s', `${BASE}/api/messages/conversations`, ...auth(who.token)],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout) as {
    data?: {
      conversations?: {
        user: { id: string };
        lastMessage: string;
        unread: number;
        lastFromMe: boolean;
      }[];
    };
  };
  const row = (parsed.data?.conversations ?? []).find((c) => c.user.id === otherId);
  return row ? { lastMessage: row.lastMessage, unread: row.unread, lastFromMe: row.lastFromMe } : null;
}

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

    await User.updateMany({}, { $set: { emailVerified: true } });
    await Follow.create([
      { followerId: alice.id, followingId: bob.id, status: 'accepted' },
      { followerId: bob.id, followingId: alice.id, status: 'accepted' },
    ]);

    const convo = await Conversation.create({
      participants: [alice.id, bob.id].sort().map((id) => new Types.ObjectId(id)),
      unread: new Map<string, number>(),
    });

    const make = async (from: Account, over: Record<string, unknown> = {}) =>
      Message.create({
        conversationId: convo._id,
        senderId: from.id,
        receiverId: from.id === alice.id ? bob.id : alice.id,
        kind: 'text',
        text: 'a message',
        read: false,
        ...over,
      });

    // Alice: two fresh, one image, one backdated past the window.
    const a1 = await make(alice, { text: 'alice one' });
    const a2 = await make(alice, { text: 'alice two' });
    const aImg = await make(alice, {
      kind: 'image',
      text: '',
      mediaUrl:
        'https://res.cloudinary.com/demo/image/upload/v1712345678/velvet/messages/images/clr123.jpg',
      mediaPublicId: 'velvet/messages/images/clr123',
      mediaResourceType: 'image',
    });
    const aOld = await make(alice, { text: 'alice, long ago' });

    // Bob: two, the second of which is the thread's last message.
    const b1 = await make(bob, { text: 'bob one' });
    const b2 = await make(bob, { text: 'bob two, the newest' });

    /**
     * Backdated through the **native driver**. Mongoose marks a
     * timestamps-managed `createdAt` immutable, so a model `updateOne` drops
     * the `$set` silently and the fixture comes back dated today — which turns
     * "skipped, too old" into "retracted" and the assertion into a lie.
     */
    await mongoose.connection
      .db!.collection('messages')
      .updateOne(
        { _id: aOld._id as unknown as Types.ObjectId },
        { $set: { createdAt: new Date(Date.now() - 49 * HOUR) } },
      );
    const backdated = await Message.findById(aOld._id);
    console.log(
      `  (backdated fixture is ${Math.round(
        (Date.now() - (backdated?.createdAt.getTime() ?? 0)) / HOUR,
      )}h old — window is 48h)`,
    );

    /**
     * Unread counters, set to match the fixtures rather than accumulated by
     * sending: four of Alice's are unread for Bob, two of Bob's for Alice. The
     * `everyone` pass must take Bob's down by exactly the number it retracts —
     * three — and leave the fourth, which is too old to touch.
     */
    await Conversation.updateOne(
      { _id: convo._id },
      { $set: { [`unread.${bob.id}`]: 4, [`unread.${alice.id}`]: 2 } },
    );
    // The newest message is Bob's, so both sidebars start on his text.
    await Conversation.updateOne(
      { _id: convo._id },
      {
        $set: {
          lastMessageAt: new Date(),
          [`lastFor.${alice.id}`]: { text: 'bob two, the newest', at: new Date(), senderId: bob.id },
          [`lastFor.${bob.id}`]: { text: 'bob two, the newest', at: new Date(), senderId: bob.id },
        },
      },
    );

    console.log('\nfixtures:');
    console.log(`  alice=${alice.id}  bob=${bob.id}  conversation=${convo._id}`);
    console.log(`  alice: ${a1._id} ${a2._id} ${aImg._id} (image) ${aOld._id} (49h old)`);
    console.log(`  bob:   ${b1._id} ${b2._id}`);

    /* --- 1. bad input ---------------------------------------------------- */

    let r = await curl(
      'Clear with no scope',
      ['-X', 'DELETE', `${BASE}/api/messages/${bob.id}/history`, ...auth(alice.token)],
      `curl -X DELETE ${BASE}/api/messages/$BOB/history -H 'Authorization: Bearer $ALICE'`,
    );
    expect('missing scope rejected', r.status, 400, r.body);

    r = await curl(
      'Clear with a scope that is neither',
      ['-X', 'DELETE', `${BASE}/api/messages/${bob.id}/history`, ...auth(alice.token), ...json,
       '-d', '{"scope":"all"}'],
      `curl -X DELETE ${BASE}/api/messages/$BOB/history -d '{"scope":"all"}'`,
    );
    expect('unknown scope rejected', r.status, 400, r.body);

    r = await curl(
      'Clear against a malformed user id',
      ['-X', 'DELETE', `${BASE}/api/messages/not-an-id/history`, ...auth(alice.token), ...json,
       '-d', '{"scope":"me"}'],
      `curl -X DELETE ${BASE}/api/messages/not-an-id/history -d '{"scope":"me"}'`,
    );
    expect('malformed id rejected', r.status, 404, r.body);

    r = await curl(
      'Clear a conversation that was never started',
      ['-X', 'DELETE', `${BASE}/api/messages/${new Types.ObjectId()}/history`, ...auth(alice.token),
       ...json, '-d', '{"scope":"everyone"}'],
      `curl -X DELETE ${BASE}/api/messages/$STRANGER/history -d '{"scope":"everyone"}'`,
    );
    expect('no thread is not an error', r.status, 200, r.body);

    /* --- 2. clear for me ------------------------------------------------- */

    r = await curl(
      'Alice clears the whole thread for herself',
      ['-X', 'DELETE', `${BASE}/api/messages/${bob.id}/history`, ...auth(alice.token), ...json,
       '-d', '{"scope":"me"}'],
      `curl -X DELETE ${BASE}/api/messages/$BOB/history \\\n    -H 'Authorization: Bearer $ALICE' -d '{"scope":"me"}'`,
    );
    expect('clear for me accepted', r.status, 200, r.body);
    const meBody = JSON.parse(r.body).data as { retracted: number; skippedTooOld: number };
    expect('nothing retracted', meBody.retracted, 0);
    expect('nothing reported too old', meBody.skippedTooOld, 0);

    const aliceAfterMe = await threadIds(alice, bob.id);
    const bobAfterMe = await threadIds(bob, alice.id);
    console.log(`\n  alice sees ${aliceAfterMe.length} messages, bob sees ${bobAfterMe.length}`);
    expect('alice sees an empty thread', aliceAfterMe.length, 0);
    expect('bob still sees all six', bobAfterMe.length, 6);

    const stillThere = await Message.countDocuments({
      conversationId: convo._id,
      deletedForEveryone: { $ne: true },
    });
    expect('no message was actually destroyed', stillThere, 6);

    const imgDoc = await Message.findById(aImg._id);
    expect(
      'clear-for-me left the media alone',
      imgDoc?.mediaPublicId,
      'velvet/messages/images/clr123',
      'the other side still has this message',
    );

    let aliceRow = await sidebarRow(alice, bob.id);
    let bobRow = await sidebarRow(bob, alice.id);
    console.log(`  alice row: ${JSON.stringify(aliceRow)}`);
    console.log(`  bob row:   ${JSON.stringify(bobRow)}`);
    expect('alice unread zeroed', aliceRow?.unread, 0);
    expect('alice preview emptied', aliceRow?.lastMessage, '');
    expect("bob's preview untouched", bobRow?.lastMessage, 'bob two, the newest');
    expect("bob's unread untouched", bobRow?.unread, 4);

    /* --- 3. clearing for me is idempotent, and does not stop the thread --- */

    r = await curl(
      'Alice clears for herself a second time',
      ['-X', 'DELETE', `${BASE}/api/messages/${bob.id}/history`, ...auth(alice.token), ...json,
       '-d', '{"scope":"me"}'],
      `curl -X DELETE ${BASE}/api/messages/$BOB/history -d '{"scope":"me"}'`,
    );
    expect('second clear is a no-op, not an error', r.status, 200, r.body);

    r = await curl(
      'Bob sends a new message after Alice cleared',
      ['-X', 'POST', `${BASE}/api/messages/${alice.id}/send`, ...auth(bob.token), ...json,
       '-d', '{"text":"still here"}'],
      `curl -X POST ${BASE}/api/messages/$ALICE/send -H 'Authorization: Bearer $BOB' \\\n    -d '{"text":"still here"}'`,
    );
    expect('send still works', r.status, 201, r.body);

    const aliceAfterNew = await threadIds(alice, bob.id);
    expect('the new message reaches the cleared thread', aliceAfterNew.length, 1);
    aliceRow = await sidebarRow(alice, bob.id);
    expect('and reappears in her sidebar', aliceRow?.lastMessage, 'still here');
    expect('with an unread mark', aliceRow?.unread, 1);

    /* --- 4. delete my recent messages ------------------------------------ */

    r = await curl(
      'Alice deletes her own recent messages, for both of them',
      ['-X', 'DELETE', `${BASE}/api/messages/${bob.id}/history`, ...auth(alice.token), ...json,
       '-d', '{"scope":"everyone"}'],
      `curl -X DELETE ${BASE}/api/messages/$BOB/history \\\n    -H 'Authorization: Bearer $ALICE' -d '{"scope":"everyone"}'`,
    );
    expect('clear for everyone accepted', r.status, 200, r.body);
    const allBody = JSON.parse(r.body).data as { retracted: number; skippedTooOld: number };
    expect('three retracted — the two texts and the image', allBody.retracted, 3);
    expect('one skipped, past the 48h window', allBody.skippedTooOld, 1);

    const [d1, d2, dImg, dOld, db1, db2] = await Promise.all(
      [a1, a2, aImg, aOld, b1, b2].map((m) => Message.findById(m._id)),
    );

    console.log('\n  after the retraction:');
    for (const [name, doc] of [
      ['a1', d1], ['a2', d2], ['aImg', dImg], ['aOld', dOld], ['b1', db1], ['b2', db2],
    ] as const) {
      console.log(
        `    ${name.padEnd(5)} tombstone=${String(doc?.deletedForEveryone ?? false).padEnd(5)} text=${JSON.stringify(doc?.text)}`,
      );
    }

    expect('a1 retracted', d1?.deletedForEveryone, true);
    expect('a2 retracted', d2?.deletedForEveryone, true);
    expect('the image retracted', dImg?.deletedForEveryone, true);
    expect('its media reference cleared', dImg?.mediaPublicId, null);
    expect('the 49h message left alone', dOld?.deletedForEveryone ?? false, false);
    expect('and its text intact', dOld?.text, 'alice, long ago');
    expect("bob's first left alone", db1?.deletedForEveryone ?? false, false);
    expect("bob's second left alone", db2?.text, 'bob two, the newest');

    const bobFinal = await threadIds(bob, alice.id);
    expect('bob still sees seven rows, three of them tombstones', bobFinal.length, 7);

    bobRow = await sidebarRow(bob, alice.id);
    console.log(`  bob row: ${JSON.stringify(bobRow)}`);
    expect(
      "bob's unread fell by exactly the three retracted",
      bobRow?.unread,
      1,
      'the fourth was too old to touch',
    );
    expect("bob's preview is still his own last message", bobRow?.lastMessage, 'still here');
    expect('and it is marked as his', bobRow?.lastFromMe, true);

    /* --- 5. and again, with nothing left inside the window ---------------- */

    r = await curl(
      'Alice runs it again with nothing eligible left',
      ['-X', 'DELETE', `${BASE}/api/messages/${bob.id}/history`, ...auth(alice.token), ...json,
       '-d', '{"scope":"everyone"}'],
      `curl -X DELETE ${BASE}/api/messages/$BOB/history -d '{"scope":"everyone"}'`,
    );
    expect('repeat is accepted', r.status, 200, r.body);
    const againBody = JSON.parse(r.body).data as { retracted: number; skippedTooOld: number };
    expect('nothing retracted the second time', againBody.retracted, 0);
    expect('the old one is still reported, not forgotten', againBody.skippedTooOld, 1);

    /* --- 6. it is the sender's action, not the recipient's ---------------- */

    r = await curl(
      "Bob clears his recent messages — Alice's stay",
      ['-X', 'DELETE', `${BASE}/api/messages/${alice.id}/history`, ...auth(bob.token), ...json,
       '-d', '{"scope":"everyone"}'],
      `curl -X DELETE ${BASE}/api/messages/$ALICE/history -H 'Authorization: Bearer $BOB' \\\n    -d '{"scope":"everyone"}'`,
    );
    const bobBody = JSON.parse(r.body).data as { retracted: number };
    expect("bob retracts his own three", bobBody.retracted, 3);
    const oldStill = await Message.findById(aOld._id);
    expect("alice's old message survived bob's clear", oldStill?.text, 'alice, long ago');

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
