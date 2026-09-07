import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { test } from 'node:test';

import { notificationPayload } from './serialize';

/**
 * Guards the seam the HTTP suites cannot reach.
 *
 * The list endpoint and the socket push must hand the client the *same* shape.
 * They did not: the list mapped `fromUserId` to `from`/`actor` and `followId`
 * to `followRequestId`, while the socket emitted the raw document. The
 * notifications page prepends a pushed row verbatim, so a follow request that
 * arrived live rendered as "Someone wants to follow you" with no avatar and no
 * Accept/Decline until the page was reloaded.
 *
 * These assert the field names the client actually reads. Renaming one here
 * without renaming it in `lib/contentTypes.ts` should fail.
 */

const actorId = new Types.ObjectId();
const followId = new Types.ObjectId();
const notificationId = new Types.ObjectId();

const row = () => ({
  _id: notificationId,
  type: 'follow_request',
  fromUserId: {
    _id: actorId,
    username: 'ada',
    displayName: 'Ada Lovelace',
    profilePhoto: null,
  },
  contentId: null,
  contentType: null,
  contentTitle: null,
  read: false,
  followId,
  actionState: 'pending',
  createdAt: new Date('2026-09-06T12:00:00.000Z'),
});

test('maps the actor onto both names the UI reads', () => {
  const out = notificationPayload(row()) as Record<string, { id: string; username: string }>;
  assert.equal(out.from.id, String(actorId));
  assert.equal(out.from.username, 'ada');
  assert.equal(out.actor.id, String(actorId));
});

test('exposes the edge as followRequestId, which is what Accept acts on', () => {
  const out = notificationPayload(row());
  assert.equal(out.followRequestId, String(followId));
  // The raw field name must not leak: the client never reads it.
  assert.equal(out.followId, undefined);
  assert.equal(out.fromUserId, undefined);
});

test('carries the id and the action state a request card needs', () => {
  const out = notificationPayload(row());
  assert.equal(out.id, String(notificationId));
  assert.equal(out.actionState, 'pending');
  assert.equal(out.read, false);
  assert.equal(out.state, 'unread');
});

test('defaults the viewer relationship to no follow on a socket push', () => {
  const out = notificationPayload(row());
  assert.equal(out.viewerFollowsActor, false);
  assert.equal(out.viewerRequestedActor, false);
});

test('reports the viewer relationship when the list endpoint resolves it', () => {
  const accepted = notificationPayload(row(), { viewerFollows: 'accepted' });
  assert.equal(accepted.viewerFollowsActor, true);
  assert.equal(accepted.viewerRequestedActor, false);

  const pending = notificationPayload(row(), { viewerFollows: 'pending' });
  assert.equal(pending.viewerFollowsActor, false);
  assert.equal(pending.viewerRequestedActor, true);
});

test('a system notification serialises with no actor rather than throwing', () => {
  const out = notificationPayload({
    _id: notificationId,
    type: 'ai_picks',
    fromUserId: null,
    read: true,
    createdAt: new Date(),
  });
  assert.equal(out.from, null);
  assert.equal(out.actor, null);
  assert.equal(out.state, 'read');
});

test('an unpopulated actor degrades to null instead of leaking an id string', () => {
  // A missing avatar is a better outcome than a 500 on the notifications list.
  const out = notificationPayload({ ...row(), fromUserId: actorId });
  assert.equal(out.from, null);
});
