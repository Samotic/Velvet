/**
 * Session revocation: a token can be disowned.
 *
 *   cd backend && npm run verify:revocation
 *
 * A JWT is valid until it expires, and these live seven days. Before
 * `tokenVersion` a password reset and a logout both left a stolen token fully
 * working — the two actions a user takes when they think an account is
 * compromised did nothing to the person holding it.
 *
 * These assert the three properties that matter, against real HTTP:
 * a token issued before a reset stops working after it, a token stops working
 * after logout, and the fresh token a reset hands back is not caught in its own
 * revocation.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import crypto from 'node:crypto';

import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { User } from '../src/models/User';
import { signToken } from '../src/utils/jwt';

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
    await User.init();
    const app = createApp();

    /** Any authenticated route will do; /auth/me is the cheapest. */
    const me = (token: string) =>
      request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    async function register(username: string) {
      const r = await request(app).post('/api/auth/register').send({
        email: `${username}@velvet.test`,
        username,
        displayName: username,
        password: 'password123',
      });
      return { id: r.body.data.user.id, token: r.body.data.token as string };
    }

    /* --- 1. the baseline ------------------------------------------------ */

    section('A fresh token works');
    const alice = await register('alice');
    check('the token from register is accepted', (await me(alice.token)).status === 200);

    /* --- 2. logout ------------------------------------------------------ */

    section('Logout ends the session server-side, not just in the browser');
    {
      const out = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${alice.token}`);
      check('logout succeeds', out.status === 200, String(out.status));

      const after = await me(alice.token);
      check('the same token is now refused', after.status === 401, String(after.status));
      check(
        'and says the session ended rather than "invalid token"',
        String(after.body?.error ?? '').includes('Session ended'),
        JSON.stringify(after.body),
      );
    }

    /* --- 3. password reset ---------------------------------------------- */

    section('A password reset invalidates tokens issued before it');
    {
      const bob = await register('bob');
      check('bob starts signed in', (await me(bob.token)).status === 200);

      // Drive the reset the way the emailed link does: the raw token is only
      // ever in the email, so the stored value is its SHA-256.
      const raw = crypto.randomBytes(32).toString('hex');
      await User.updateOne(
        { _id: bob.id },
        {
          $set: {
            passwordResetToken: crypto.createHash('sha256').update(raw).digest('hex'),
            passwordResetExpires: new Date(Date.now() + 60_000),
          },
        },
      );

      const reset = await request(app)
        .post('/api/auth/reset-password')
        // `newPassword`, not `password` — see resetPassword in authController.
        .send({ token: raw, newPassword: 'a-brand-new-password' });
      check('the reset succeeds', reset.status === 200, JSON.stringify(reset.body).slice(0, 120));

      const old = await me(bob.token);
      check('the token from BEFORE the reset is refused', old.status === 401, String(old.status));

      /**
       * The race the ordering exists to prevent: sign before the bump and this
       * token carries the old version, so the user is locked out by their own
       * password change with no way back except another reset.
       */
      const fresh = reset.body.data.token as string;
      check('the token the reset returned still works', (await me(fresh)).status === 200);
    }

    /* --- 4. tokens predating the claim ---------------------------------- */

    section('A token with no tokenVersion claim is refused');
    {
      const carol = await register('carol');
      // Exactly what an old token looks like: correctly signed, claim absent.
      const legacy = signToken({
        userId: carol.id,
        username: 'carol',
        email: 'carol@velvet.test',
      } as unknown as Parameters<typeof signToken>[0]);

      const r = await me(legacy);
      check('a legacy token cannot pass the check', r.status === 401, String(r.status));
    }

    /* --- 5. one account's revocation does not touch another ------------- */

    section('Revocation is per account');
    {
      const dave = await register('dave');
      const erin = await register('erin');
      await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${dave.token}`);

      check("dave's token is gone", (await me(dave.token)).status === 401);
      check("erin's is untouched", (await me(erin.token)).status === 200);
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
