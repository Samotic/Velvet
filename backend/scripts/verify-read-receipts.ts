/**
 * Read receipts, and the mutuality rule behind them.
 *
 *   cd backend && npm run verify:receipts
 *
 * The setting is mutual: turning it off stops you sending receipts *and* stops
 * you seeing anyone else's. A one-way version — hiding your own ticks while
 * still watching everyone else's — is the first thing anyone checks, and these
 * assert both directions rather than only the flattering one.
 *
 * The socket is not exercised directly; what is asserted is the durable half.
 * `markRead` decides whether to emit, and the thread read decides whether the
 * stored `read` flag travels — and it is that second half that would leak a
 * whole history on reload if only the emit were gated.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Follow } from '../src/models/Follow';
import { User } from '../src/models/User';

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

async function run(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDb(mongo.getUri());
    await Promise.all([User.init(), Follow.init()]);
    const app = createApp();

    async function account(username: string) {
      const r = await request(app).post('/api/auth/register').send({
        email: `${username}@velvet.test`,
        username,
        displayName: username,
        password: 'password123',
      });
      return { id: r.body.data.user.id as string, token: r.body.data.token as string, username };
    }

    const sender = await account('sender');
    const reader = await account('reader');

    // Messaging needs verified addresses and a mutual follow.
    await User.updateMany({}, { $set: { emailVerified: true } });
    await Follow.create([
      { followerId: sender.id, followingId: reader.id, status: 'accepted' },
      { followerId: reader.id, followingId: sender.id, status: 'accepted' },
    ]);

    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    const send = (text: string) =>
      request(app)
        .post(`/api/messages/${reader.id}/send`)
        .set(auth(sender.token))
        .send({ text });

    const openThreadAsReader = () =>
      request(app).put(`/api/messages/${sender.id}/read`).set(auth(reader.token));

    /** What the SENDER sees on their own messages — the receipt itself. */
    const senderSeesRead = async (): Promise<boolean> => {
      const r = await request(app)
        .get(`/api/messages/${reader.id}`)
        .set(auth(sender.token));
      const mine = r.body.data.messages.filter((m: { senderId: string }) => m.senderId === sender.id);
      return mine.length > 0 && mine.every((m: { read: boolean }) => m.read === true);
    };

    const threadFlag = async (token: string, otherId: string): Promise<boolean> => {
      const r = await request(app).get(`/api/messages/${otherId}`).set(auth(token));
      return r.body.data.readReceipts;
    };

    const setReceipts = (id: string, on: boolean) =>
      User.updateOne({ _id: id }, { $set: { readReceipts: on } });

    /* --- 1. both on ----------------------------------------------------- */

    section('Both sides opted in — receipts flow');
    {
      await send('hello');
      check('the thread reports receipts active', (await threadFlag(sender.token, reader.id)) === true);
      check('before reading, the sender sees no receipt', (await senderSeesRead()) === false);

      await openThreadAsReader();
      check('after reading, the sender sees the receipt', (await senderSeesRead()) === true);
    }

    /* --- 2. the SENDER opts out ----------------------------------------- */

    section('The sender opts out — they stop receiving receipts');
    {
      await setReceipts(sender.id, false);
      check('the thread reports receipts off', (await threadFlag(sender.token, reader.id)) === false);
      check(
        'and the already-earned receipt is no longer disclosed',
        (await senderSeesRead()) === false,
      );
    }

    /* --- 3. nothing retroactive ----------------------------------------- */

    section('Turning it back on does not re-leak, and off does not un-know');
    {
      await setReceipts(sender.id, true);
      check(
        'turning it back on restores disclosure for reads that happened',
        (await senderSeesRead()) === true,
      );

      // The recipient's own unread state is theirs, and is untouched by the
      // sender's setting either way.
      const badge = await request(app).get('/api/messages/unread-count').set(auth(reader.token));
      check('the reader has no unread left', badge.body.data.unread === 0, JSON.stringify(badge.body));
    }

    /* --- 4. the READER opts out ----------------------------------------- */

    section('The reader opts out — the sender is told nothing');
    {
      await setReceipts(sender.id, true);
      await setReceipts(reader.id, false);

      await send('second message');
      await openThreadAsReader();

      check('the thread reports receipts off', (await threadFlag(sender.token, reader.id)) === false);
      check('the sender sees no receipt at all', (await senderSeesRead()) === false);
    }

    /* --- 5. mutuality, from the other side ------------------------------ */

    section('Mutuality: opting out costs you the other direction too');
    {
      // reader is off; now have the SENDER read something the reader sent, and
      // confirm the reader — who opted out — is told nothing either.
      await request(app)
        .post(`/api/messages/${sender.id}/send`)
        .set(auth(reader.token))
        .send({ text: 'from the reader' });

      await request(app).put(`/api/messages/${reader.id}/read`).set(auth(sender.token));

      const r = await request(app).get(`/api/messages/${sender.id}`).set(auth(reader.token));
      const theirs = r.body.data.messages.filter(
        (m: { senderId: string }) => m.senderId === reader.id,
      );
      check(
        'the opted-out reader gets no receipt on their own message',
        theirs.length > 0 && theirs.every((m: { read: boolean }) => m.read === false),
      );
      check('and their thread reports receipts off', r.body.data.readReceipts === false);
    }

    /* --- 6. the setting is writable through the API --------------------- */

    section('The toggle is settable and validated');
    {
      const off = await request(app)
        .put('/api/users/me')
        .set(auth(sender.token))
        .send({ readReceipts: false });
      check('turning it off succeeds', off.status === 200, String(off.status));

      const bad = await request(app)
        .put('/api/users/me')
        .set(auth(sender.token))
        .send({ readReceipts: 'yes' });
      check('a non-boolean is refused', bad.status === 422, String(bad.status));

      const stored = await User.findById(sender.id).select('readReceipts').lean();
      check('the refusal did not change the stored value', stored?.readReceipts === false);
    }

    console.log(`\n${'─'.repeat(52)}\n${pass} passed, ${fail} failed`);
  } finally {
    await disconnectDb().catch(() => {});
    await mongo.stop().catch(() => {});
  }
  if (fail) process.exit(1);
}

run().catch((err) => {
  console.error('verify failed:', err);
  process.exit(1);
});
