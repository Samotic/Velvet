/**
 * The advisor allowance, and that a failed request gives it back.
 *
 *   cd backend && npm run verify:quota
 *
 * `testEnv` blanks GEMINI_API_KEY, so every model call throws
 * `AiNotConfiguredError` — which is exactly the fixture this needs. It is a
 * real failure on the real code path: the allowance is taken, the model call
 * throws, and the catch has to notice.
 *
 * The bug being guarded against is not hypothetical. The first version of the
 * refund fired only on the empty-clip branch, so a Gemini outage silently cost
 * every user a message per attempt.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
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

/** A one-frame silent webm. Shape is what matters — it never reaches a model. */
const CLIP = `data:audio/webm;codecs=opus;base64,${'A'.repeat(64)}`;

async function run(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDb(mongo.getUri());
    await User.init();
    const app = createApp();

    const reg = await request(app).post('/api/auth/register').send({
      email: 'quota@velvet.test',
      username: 'quota',
      displayName: 'Quota',
      password: 'password123',
    });
    const token = reg.body.data.token;
    const id = reg.body.data.user.id;
    await User.updateOne({ _id: id }, { $set: { emailVerified: true } });

    const used = async () =>
      (await User.findById(id).select('aiMessagesUsedToday').lean())?.aiMessagesUsedToday ?? 0;

    const ask = (body: Record<string, unknown>) =>
      request(app).post('/api/ai/chat').set('Authorization', `Bearer ${token}`).send(body);

    console.log('\nA failing TEXT request refunds the message');
    {
      const before = await used();
      const r = await ask({ message: 'What should I watch?' });
      const after = await used();
      check('the model call failed as expected', r.status === 503, `got ${r.status}`);
      check('the allowance is unchanged', after === before, `${before} -> ${after}`);
    }

    console.log('\nA failing AUDIO request refunds too');
    {
      const before = await used();
      const r = await ask({ kind: 'audio', media: CLIP });
      const after = await used();
      // Transcription is the first model call, and it throws before the answer.
      check('transcription failed as expected', r.status === 503, `got ${r.status}`);
      check('the allowance is unchanged', after === before, `${before} -> ${after}`);
    }

    console.log('\nA request rejected before any spend never charges');
    {
      const before = await used();
      const empty = await ask({ message: '   ' });
      const bad = await ask({ kind: 'audio', media: 'data:audio/webm;base64,!!!' });
      const after = await used();
      check('an empty question is 422', empty.status === 422, String(empty.status));
      check('a malformed clip is 422', bad.status === 422, String(bad.status));
      check('neither touched the allowance', after === before, `${before} -> ${after}`);
    }

    console.log('\nThe allowance still bounds a working request');
    {
      // Drive the counter to the cap directly — the model is unreachable here,
      // so the only way to observe the 429 is to arrive at it already spent.
      await User.updateOne(
        { _id: id },
        { $set: { aiMessagesUsedToday: 999, aiMessagesResetAt: new Date() } },
      );
      const r = await ask({ kind: 'audio', media: CLIP });
      check('a spent account is refused', r.status === 429, String(r.status));
      const after = await used();
      check('and the refusal did not decrement below the cap', after === 999, String(after));
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
