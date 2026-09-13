/**
 * End-to-end verification of the auth flow against a real (in-memory) MongoDB.
 *
 * Spins up mongodb-memory-server, connects Mongoose, and drives the actual
 * Express app with supertest — no mocks. Proves register/login/me and every
 * documented failure mode work before the real Atlas string exists.
 *
 *   npm run verify        (from backend/)
 */
// First import, not inline assignments: esbuild hoists imports above plain
// statements, so env.ts used to snapshot the real .env before these ran — and
// with SMTP or Resend configured, the registrations below sent real email.
import './testEnv';

import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}

/** Guards the #1 rule: the password hash must never appear in a response. */
function assertNoHash(name: string, body: unknown) {
  const serialized = JSON.stringify(body ?? {});
  check(`${name}: no passwordHash leaked`, !serialized.toLowerCase().includes('passwordhash'));
}

async function run() {
  const mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  const app = createApp();

  const goodUser = {
    email: 'Sam@Velvet.APP',
    username: 'sam_velvet',
    displayName: 'Sam',
    password: 'supersecret1',
  };

  console.log('\nREGISTER');
  {
    const res = await request(app).post('/api/auth/register').send(goodUser);
    check('happy path → 201', res.status === 201, `got ${res.status}`);
    check('returns a token', typeof res.body?.data?.token === 'string');
    check('returns user with id', typeof res.body?.data?.user?.id === 'string');
    check('email stored lowercased', res.body?.data?.user?.email === 'sam@velvet.app');
    check('defaults applied (isPro=false)', res.body?.data?.user?.isPro === false);
    check('defaults applied (bio="")', res.body?.data?.user?.bio === '');
    assertNoHash('register', res.body);
  }

  {
    const res = await request(app).post('/api/auth/register').send(goodUser);
    check('duplicate email → 409', res.status === 409, `got ${res.status}`);
    check('duplicate email message', res.body?.error === 'Email already registered', res.body?.error);
  }

  {
    // different email, same username but different case → still "taken"
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...goodUser, email: 'other@velvet.app', username: 'SAM_VELVET' });
    check('duplicate username (case-insensitive) → 409', res.status === 409, `got ${res.status}`);
    check('username taken message', res.body?.error === 'Username taken', res.body?.error);
  }

  {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...goodUser, email: 'not-an-email', username: 'fresh_name' });
    check('invalid email → 422', res.status === 422, `got ${res.status}`);
  }

  {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'p@velvet.app', username: 'shortpw', displayName: 'P', password: 'short' });
    check('short password → 422', res.status === 422, `got ${res.status}`);
  }

  {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...goodUser, email: 'bad@velvet.app', username: 'has spaces' });
    check('invalid username chars → 422', res.status === 422, `got ${res.status}`);
  }

  console.log('\nLOGIN');
  let token = '';
  {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@velvet.app', password: 'supersecret1' });
    check('correct credentials → 200', res.status === 200, `got ${res.status}`);
    check('returns a token', typeof res.body?.data?.token === 'string');
    token = res.body?.data?.token ?? '';
    assertNoHash('login', res.body);
  }

  {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@velvet.app', password: 'wrongpassword' });
    check('wrong password → 401', res.status === 401, `got ${res.status}`);
    check('generic error message', res.body?.error === 'Invalid email or password', res.body?.error);
  }

  {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@velvet.app', password: 'whatever12' });
    check('unknown email → 401', res.status === 401, `got ${res.status}`);
    check(
      'same generic message (no user enumeration)',
      res.body?.error === 'Invalid email or password',
      res.body?.error,
    );
  }

  console.log('\nME (protected)');
  {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    check('valid token → 200', res.status === 200, `got ${res.status}`);
    check('returns the right user', res.body?.data?.user?.username === 'sam_velvet');
    assertNoHash('me', res.body);
  }

  {
    const res = await request(app).get('/api/auth/me');
    check('missing token → 401', res.status === 401, `got ${res.status}`);
  }

  {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.real.token');
    check('invalid token → 401', res.status === 401, `got ${res.status}`);
  }

  await disconnectDb();
  await mongo.stop();

  console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nverify-auth crashed:', err);
  process.exit(1);
});
