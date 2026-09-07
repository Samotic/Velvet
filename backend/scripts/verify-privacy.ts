/**
 * Proof that a private account is private.
 *
 *   cd backend && npm run verify:privacy
 *
 * `profileVisibility` was stored, editable and returned for months while
 * nothing checked it — the settings screen promised something the API did not
 * keep. This script exists so that cannot quietly become true again: it asks
 * for a private account's data as five different callers and asserts what each
 * one is allowed to see.
 *
 * The anonymous cases are the important ones. The gap was not "a logged-in
 * stranger could peek"; it was that these endpoints required no session at
 * all, so a private account's entire rating history was one unauthenticated
 * GET away.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Follow } from '../src/models/Follow';
import { Rating } from '../src/models/Rating';
import { User } from '../src/models/User';

type Account = { id: string; token: string; username: string };

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const section = (s: string) => console.log(`\n${s}`);

async function run(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDb(mongo.getUri());
    await Promise.all([User.init(), Follow.init(), Rating.init()]);

    const app = createApp();
    const api = () => request(app);

    async function register(username: string): Promise<Account> {
      const r = await api()
        .post('/api/auth/register')
        .send({
          email: `${username}@velvet.test`,
          username,
          displayName: `${username} Display`,
          password: 'password123',
        });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return { id: r.body.data.user.id, token: r.body.data.token, username };
    }

    /* --- fixtures ------------------------------------------------------- */

    const priv = await register('priv');
    const pub = await register('pub');
    const stranger = await register('stranger');
    const follower = await register('follower');
    const pending = await register('pending');

    await User.updateOne({ _id: priv.id }, { $set: { profileVisibility: 'private' } });

    // Something to actually leak.
    for (const owner of [priv, pub]) {
      await Rating.create({
        userId: owner.id,
        contentId: '123',
        contentType: 'movie',
        contentTitle: 'A Private Favourite',
        rating: 5,
      });
    }

    // One accepted follower, and one who only *asked* — the distinction the
    // whole approval flow exists for.
    await Follow.create([
      { followerId: follower.id, followingId: priv.id, status: 'accepted' },
      { followerId: pending.id, followingId: priv.id, status: 'pending' },
    ]);

    /* --- helpers -------------------------------------------------------- */

    const asAnon = (path: string) => api().get(path);
    const asUser = (path: string, u: Account) =>
      api().get(path).set('Authorization', `Bearer ${u.token}`);

    const lists = (id: string) => [
      `/api/ratings/user/${id}`,
      `/api/activity/user/${id}`,
      `/api/activity/user/${id}/stats`,
      `/api/users/${id}/followers`,
      `/api/users/${id}/following`,
    ];

    /* --- 1. a public account is unchanged ------------------------------- */

    section('A public account still reads publicly');
    for (const path of lists(pub.id)) {
      const r = await asAnon(path);
      check(`anon GET ${path.replace(pub.id, ':id')} → 200`, r.status === 200, String(r.status));
    }
    {
      const r = await asAnon(`/api/users/${pub.username}`);
      check('anon sees a public profile in full', r.status === 200 && !r.body.data.user.restricted);
    }

    /* --- 2. anonymous against a private account ------------------------- */

    section('Anonymous callers get nothing from a private account');
    for (const path of lists(priv.id)) {
      const r = await asAnon(path);
      check(
        `anon GET ${path.replace(priv.id, ':id')} → 403`,
        r.status === 403,
        `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`,
      );
    }
    {
      const r = await asAnon(`/api/users/${priv.username}`);
      const u = r.body?.data?.user ?? {};
      check('anon gets the shell, marked restricted', r.status === 200 && u.restricted === true);
      check('…with no bio, age, gender or taste', !('bio' in u) && !('age' in u) && !('gender' in u) && !('favouriteGenres' in u));
      check('…with no pinned films or watch count', !('pinnedFilms' in u) && !('filmCount' in u));
      check('…but still identifiable, so it can be found', u.username === 'priv' && typeof u.displayName === 'string');
      check('…and still followable', 'isFollowing' in u && 'followRequested' in u);
    }

    /* --- 3. a signed-in stranger fares no better ------------------------ */

    section('A signed-in stranger is still a stranger');
    for (const path of lists(priv.id)) {
      const r = await asUser(path, stranger);
      check(`stranger GET ${path.replace(priv.id, ':id')} → 403`, r.status === 403, String(r.status));
    }

    /* --- 4. asking is not the same as being let in ---------------------- */

    section('A pending request grants nothing');
    for (const path of lists(priv.id)) {
      const r = await asUser(path, pending);
      check(`pending GET ${path.replace(priv.id, ':id')} → 403`, r.status === 403, String(r.status));
    }

    /* --- 5. an accepted follower sees everything ------------------------ */

    section('An accepted follower sees it all');
    for (const path of lists(priv.id)) {
      const r = await asUser(path, follower);
      check(`follower GET ${path.replace(priv.id, ':id')} → 200`, r.status === 200, String(r.status));
    }
    {
      const r = await asUser(`/api/users/${priv.username}`, follower);
      check('follower sees the full profile', r.status === 200 && !r.body.data.user.restricted);
      const ratings = await asUser(`/api/ratings/user/${priv.id}`, follower);
      check('follower can read the ratings', ratings.body.data.ratings.length === 1);
    }

    /* --- 6. the owner is never locked out of their own account ---------- */

    section('The owner always sees their own');
    for (const path of lists(priv.id)) {
      const r = await asUser(path, priv);
      check(`self GET ${path.replace(priv.id, ':id')} → 200`, r.status === 200, String(r.status));
    }
    {
      const r = await asUser(`/api/users/${priv.username}`, priv);
      check('self sees the full profile', r.status === 200 && !r.body.data.user.restricted);
    }

    console.log(`\n${'─'.repeat(56)}\n${pass} passed, ${fail} failed`);
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
