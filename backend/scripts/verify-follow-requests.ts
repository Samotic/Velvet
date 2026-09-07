/** Real HTTP + MongoDB coverage for request approval and the social graph. */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request, { type Response } from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Block } from '../src/models/Block';
import { Follow } from '../src/models/Follow';
import { FollowRequest } from '../src/models/FollowRequest';
import { Notification } from '../src/models/Notification';
import { User } from '../src/models/User';

type Account = { id: string; token: string; username: string };
let passed = 0;

function check(name: string, condition: unknown) {
  assert.ok(condition, name);
  passed++;
  console.log(`  PASS ${name}`);
}

function outcome(response: Response, status: string) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body?.data?.status, status);
}

async function run() {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDb(mongo.getUri());
    // Make duplicate/racing calls exercise the production unique indexes.
    await Promise.all([User.init(), Follow.init(), FollowRequest.init(), Notification.init(), Block.init()]);
    const app = createApp();
    const api = () => request(app);
    const post = (path: string, user: Account) => api().post(path).set('Authorization', `Bearer ${user.token}`);
    const get = (path: string, user: Account) => api().get(path).set('Authorization', `Bearer ${user.token}`);
    const cancel = (from: Account, to: Account) => api().delete(`/api/users/${to.id}/follow`).set('Authorization', `Bearer ${from.token}`);
    const send = (from: Account, to: Account) => post(`/api/users/${to.id}/follow-request`, from);
    const accept = (from: Account, to: Account) => post(`/api/users/${from.id}/accept-follow`, to);
    const decline = (from: Account, to: Account) => post(`/api/users/${from.id}/decline-follow`, to);
    const profile = async (owner: Account, viewer: Account) => (await get(`/api/users/${owner.username}`, viewer)).body.data.user;
    const pending = async (user: Account, query = '') => {
      const response = await get(`/api/users/me/follow-requests${query}`, user);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.data;
    };

    async function register(username: string): Promise<Account> {
      const response = await api().post('/api/auth/register').send({
        email: `${username}@velvet.test`, username, displayName: `${username} Display`, password: 'password123',
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return { id: response.body.data.user.id, token: response.body.data.token, username };
    }

    // Assert all representations agree after each transition, including caches
    // used by existing feed/messaging code and User fields required by the UI.
    async function graph(from: Account, to: Account, expected: 'pending' | 'accepted' | null) {
      const [edge, sender, recipient] = await Promise.all([
        Follow.findOne({ followerId: from.id, followingId: to.id }).lean(),
        User.findById(from.id).lean(),
        User.findById(to.id).lean(),
      ]);
      assert.ok(sender && recipient);
      assert.equal(edge?.status ?? null, expected, 'Follow graph state');
      assert.equal(sender.following.map(String).includes(to.id), expected === 'accepted', 'confirmed following array');
      assert.equal(recipient.followers.map(String).includes(from.id), expected === 'accepted', 'confirmed followers array');
      const requestsFromSender = recipient.followRequests.filter((row) => String(row.from) === from.id);
      assert.equal(requestsFromSender.length, expected === 'pending' ? 1 : 0, 'pending User entries');
      if (expected === 'pending') assert.ok(requestsFromSender[0].createdAt instanceof Date);
      for (const person of [sender, recipient]) {
        assert.equal(person.followerCount, await Follow.countDocuments({ followingId: person._id, status: 'accepted' }), 'follower count');
        assert.equal(person.followingCount, await Follow.countDocuments({ followerId: person._id, status: 'accepted' }), 'following count');
        assert.equal(person.pendingRequestCount, await Follow.countDocuments({ followingId: person._id, status: 'pending' }), 'pending count');
        assert.equal(person.followers.length, person.followerCount, 'followers array count');
        assert.equal(person.following.length, person.followingCount, 'following array count');
        assert.equal(person.followRequests.length, person.pendingRequestCount, 'pending array count');
      }
      if (expected) {
        const record = await FollowRequest.findOne({ from: from.id, to: to.id, status: expected }).lean();
        assert.ok(record, 'FollowRequest document exists');
        assert.equal(String(record._id), String(edge!._id), 'request and graph IDs agree');
        assert.ok(record.createdAt instanceof Date);
      } else {
        assert.equal(await FollowRequest.countDocuments({ from: from.id, to: to.id, status: 'pending' }), 0);
      }
      check(`${from.username} -> ${to.username}: ${expected ?? 'not following'} is consistent`, true);
    }

    async function unread(user: Account, expected: number) {
      const [countResponse, listResponse, stored, count] = await Promise.all([
        get('/api/notifications/count', user), get('/api/notifications?limit=100', user),
        User.findById(user.id).lean(), Notification.countDocuments({ userId: user.id, read: false }),
      ]);
      assert.equal(countResponse.status, 200);
      assert.equal(listResponse.status, 200);
      assert.equal(countResponse.body.data.unread, expected);
      assert.equal(listResponse.body.data.unread, expected);
      assert.equal(stored?.unreadNotificationCount, expected, 'persisted unread cache');
      assert.equal(count, expected);
      check(`${user.username}: notification list, bell, and unread cache agree (${expected})`, true);
    }

    const ada = await register('request_ada');
    const ben = await register('request_ben');
    const cy = await register('request_cyrus');
    const dia = await register('request_diana');
    await User.updateMany({}, { $set: { emailVerified: true } });
    await User.updateOne({ _id: ada.id }, { $set: { profilePhoto: 'https://example.test/ada.png' } });

    console.log('\nAuthorization and validation');
    for (const suffix of ['follow-request', 'accept-follow', 'decline-follow']) {
      check(`${suffix} requires authentication`, (await api().post(`/api/users/${ben.id}/${suffix}`)).status === 401);
    }
    check('pending queue requires authentication', (await api().get('/api/users/me/follow-requests')).status === 401);
    check('cancelling requires authentication', (await api().delete(`/api/users/${ben.id}/follow`)).status === 401);
    check('self request is rejected', (await send(ada, ada)).status === 400);
    check('invalid target is rejected', (await post('/api/users/not-an-id/follow-request', ada)).status === 404);
    check('missing target is rejected', (await post(`/api/users/${new Types.ObjectId()}/follow-request`, ada)).status === 404);

    console.log('\nRequesting a public account');
    outcome(await send(ada, ben), 'requested');
    await graph(ada, ben, 'pending');
    check('new accounts stay public', (await profile(ben, ada)).profileVisibility === 'public');
    const requestedProfile = await profile(ben, ada);
    check('requester sees Requested without Following', requestedProfile.followRequested && !requestedProfile.isFollowing);
    check('pending request leaves follower count at zero', requestedProfile.followerCount === 0);
    check('request owner sees pending count', (await profile(ben, ben)).pendingRequestCount === 1);
    check('pending request is absent from confirmed followers', (await get(`/api/users/${ben.id}/followers`, ben)).body.data.users.length === 0);
    const queue = await pending(ben);
    check('pending queue contains the request', queue.total === 1 && queue.requests.length === 1);
    const first = queue.requests[0];
    check('request card carries identity and follower count', first.from.id === ada.id && first.from.username === ada.username && first.from.displayName === `${ada.username} Display` && first.from.profilePhoto === 'https://example.test/ada.png' && first.from.followerCount === 0);
    check('request card carries its creation date', !Number.isNaN(Date.parse(first.createdAt)));
    check('outgoing requests do not appear in own pending queue', (await pending(ada)).total === 0);
    check('requester personal credentials are absent', !JSON.stringify(queue).includes('@velvet.test') && !JSON.stringify(queue).includes('passwordHash'));
    const requestNotice = await Notification.findOne({ userId: ben.id, type: 'follow_request' }).lean();
    check('request creates an actionable unread notification', requestNotice?.actionState === 'pending' && requestNotice.read === false && String(requestNotice.fromUserId) === ada.id);
    await unread(ben, 1);
    await unread(ada, 0);

    const duplicates = await Promise.all([send(ada, ben), send(ada, ben), send(ada, ben)]);
    duplicates.forEach((response) => outcome(response, 'requested'));
    check('repeated requests create one graph edge', await Follow.countDocuments({ followerId: ada.id, followingId: ben.id }) === 1);
    check('repeated requests send one notification', await Notification.countDocuments({ userId: ben.id, type: 'follow_request' }) === 1);
    await graph(ada, ben, 'pending');
    await unread(ben, 1);

    const outsiderAccept = await accept(ada, cy);
    check('a third user cannot accept the recipient request', outsiderAccept.status >= 400 && outsiderAccept.status < 500);
    const outsiderDecline = await decline(ada, cy);
    check('a third user cannot decline the recipient request', outsiderDecline.status >= 400 && outsiderDecline.status < 500);
    check('legacy notification action also checks recipient', (await post(`/api/follow-requests/${first.id}/accept`, cy)).status === 403);
    await graph(ada, ben, 'pending');

    console.log('\nAccepting, follow-back, and mutual messaging');
    outcome(await accept(ada, ben), 'following');
    outcome(await accept(ada, ben), 'following');
    await graph(ada, ben, 'accepted');
    check('accepted request leaves the queue', (await pending(ben)).total === 0);
    check('accepted profile shows Following', (await profile(ben, ada)).isFollowing && !(await profile(ben, ada)).followRequested);
    check('recipient sees Follows you relationship', (await profile(ada, ben)).isFollowedBy && !(await profile(ada, ben)).isFollowing);
    check('accepted follower is listed', (await get(`/api/users/${ben.id}/followers`, ben)).body.data.users[0]?.id === ada.id);
    check('acceptance creates exactly one requester notification', await Notification.countDocuments({ userId: ada.id, type: 'follow_accepted', fromUserId: ben.id }) === 1);
    await unread(ben, 0);
    await unread(ada, 1);
    outcome(await send(ada, ben), 'following');
    await graph(ada, ben, 'accepted');
    const acceptedNotice = (await get('/api/notifications?limit=100', ada)).body.data.notifications.find((row: { type: string }) => row.type === 'follow_accepted');
    check('acceptance notification links to the accepting profile', acceptedNotice?.from?.id === ben.id && acceptedNotice.from.username === ben.username);

    check('one-way accepted follow cannot message', (await post(`/api/messages/${ben.id}/send`, ada).send({ text: 'Too early' })).status === 403);
    outcome(await send(ben, ada), 'requested');
    check('pending follow-back cannot message', (await post(`/api/messages/${ben.id}/send`, ada).send({ text: 'Still pending' })).status === 403);
    outcome(await accept(ben, ada), 'following');
    await graph(ben, ada, 'accepted');
    check('two accepted follows can message', (await post(`/api/messages/${ben.id}/send`, ada).send({ text: 'We follow each other now' })).status === 201);
    outcome(await cancel(ada, ben), 'not_following');
    outcome(await cancel(ada, ben), 'not_following');
    await graph(ada, ben, null);
    await graph(ben, ada, 'accepted');
    check('unfollow closes mutual messaging access', (await post(`/api/messages/${ben.id}/send`, ada).send({ text: 'No longer mutual' })).status === 403);
    outcome(await send(ada, ben), 'requested');
    await graph(ada, ben, 'pending');
    outcome(await cancel(ada, ben), 'not_following');
    await graph(ada, ben, null);

    console.log('\nDeclining silently, cancelling, and requesting again');
    await post('/api/notifications/read', ada);
    await post('/api/notifications/read', ben);
    outcome(await send(cy, ben), 'requested');
    await unread(ben, 1);
    const beforeDecline = await Notification.countDocuments({ userId: cy.id });
    outcome(await decline(cy, ben), 'declined');
    await graph(cy, ben, null);
    check('decline is retained as request history', await FollowRequest.countDocuments({ from: cy.id, to: ben.id, status: 'declined' }) === 1);
    check('decline is silent for requester', await Notification.countDocuments({ userId: cy.id }) === beforeDecline);
    check('declined request leaves the pending queue', (await pending(ben)).total === 0);
    check('declined profile offers Follow again', !(await profile(ben, cy)).followRequested && !(await profile(ben, cy)).isFollowing);
    await unread(ben, 0);
    outcome(await send(cy, ben), 'requested');
    await graph(cy, ben, 'pending');
    await unread(ben, 1);
    const cancelledId = (await pending(ben)).requests[0].id;
    outcome(await cancel(cy, ben), 'not_following');
    await graph(cy, ben, null);
    await unread(ben, 0);
    check('cancel removes actionable notifications', await Notification.countDocuments({ userId: ben.id, fromUserId: cy.id, type: 'follow_request', actionState: 'pending' }) === 0);
    check('cancelled notification action fails without resurrecting follow', (await post(`/api/follow-requests/${cancelledId}/accept`, ben)).status === 410);
    await graph(cy, ben, null);

    console.log('\nPrivate accounts and compatibility routes');
    await api().put('/api/users/me').set('Authorization', `Bearer ${dia.token}`).send({ profileVisibility: 'private' });
    outcome(await post(`/api/users/${dia.id}/follow`, cy), 'pending');
    await graph(cy, dia, 'pending');
    const privateRequestId = (await pending(dia)).requests[0].id;
    outcome(await post(`/api/follow-requests/${privateRequestId}/accept`, dia), 'accepted');
    await graph(cy, dia, 'accepted');
    outcome(await cancel(cy, dia), 'not_following');
    await graph(cy, dia, null);
    outcome(await post(`/api/users/${ben.id}/follow`, dia), 'pending');
    await graph(dia, ben, 'pending');
    const legacyRequestId = (await pending(ben)).requests[0].id;
    outcome(await post(`/api/follow-requests/${legacyRequestId}/decline`, ben), 'declined');
    await graph(dia, ben, null);

    console.log('\nConcurrent approvals and block cleanup');
    const concurrentSends = await Promise.all([send(cy, ben), send(cy, ben), send(cy, ben)]);
    concurrentSends.forEach((response) => outcome(response, 'requested'));
    await graph(cy, ben, 'pending');
    const concurrentAccepts = await Promise.all([accept(cy, ben), accept(cy, ben), accept(cy, ben)]);
    concurrentAccepts.forEach((response) => outcome(response, 'following'));
    await graph(cy, ben, 'accepted');
    check('concurrent approvals send a single accepted notification', await Notification.countDocuments({ userId: cy.id, fromUserId: ben.id, type: 'follow_accepted' }) === 1);
    outcome(await send(ben, cy), 'requested');
    check('block succeeds', (await post(`/api/users/${cy.id}/block`, ben)).status === 200);
    await graph(cy, ben, null);
    await graph(ben, cy, null);
    check('blocked requester cannot request', (await send(cy, ben)).status === 403);
    check('blocker cannot request either', (await send(ben, cy)).status === 403);
    check('blocking clears pair notifications', await Notification.countDocuments({ $or: [{ userId: cy.id, fromUserId: ben.id }, { userId: ben.id, fromUserId: cy.id }] }) === 0);
    for (const person of [ben, cy]) await unread(person, await Notification.countDocuments({ userId: person.id, read: false }));
    await api().delete(`/api/users/${cy.id}/block`).set('Authorization', `Bearer ${ben.token}`);
    outcome(await send(cy, ben), 'requested');
    await graph(cy, ben, 'pending');

    console.log('\nPending queue pagination');
    outcome(await send(dia, ben), 'requested');
    const pageOne = await pending(ben, '?limit=1');
    check('pending queue returns a total and next cursor', pageOne.total === 2 && pageOne.requests.length === 1 && typeof pageOne.nextCursor === 'string');
    const pageTwo = await pending(ben, `?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor)}`);
    check('next pending page returns the remaining request', pageTwo.requests.length === 1 && pageTwo.requests[0].id !== pageOne.requests[0].id && pageTwo.nextCursor === null);
    check('request cards report current confirmed follower counts', [...pageOne.requests, ...pageTwo.requests].every((row) => row.from.followerCount === 0));

    console.log(`\n${passed} follow-request checks passed.\n`);
  } finally {
    await disconnectDb();
    await mongo.stop();
  }
}

run().catch((error: unknown) => {
  console.error('\nFollow-request verification failed:', error);
  process.exitCode = 1;
});
