/**
 * Notification dedupe: one rule per type, and the index that allows it.
 *
 *   cd backend && npm run verify:notifications
 *
 * The old unique+sparse index deduped every type on `(userId, type)`, because
 * a compound sparse index skips a row only when *every* indexed field is
 * missing. One `message` card per user, ever. These assert both halves of the
 * fix: the index no longer collides on nulls, and each type collapses on the
 * key its own behaviour actually wants.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { Notification } from '../src/models/Notification';
import { User } from '../src/models/User';
import { notify } from '../src/utils/notify';

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
    // Builds the schema indexes, including the partial one under test.
    await Promise.all([Notification.init(), User.init()]);

    /** Minimum a User needs to validate: a 3+ char handle and a hash. */
    const account = (handle: string) =>
      User.create({
        email: `${handle}@velvet.test`,
        username: handle,
        displayName: handle,
        authProvider: 'local',
        passwordHash: 'not-a-real-hash',
      });

    const me = await account('recipient');
    const a = await account('senderone');
    const b = await account('sendertwo');

    const count = (q: Record<string, unknown>) => Notification.countDocuments({ userId: me._id, ...q });
    const badge = async () =>
      (await User.findById(me._id).select('unreadNotificationCount').lean())
        ?.unreadNotificationCount ?? 0;

    /* --- messages: one card per sender ---------------------------------- */

    section('message — one card per sender, not per message');
    {
      for (let i = 0; i < 5; i += 1) {
        await notify({
          userId: me._id,
          type: 'message',
          fromUserId: a._id,
          messageId: new Types.ObjectId(),
          preview: `message ${i}`,
        });
      }
      check('five messages from one sender make one card', (await count({ type: 'message' })) === 1);

      await notify({
        userId: me._id,
        type: 'message',
        fromUserId: b._id,
        messageId: new Types.ObjectId(),
      });
      check('a different sender makes a second', (await count({ type: 'message' })) === 2);

      // The old index made this impossible: the second insert collided.
      check('the badge matches the card count, not the message count', (await badge()) === 2);
    }

    /* --- review_like: one per (liker, review) --------------------------- */

    section('review_like — one card per liker per review');
    {
      await notify({ userId: me._id, type: 'review_like', fromUserId: a._id, contentId: 'm1' });
      await notify({ userId: me._id, type: 'review_like', fromUserId: a._id, contentId: 'm1' });
      check('the same person liking twice is one card', (await count({ type: 'review_like' })) === 1);

      await notify({ userId: me._id, type: 'review_like', fromUserId: b._id, contentId: 'm1' });
      check('a different liker is a second card', (await count({ type: 'review_like' })) === 2);

      await notify({ userId: me._id, type: 'review_like', fromUserId: a._id, contentId: 'm2' });
      check('the same liker on another review is a third', (await count({ type: 'review_like' })) === 3);
    }

    /* --- review_reply: no dedupe ---------------------------------------- */

    section('review_reply — every reply is its own card');
    {
      await notify({ userId: me._id, type: 'review_reply', fromUserId: a._id, contentId: 'm1' });
      await notify({ userId: me._id, type: 'review_reply', fromUserId: a._id, contentId: 'm1' });
      check('two replies from one person are two cards', (await count({ type: 'review_reply' })) === 2);
    }

    /* --- follow dedupe survives ----------------------------------------- */

    section('The follow dedupe the index exists for is unchanged');
    {
      const edge = new Types.ObjectId();
      await notify({ userId: me._id, type: 'follow_request', fromUserId: a._id, followId: edge });
      await notify({ userId: me._id, type: 'follow_request', fromUserId: a._id, followId: edge });
      check('a double-tapped follow is one card', (await count({ type: 'follow_request' })) === 1);

      const other = new Types.ObjectId();
      await notify({ userId: me._id, type: 'follow_request', fromUserId: b._id, followId: other });
      check('a different edge is a second card', (await count({ type: 'follow_request' })) === 2);
    }

    /* --- the index itself ----------------------------------------------- */

    section('The index is partial, not sparse');
    {
      const idx = (await Notification.collection.indexes()) as {
        name?: string;
        sparse?: boolean;
        partialFilterExpression?: unknown;
      }[];
      const dedupe = idx.find((i) => i.name === 'userId_1_type_1_followId_1');
      check('it exists', Boolean(dedupe));
      check('it is not sparse', dedupe?.sparse !== true);
      check(
        'it filters on followId being an objectId',
        JSON.stringify(dedupe?.partialFilterExpression) ===
          JSON.stringify({ followId: { $type: 'objectId' } }),
        JSON.stringify(dedupe?.partialFilterExpression),
      );
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
