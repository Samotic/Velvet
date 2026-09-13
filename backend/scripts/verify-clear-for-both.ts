/**
 * Real HTTP and socket coverage for clearing a conversation for both people.
 *
 *   cd backend && npm run verify:clearboth
 *
 * The feature is a consent gate in front of writes that already exist, so this
 * tests the gate as hard as the writes:
 *
 *   - asking changes nothing, and neither does declining — which is also silent;
 *   - the partial unique index allows one pending request per thread, and a new
 *     request once the previous one is resolved;
 *   - accepting empties both threads — the other person's messages and one
 *     older than the 48h window included — and wipes their content;
 *   - both sidebars say "Chat cleared", both unread counts are zero, and the
 *     other window hears it live over a real socket;
 *   - media goes for destruction, and with no Cloudinary here every asset has
 *     to come back **recorded** — in a temp file, never the real one;
 *   - a message sent while a request waits survives its acceptance;
 *   - a new message after a clear arrives normally;
 *   - asking is capped per person, per thread: ask-and-withdraw in a loop is
 *     refused at the fourth ask in the hour, without touching the other
 *     person's allowance or another thread;
 *   - an acceptance that fails partway — before the wipe or after it — leaves
 *     the request pending with its claim released, a retry finishes it, and
 *     media is neither lost nor listed twice;
 *   - a request an acceptance is holding cannot be withdrawn, declined or
 *     accepted again, and a claim that has lapsed holds nothing;
 *   - the migration's dry run writes nothing and `--apply` builds the index.
 *
 * Against a listening server on `mongodb-memory-server`, with Socket.io
 * attached, for the same reason as `verify-clear-history.ts`: the fixtures
 * include media and a backdated message, which cannot be made over the API.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { io, type Socket } from 'socket.io-client';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { initSocket } from '../src/lib/socket';
import { ACCEPT_LEASE_MS, ClearRequest } from '../src/models/ClearRequest';
import { PENDING_INDEX_FILTER, PENDING_INDEX_NAME } from '../src/models/clearRequestIndex';
import { Conversation } from '../src/models/Conversation';
import { Follow } from '../src/models/Follow';
import { Message } from '../src/models/Message';
import { Notification } from '../src/models/Notification';
import { User } from '../src/models/User';

/**
 * Stranded media is written to a temp directory. `backend/orphaned-media.json`
 * holds real ids from a production dry run, and a fixture writing there would
 * replace them with fake ones — which `verify-cleanup-orphans.ts` once did.
 * Its fingerprint is compared before and after.
 */
const MEDIA_DIR = mkdtempSync(join(tmpdir(), 'velvet-clearboth-'));
const MEDIA_FILE = join(MEDIA_DIR, 'orphaned-media.json');
process.env.ORPHANED_MEDIA_FILE = MEDIA_FILE;
const REAL_MEDIA_FILE = resolve('orphaned-media.json');

const fingerprint = (p: string): string =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'absent';

const run$ = promisify(execFile);
const HOUR = 60 * 60 * 1000;
let BASE = '';

let pass = 0;
let fail = 0;

type Account = { id: string; token: string; username: string };
type Heard = { event: string; payload: any };

function expect(name: string, got: unknown, want: unknown, extra = ''): void {
  if (got === want) {
    pass++;
    console.log(`  ✓ ${name} → ${JSON.stringify(want)}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} → expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}  ${extra}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls a condition, for work that lands after a response or over a socket. */
async function until(check: () => Promise<boolean> | boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(25);
  }
  return check();
}

const auth = (who: Account) => ({ Authorization: `Bearer ${who.token}` });

/** One request, printed without the token. */
async function call(
  label: string,
  method: string,
  path: string,
  who: Account,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...auth(who), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n─── ${label}`);
  console.log(`$ ${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}   (as ${who.username})`);
  console.log(`${res.status} ${text.length > 240 ? `${text.slice(0, 240)}…` : text}`);
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON body; status is still reported */
  }
  return { status: res.status, data: parsed?.data ?? null };
}

async function thread(who: Account, otherId: string): Promise<{
  messages: { id: string; text: string }[];
  clearRequest: { id: string; requestedByMe: boolean } | null;
  clearedAt: string | null;
}> {
  const res = await fetch(`${BASE}/api/messages/${otherId}`, { headers: auth(who) });
  return ((await res.json()) as { data: any }).data;
}

async function row(
  who: Account,
  otherId: string,
): Promise<{ lastMessage: string; lastMessageAt: string | null; lastFromMe: boolean; unread: number } | null> {
  const res = await fetch(`${BASE}/api/messages/conversations`, { headers: auth(who) });
  const list = ((await res.json()) as { data: { conversations: any[] } }).data.conversations;
  const hit = list.find((c) => c.user.id === otherId);
  return hit
    ? { lastMessage: hit.lastMessage, lastMessageAt: hit.lastMessageAt, lastFromMe: hit.lastFromMe, unread: hit.unread }
    : null;
}

/** The navbar badge. */
async function badge(who: Account): Promise<number> {
  const res = await fetch(`${BASE}/api/messages/unread-count`, { headers: auth(who) });
  return ((await res.json()) as { data: { unread: number } }).data.unread;
}

/** A real Socket.io client — a second window, as far as the server can tell. */
async function listen(who: Account): Promise<{ socket: Socket; heard: Heard[] }> {
  const socket = io(BASE, { auth: { token: who.token }, transports: ['websocket'], reconnection: false });
  const heard: Heard[] = [];
  socket.onAny((event: string, payload: unknown) => heard.push({ event, payload }));
  await new Promise<void>((ok, bad) => {
    socket.once('connect', () => ok());
    socket.once('connect_error', bad);
  });
  return { socket, heard };
}

const heardOf = (log: Heard[], event: string, match: (p: any) => boolean = () => true) =>
  log.some((h) => h.event === event && match(h.payload));

async function run(): Promise<void> {
  const realBefore = fingerprint(REAL_MEDIA_FILE);
  const mongo = await MongoMemoryServer.create();
  let server: Server | null = null;
  const sockets: Socket[] = [];

  try {
    await connectDb(mongo.getUri());
    await Promise.all([
      User.init(),
      Follow.init(),
      Message.init(),
      Conversation.init(),
      ClearRequest.init(),
      Notification.init(),
    ]);

    const app = createApp();
    server = await new Promise<Server>((ok) => {
      const s = app.listen(0, () => ok(s));
    });
    initSocket(server);
    const addr = server.address();
    BASE = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
    console.log(`server listening on ${BASE}, Socket.io attached`);
    console.log(`stranded media → ${MEDIA_FILE}\n`);

    /* --- fixtures ------------------------------------------------------- */

    const register = async (username: string): Promise<Account> => {
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `${username}@velvet.test`,
          username,
          displayName: `${username[0].toUpperCase()}${username.slice(1)}`,
          password: 'password123',
        }),
      });
      const data = ((await res.json()) as { data: { user: { id: string }; token: string } }).data;
      return { id: data.user.id, token: data.token, username };
    };

    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');
    await User.updateMany({}, { $set: { emailVerified: true } });
    await Follow.create([
      { followerId: alice.id, followingId: bob.id, status: 'accepted' },
      { followerId: bob.id, followingId: alice.id, status: 'accepted' },
    ]);

    const A = await listen(alice);
    const B = await listen(bob);
    sockets.push(A.socket, B.socket);

    const send = async (from: Account, to: Account, text: string): Promise<string> => {
      const r = await call(`${from.username} sends "${text}"`, 'POST', `/api/messages/${to.id}/send`, from, { text });
      return String(r.data?.message?.id);
    };

    const a1 = await send(alice, bob, 'alice one');
    const b1 = await send(bob, alice, 'bob one');
    const a2 = await send(alice, bob, 'alice two');

    const convo = await Conversation.findOne({ participants: new Types.ObjectId(alice.id) });
    const convoId = convo!._id;

    const direct = async (from: Account, to: Account, over: Record<string, unknown>) =>
      String(
        (
          await Message.create({
            conversationId: convoId,
            senderId: from.id,
            receiverId: to.id,
            read: false,
            ...over,
          })
        )._id,
      );

    const aImg = await direct(alice, bob, {
      kind: 'image',
      text: '',
      mediaUrl: 'https://res.cloudinary.com/demo/image/upload/v1712345678/velvet/messages/images/both-img.jpg',
      mediaPublicId: 'velvet/messages/images/both-img',
      mediaResourceType: 'image',
    });
    const bVoice = await direct(bob, alice, {
      kind: 'audio',
      text: '',
      mediaUrl: 'https://res.cloudinary.com/demo/video/upload/v1712345678/velvet/messages/audio/both-voice.webm',
      mediaPublicId: 'velvet/messages/audio/both-voice',
      mediaResourceType: 'video',
      mediaDuration: 4,
    });
    const bOld = await direct(bob, alice, { kind: 'text', text: 'bob, three days ago' });

    // Native driver: Mongoose treats a timestamps-managed createdAt as
    // immutable and would drop this `$set` without a word.
    await mongoose.connection
      .db!.collection('messages')
      .updateOne({ _id: new Types.ObjectId(bOld) }, { $set: { createdAt: new Date(Date.now() - 72 * HOUR) } });

    // The direct creations bypassed the counters the send path keeps; set them
    // to what is really unread — three each way.
    await Conversation.updateOne(
      { _id: convoId },
      { $set: { [`unread.${bob.id}`]: 3, [`unread.${alice.id}`]: 3 } },
    );

    const all = [a1, b1, a2, aImg, bVoice, bOld];
    console.log('\nfixtures:');
    console.log(`  alice=${alice.id} bob=${bob.id} carol=${carol.id} conversation=${String(convoId)}`);
    console.log(`  alice sent: ${a1} ${a2} ${aImg} (photo)`);
    console.log(`  bob sent:   ${b1} ${bVoice} (voice) ${bOld} (72h old)`);

    // Message cards are raised after each send's response.
    const cardFrom = (userId: string, fromId: string) =>
      Notification.findOne({ userId, type: 'message', fromUserId: fromId }).lean();
    expect(
      "fixture: bob's message card from alice points at her newest",
      await until(async () => String((await cardFrom(bob.id, alice.id))?.messageId) === a2),
      true,
    );
    expect(
      "fixture: alice's message card from bob points at his",
      await until(async () => String((await cardFrom(alice.id, bob.id))?.messageId) === b1),
      true,
    );

    /* --- 1. the index ---------------------------------------------------- */

    console.log('\n═══ 1. the pending-request index');
    const idx = (await ClearRequest.collection.indexes()).find((i) => i.name === PENDING_INDEX_NAME);
    console.log(`  ${JSON.stringify(idx)}`);
    expect('unique', idx?.unique, true);
    expect(
      'partial, filtered to status: pending',
      JSON.stringify(idx?.partialFilterExpression),
      JSON.stringify(PENDING_INDEX_FILTER),
    );

    /* --- 2. bad input ---------------------------------------------------- */

    console.log('\n═══ 2. bad input');
    let r = await call('Ask to clear a chat with yourself', 'POST', `/api/messages/${alice.id}/clear-request`, alice);
    expect('refused', r.status, 404);
    r = await call('Ask to clear a chat never started', 'POST', `/api/messages/${carol.id}/clear-request`, alice);
    expect('no conversation, nothing to ask', r.status, 404);
    r = await call('Accept without saying which request', 'POST', `/api/messages/${alice.id}/clear-request/accept`, bob, {});
    expect('requestId is required', r.status, 400);

    /* --- 3. asking changes nothing ----------------------------------------- */

    console.log('\n═══ 3. a request, before anyone answers it');

    const snapshot = async () => ({
      aliceSees: (await thread(alice, bob.id)).messages.length,
      bobSees: (await thread(bob, alice.id)).messages.length,
      rows: JSON.stringify([await row(alice, bob.id), await row(bob, alice.id)]),
      badges: `${await badge(alice)}/${await badge(bob)}`,
      docs: (await Message.find({ conversationId: convoId }).sort({ createdAt: 1 }).lean())
        .map((m) => `${m.text}|${m.mediaPublicId}|${m.deletedForEveryone}|${m.deletedFor.length}`)
        .join(' ; '),
      cards: await Notification.countDocuments({ type: 'message' }),
    });

    const before = await snapshot();
    console.log(`  before: alice sees ${before.aliceSees}, bob sees ${before.bobSees}, badges ${before.badges}`);
    expect('fixture: alice sees six', before.aliceSees, 6);
    expect('fixture: bob sees six', before.bobSees, 6);
    expect('fixture: three unread each way', before.badges, '3/3');

    A.heard.length = 0;
    B.heard.length = 0;
    r = await call('Alice asks to clear the chat for both of them', 'POST', `/api/messages/${bob.id}/clear-request`, alice);
    expect('request created', r.status, 201);
    const req1 = String(r.data?.request?.id);

    expect(
      "bob's open thread hears clear:changed live",
      await until(() => heardOf(B.heard, 'clear:changed', (p) => p.withUserId === alice.id)),
      true,
    );
    expect(
      "bob's bell gets a clear_request card live",
      await until(() => heardOf(B.heard, 'notification:new', (p) => p.type === 'clear_request')),
      true,
    );
    expect(
      'exactly one card',
      await Notification.countDocuments({ userId: bob.id, type: 'clear_request', fromUserId: alice.id }),
      1,
    );

    const bobAsked = await thread(bob, alice.id);
    const aliceAsked = await thread(alice, bob.id);
    expect("bob's thread carries the request as someone else's", bobAsked.clearRequest?.requestedByMe, false);
    expect("alice's thread carries it as hers", aliceAsked.clearRequest?.requestedByMe, true);
    expect('same request both sides', bobAsked.clearRequest?.id, req1);

    const asked = await snapshot();
    expect('alice still sees six', asked.aliceSees, 6);
    expect('bob still sees six', asked.bobSees, 6);
    expect('no message document changed', asked.docs, before.docs);
    expect('both sidebars unchanged', asked.rows, before.rows);
    expect('both badges unchanged', asked.badges, before.badges);
    expect('no message card touched', asked.cards, before.cards);

    r = await call('Alice asks again', 'POST', `/api/messages/${bob.id}/clear-request`, alice);
    expect('one pending request per thread', r.status, 409);
    r = await call('Bob asks while hers is pending', 'POST', `/api/messages/${alice.id}/clear-request`, bob);
    expect('from either side', r.status, 409);
    r = await call('Alice tries to accept her own request', 'POST', `/api/messages/${bob.id}/clear-request/accept`, alice, { requestId: req1 });
    expect('only the person asked may accept', r.status, 404);
    r = await call('Carol tries to accept it', 'POST', `/api/messages/${alice.id}/clear-request/accept`, carol, { requestId: req1 });
    expect('a stranger cannot', r.status, 404);

    // The race the index exists for: a second pending document for the same
    // thread, straight past the controller's findOne.
    let raced = 'inserted';
    try {
      await ClearRequest.create({
        conversationId: convoId,
        requesterId: bob.id,
        recipientId: alice.id,
        cutoff: new Date(),
        status: 'pending',
      });
    } catch (err) {
      raced = (err as { code?: number }).code === 11000 ? 'E11000' : String(err);
    }
    expect('the index itself rejects a second pending request', raced, 'E11000');
    expect('no media recorded while pending', existsSync(MEDIA_FILE), false);

    /* --- 4. declining changes nothing, and is silent --------------------- */

    console.log('\n═══ 4. decline');
    A.heard.length = 0;
    B.heard.length = 0;
    r = await call('Bob keeps the chat', 'POST', `/api/messages/${alice.id}/clear-request/decline`, bob, { requestId: req1 });
    expect('declined', r.status, 200);
    expect("bob's own tabs hear it", await until(() => heardOf(B.heard, 'clear:changed')), true);
    await sleep(400);
    expect('alice is sent nothing at all', A.heard.length, 0, JSON.stringify(A.heard));
    expect("the card leaves bob's bell", await Notification.countDocuments({ userId: bob.id, type: 'clear_request' }), 0);
    expect('stored as declined, not deleted', (await ClearRequest.findById(req1).lean())?.status, 'declined');

    const declined = await snapshot();
    expect('alice still sees six', declined.aliceSees, 6);
    expect('bob still sees six', declined.bobSees, 6);
    expect('no message document changed', declined.docs, before.docs);
    expect('both sidebars unchanged', declined.rows, before.rows);
    expect('both badges unchanged', declined.badges, before.badges);

    r = await call('Bob accepts what he declined', 'POST', `/api/messages/${alice.id}/clear-request/accept`, bob, { requestId: req1 });
    expect('an answered request stays answered', r.status, 409);
    r = await call('Alice withdraws a request that was silently declined', 'DELETE', `/api/messages/${bob.id}/clear-request`, alice);
    expect('answers as if there were none — the decline does not leak', r.data?.status, 'none');

    /* --- 5. ask again, then withdraw --------------------------------------- */

    console.log('\n═══ 5. a second request, withdrawn');
    r = await call('Alice asks again after the decline', 'POST', `/api/messages/${bob.id}/clear-request`, alice);
    expect('a resolved request does not block a new one', r.status, 201);
    const req2 = String(r.data?.request?.id);
    expect('both kept on record', await ClearRequest.countDocuments({ conversationId: convoId }), 2);

    B.heard.length = 0;
    r = await call('Alice withdraws it', 'DELETE', `/api/messages/${bob.id}/clear-request`, alice);
    expect('cancelled', r.data?.status, 'cancelled');
    expect(
      "bob's banner is told to go",
      await until(() => heardOf(B.heard, 'clear:changed', (p) => p.withUserId === alice.id)),
      true,
    );
    expect('and his card with it', await Notification.countDocuments({ userId: bob.id, type: 'clear_request' }), 0);
    r = await call('Bob accepts the withdrawn request', 'POST', `/api/messages/${alice.id}/clear-request/accept`, bob, { requestId: req2 });
    expect('a withdrawn request is never carried out', r.status, 409);
    expect('nothing changed', (await snapshot()).docs, before.docs);

    /* --- 6. accepted ------------------------------------------------------- */

    console.log('\n═══ 6. accepted');
    r = await call('Alice asks a third time', 'POST', `/api/messages/${bob.id}/clear-request`, alice);
    const req3 = String(r.data?.request?.id);
    expect('request created', r.status, 201);

    A.heard.length = 0;
    B.heard.length = 0;
    r = await call('Bob agrees', 'POST', `/api/messages/${alice.id}/clear-request/accept`, bob, { requestId: req3 });
    expect('accepted', r.status, 200);
    expect('all six messages covered', r.data?.cleared, 6);

    expect(
      "alice's window hears message:cleared live",
      await until(() => heardOf(A.heard, 'message:cleared', (p) => p.withUserId === bob.id && p.requestId === req3)),
      true,
    );
    expect(
      "bob's own tabs hear it too",
      await until(() => heardOf(B.heard, 'message:cleared', (p) => p.withUserId === alice.id)),
      true,
    );
    const pushed = A.heard.find((h) => h.event === 'message:cleared')?.payload;
    expect("the push carries alice's own, empty preview", pushed?.preview, '');
    expect('and scope me — not a third scope', pushed?.scope, 'me');

    const aCleared = await thread(alice, bob.id);
    const bCleared = await thread(bob, alice.id);
    expect("alice's thread is empty", aCleared.messages.length, 0);
    expect("bob's thread is empty", bCleared.messages.length, 0);
    expect('both carry the same cleared-at for the notice', !!aCleared.clearedAt && aCleared.clearedAt === bCleared.clearedAt, true);
    expect('and no pending request', aCleared.clearRequest, null);

    const docs = await Message.find({ _id: { $in: all.map((id) => new Types.ObjectId(id)) } }).lean();
    console.log('\n  after acceptance:');
    for (const d of docs) {
      console.log(
        `    ${String(d._id)} from=${String(d.senderId) === alice.id ? 'alice' : 'bob  '} ` +
          `hiddenFor=${d.deletedFor.length} tombstone=${d.deletedForEveryone} text=${JSON.stringify(d.text)} media=${JSON.stringify(d.mediaPublicId)}`,
      );
    }
    const hiddenFromBoth = docs.filter(
      (d) => d.deletedFor.map(String).includes(alice.id) && d.deletedFor.map(String).includes(bob.id),
    );
    expect('all six hidden from both', hiddenFromBoth.length, 6);
    expect(
      'all six wiped: no text, no media, no edit history',
      docs.filter(
        (d) =>
          d.deletedForEveryone &&
          d.text === '' &&
          d.mediaUrl === null &&
          d.mediaPublicId === null &&
          d.editHistory.length === 0,
      ).length,
      6,
    );
    expect(
      "bob's own three included — it is not only the requester's",
      docs.filter((d) => String(d.senderId) === bob.id && d.deletedForEveryone).length,
      3,
    );
    expect('the 72h-old message too — no window', docs.find((d) => String(d._id) === bOld)?.deletedForEveryone, true);
    expect('documents kept, not removed', await Message.countDocuments({ conversationId: convoId }), 6);

    const aRow = await row(alice, bob.id);
    const bRow = await row(bob, alice.id);
    console.log(`\n  alice row: ${JSON.stringify(aRow)}`);
    console.log(`  bob row:   ${JSON.stringify(bRow)}`);
    expect("alice's row reads Chat cleared", aRow?.lastMessage, 'Chat cleared');
    expect("bob's row reads Chat cleared", bRow?.lastMessage, 'Chat cleared');
    expect('neither row is "You: …"', aRow?.lastFromMe === false && bRow?.lastFromMe === false, true);
    expect('dated when it was cleared', aRow?.lastMessageAt, aCleared.clearedAt);
    expect("alice's unread is zero", aRow?.unread, 0);
    expect("bob's unread is zero", bRow?.unread, 0);
    expect("alice's navbar badge is zero", await badge(alice), 0);
    expect("bob's navbar badge is zero", await badge(bob), 0);

    expect("bob's message card from alice retracted", await Notification.countDocuments({ userId: bob.id, type: 'message' }), 0);
    expect("alice's message card from bob retracted", await Notification.countDocuments({ userId: alice.id, type: 'message' }), 0);
    expect('the request card is gone', await Notification.countDocuments({ type: 'clear_request' }), 0);
    for (const who of [alice, bob]) {
      const stored = (await User.findById(who.id).select('unreadNotificationCount').lean())?.unreadNotificationCount;
      const real = await Notification.countDocuments({ userId: who.id, read: false });
      expect(`${who.username}'s bell count matches the cards left`, stored, real);
    }

    const accepted = await ClearRequest.findById(req3).lean();
    expect('request stored as accepted', accepted?.status, 'accepted');
    expect('with what it covered', accepted?.clearedCount, 6);

    /**
     * Media is destroyed after the response. No Cloudinary is configured here,
     * so both assets must come back recorded as stranded — neither may simply
     * vanish into a console line.
     */
    const recordedMedia = (): { messageId: string; publicId: string; resourceType: string; reason: string }[] =>
      existsSync(MEDIA_FILE) ? JSON.parse(readFileSync(MEDIA_FILE, 'utf8')) : [];
    expect('both assets queued and recorded', await until(() => recordedMedia().length === 2, 5000), true);
    const recorded = recordedMedia();
    console.log(`\n  ${MEDIA_FILE}:\n${JSON.stringify(recorded, null, 2).replace(/^/gm, '    ')}`);
    expect('the photo, by message id', recorded.find((m) => m.messageId === aImg)?.publicId, 'velvet/messages/images/both-img');
    expect('the voice note, under video', recorded.find((m) => m.messageId === bVoice)?.resourceType, 'video');
    expect('each with its reason', recorded.every((m) => /not configured/.test(m.reason)), true);

    r = await call('Bob accepts the same request again', 'POST', `/api/messages/${alice.id}/clear-request/accept`, bob, { requestId: req3 });
    expect('a double tap does nothing', r.status, 409);
    r = await call('Alice asks to clear the emptied chat', 'POST', `/api/messages/${bob.id}/clear-request`, alice);
    expect('nothing left to clear', r.status, 422);
    expect('and no card raised for it', await Notification.countDocuments({ type: 'clear_request' }), 0);

    /* --- 7. the conversation carries on ------------------------------------ */

    console.log('\n═══ 7. a new message after the clear');
    B.heard.length = 0;
    const fresh = await send(alice, bob, 'fresh start');
    expect('bob receives it live', await until(() => heardOf(B.heard, 'message:new', (p) => p.id === fresh)), true);
    const bFresh = await thread(bob, alice.id);
    expect('it lands in his emptied thread', bFresh.messages.map((m) => m.id).join(), fresh);
    expect('the notice stays', bFresh.clearedAt, aCleared.clearedAt);
    const bRowFresh = await row(bob, alice.id);
    const aRowFresh = await row(alice, bob.id);
    expect("bob's row shows it", bRowFresh?.lastMessage, 'fresh start');
    expect('unread', bRowFresh?.unread, 1);
    expect("alice's row shows it as hers", aRowFresh?.lastFromMe, true);

    /* --- 8. what is sent while a request waits survives -------------------- */

    console.log('\n═══ 8. a message sent while the request waits');
    r = await call('Bob asks, this time', 'POST', `/api/messages/${alice.id}/clear-request`, bob);
    expect('request created', r.status, 201);
    const req4 = String(r.data?.request?.id);

    await sleep(5);
    const waiting = await send(alice, bob, 'sent while the request waits');
    expect(
      "bob's card from alice moves to the waiting-time message",
      await until(async () => String((await cardFrom(bob.id, alice.id))?.messageId) === waiting),
      true,
    );

    r = await call('Alice agrees', 'POST', `/api/messages/${bob.id}/clear-request/accept`, alice, { requestId: req4 });
    expect('accepted', r.status, 200);

    const req4Doc = await ClearRequest.findById(req4).lean();
    const waitingDoc = await Message.findById(waiting).lean();
    const freshDoc = await Message.findById(fresh).lean();
    expect('the cutoff was stamped when bob asked, before the message', req4Doc!.cutoff < waitingDoc!.createdAt, true);
    expect('and the answer came after it', waitingDoc!.createdAt < req4Doc!.resolvedAt!, true);
    expect('the message sent while waiting survives', waitingDoc?.text, 'sent while the request waits');
    expect('visible to both', waitingDoc?.deletedFor.length, 0);
    expect('the message before the cutoff does not', freshDoc?.deletedForEveryone, true);

    const aWait = await thread(alice, bob.id);
    const bWait = await thread(bob, alice.id);
    expect("alice's thread holds only the survivor", aWait.messages.map((m) => m.id).join(), waiting);
    expect("bob's thread holds only the survivor", bWait.messages.map((m) => m.id).join(), waiting);
    const bRowWait = await row(bob, alice.id);
    const aRowWait = await row(alice, bob.id);
    expect("bob's unread is recounted, not zeroed — the survivor is unread", bRowWait?.unread, 1);
    expect('his badge agrees', await badge(bob), 1);
    expect("bob's row previews the survivor", bRowWait?.lastMessage, 'sent while the request waits');
    expect("alice's row shows it as hers", aRowWait?.lastFromMe, true);
    expect(
      "bob's card survives: it announces a message that still stands",
      await Notification.countDocuments({ userId: bob.id, type: 'message', messageId: new Types.ObjectId(waiting) }),
      1,
    );
    expect(
      'the notice moves to the newer clear',
      new Date(bWait.clearedAt ?? 0).getTime() > new Date(aCleared.clearedAt ?? 0).getTime(),
      true,
    );

    /* --- 9. asking is capped, per person and per thread -------------------- */

    /**
     * Alice's own history above already shows what does not count: in one hour
     * on one thread she made three asks that succeeded plus a 409 and a 422,
     * and the third success was not refused. Here, the loop the cap exists for.
     */
    console.log('\n═══ 9. ask-and-withdraw in a loop');
    const dave = await register('dave');
    const erin = await register('erin');
    await User.updateMany({ _id: { $in: [dave.id, erin.id] } }, { $set: { emailVerified: true } });
    await Follow.create([
      { followerId: carol.id, followingId: dave.id, status: 'accepted' },
      { followerId: dave.id, followingId: carol.id, status: 'accepted' },
      { followerId: carol.id, followingId: erin.id, status: 'accepted' },
      { followerId: erin.id, followingId: carol.id, status: 'accepted' },
      { followerId: dave.id, followingId: erin.id, status: 'accepted' },
      { followerId: erin.id, followingId: dave.id, status: 'accepted' },
    ]);
    await send(carol, dave, 'carol to dave');
    await send(carol, erin, 'carol to erin');
    const D = await listen(dave);
    sockets.push(D.socket);

    for (let i = 1; i <= 3; i += 1) {
      r = await call(`Carol asks (${i} of 3 this hour)`, 'POST', `/api/messages/${dave.id}/clear-request`, carol);
      expect(`ask ${i} allowed`, r.status, 201);
      r = await call(`Carol withdraws it (${i})`, 'DELETE', `/api/messages/${dave.id}/clear-request`, carol);
      expect(`withdraw ${i}`, r.data?.status, 'cancelled');
    }
    r = await call('Carol asks a fourth time inside the hour', 'POST', `/api/messages/${dave.id}/clear-request`, carol);
    expect('refused', r.status, 429);
    expect('and no request made for it', await ClearRequest.countDocuments({ requesterId: carol.id, status: 'pending' }), 0);
    await sleep(400);
    expect(
      'dave was pinged three times, not four',
      D.heard.filter((h) => h.event === 'notification:new' && h.payload?.type === 'clear_request').length,
      3,
    );
    expect(
      'and has no card left to act on',
      await Notification.countDocuments({ userId: dave.id, type: 'clear_request' }),
      0,
    );

    r = await call('Dave asks in the same thread', 'POST', `/api/messages/${carol.id}/clear-request`, dave);
    expect("the cap is carol's — dave keeps his own", r.status, 201);
    r = await call('Dave withdraws it', 'DELETE', `/api/messages/${carol.id}/clear-request`, dave);
    expect('withdrawn', r.data?.status, 'cancelled');
    r = await call('Carol asks in her chat with erin', 'POST', `/api/messages/${erin.id}/clear-request`, carol);
    expect('the cap is per thread — another chat is unaffected', r.status, 201);
    r = await call('Carol withdraws that too', 'DELETE', `/api/messages/${erin.id}/clear-request`, carol);
    expect('withdrawn', r.data?.status, 'cancelled');

    /* --- 10. an acceptance that fails partway stays pending ------------------ */

    console.log('\n═══ 10. a failed acceptance is left pending, and a retry finishes it');
    await send(dave, erin, 'dave to erin');
    await send(erin, dave, 'erin to dave');
    const deConvo = await Conversation.findOne({
      participants: { $all: [new Types.ObjectId(dave.id), new Types.ObjectId(erin.id)] },
    });
    const deId = deConvo!._id;
    const image = async (from: Account, to: Account, name: string): Promise<string> =>
      String(
        (
          await Message.create({
            conversationId: deId,
            senderId: from.id,
            receiverId: to.id,
            read: false,
            kind: 'image',
            text: '',
            mediaUrl: `https://res.cloudinary.com/demo/image/upload/v1712345678/velvet/messages/images/${name}.jpg`,
            mediaPublicId: `velvet/messages/images/${name}`,
            mediaResourceType: 'image',
          })
        )._id,
      );
    const listedTimes = (publicId: string): number => recordedMedia().filter((m) => m.publicId === publicId).length;

    // Failure before the wipe: the unread recount throws, once.
    const erinImg = await image(erin, dave, 'retry-img');
    await sleep(5);
    r = await call('Dave asks erin', 'POST', `/api/messages/${erin.id}/clear-request`, dave);
    expect('request created', r.status, 201);
    const reqF = String(r.data?.request?.id);

    const realConversationUpdate = Conversation.updateOne;
    let recountFault = true;
    (Conversation as any).updateOne = function (...args: any[]) {
      const set = args[1]?.$set;
      if (recountFault && set && Object.keys(set).some((k) => k.startsWith('unread.'))) {
        recountFault = false;
        throw new Error('injected: the unread recount failed');
      }
      return (realConversationUpdate as any).apply(Conversation, args);
    };
    try {
      r = await call('Erin agrees, and a write before the wipe fails', 'POST', `/api/messages/${dave.id}/clear-request/accept`, erin, { requestId: reqF });
    } finally {
      (Conversation as any).updateOne = realConversationUpdate;
    }
    expect('the failure is reported', r.status, 500);
    expect('the injected fault was actually hit', recountFault, false);
    let reqFDoc = await ClearRequest.findById(reqF).lean();
    expect('the request is still pending, not accepted', reqFDoc?.status, 'pending');
    expect('its claim is released', reqFDoc?.acceptingSince ?? null, null);
    expect('nor stamped resolved', reqFDoc?.resolvedAt ?? null, null);
    expect('nothing was wiped', await Message.countDocuments({ conversationId: deId, deletedForEveryone: true }), 0);
    expect('the photo keeps its handle for the retry', (await Message.findById(erinImg).lean())?.mediaPublicId, 'velvet/messages/images/retry-img');
    await sleep(400);
    expect('and its asset was neither destroyed nor recorded', listedTimes('velvet/messages/images/retry-img'), 0);
    expect("erin's thread still offers the request", (await thread(erin, dave.id)).clearRequest?.id, reqF);

    r = await call('Erin tries again', 'POST', `/api/messages/${dave.id}/clear-request/accept`, erin, { requestId: reqF });
    expect('the retry succeeds', r.status, 200);
    reqFDoc = await ClearRequest.findById(reqF).lean();
    expect('now accepted', reqFDoc?.status, 'accepted');
    expect('covering all three', reqFDoc?.clearedCount, 3);
    expect('all three wiped', await Message.countDocuments({ conversationId: deId, deletedForEveryone: true }), 3);
    expect('the photo is dealt with, once', await until(() => listedTimes('velvet/messages/images/retry-img') === 1, 5000), true);

    // Failure after the wipe: marking the request accepted throws, once.
    await send(erin, dave, 'erin again');
    const daveImg = await image(dave, erin, 'after-wipe-img');
    await sleep(5);
    r = await call('Dave asks again', 'POST', `/api/messages/${erin.id}/clear-request`, dave);
    expect('request created', r.status, 201);
    const reqG = String(r.data?.request?.id);

    const realRequestUpdate = ClearRequest.findOneAndUpdate;
    let acceptFault = true;
    (ClearRequest as any).findOneAndUpdate = function (...args: any[]) {
      if (acceptFault && args[1]?.$set?.status === 'accepted') {
        acceptFault = false;
        throw new Error('injected: marking the request accepted failed');
      }
      return (realRequestUpdate as any).apply(ClearRequest, args);
    };
    try {
      r = await call('Erin agrees, and marking it accepted fails after the wipe', 'POST', `/api/messages/${dave.id}/clear-request/accept`, erin, { requestId: reqG });
    } finally {
      (ClearRequest as any).findOneAndUpdate = realRequestUpdate;
    }
    expect('the failure is reported', r.status, 500);
    expect('the injected fault was actually hit', acceptFault, false);
    let reqGDoc = await ClearRequest.findById(reqG).lean();
    expect('it never read accepted', reqGDoc?.status, 'pending');
    expect('its claim is released', reqGDoc?.acceptingSince ?? null, null);
    expect('the wipe itself had landed', (await Message.findById(daveImg).lean())?.deletedForEveryone, true);
    expect(
      'so the photo, whose handle a retry can no longer see, is dealt with now',
      await until(() => listedTimes('velvet/messages/images/after-wipe-img') === 1, 5000),
      true,
    );

    r = await call('Erin tries again', 'POST', `/api/messages/${dave.id}/clear-request/accept`, erin, { requestId: reqG });
    expect('the retry succeeds', r.status, 200);
    reqGDoc = await ClearRequest.findById(reqG).lean();
    expect('now accepted', reqGDoc?.status, 'accepted');
    await sleep(400);
    expect('the photo is still listed once, not twice', listedTimes('velvet/messages/images/after-wipe-img'), 1);

    // A claim holds the request against everything else.
    await send(dave, erin, 'one more');
    r = await call('Erin asks dave', 'POST', `/api/messages/${dave.id}/clear-request`, erin);
    expect('request created', r.status, 201);
    const reqH = String(r.data?.request?.id);
    await ClearRequest.updateOne({ _id: reqH }, { $set: { acceptingSince: new Date() } });

    r = await call('Erin withdraws while dave is accepting', 'DELETE', `/api/messages/${dave.id}/clear-request`, erin);
    expect('refused rather than answered none', r.status, 409);
    r = await call('Dave declines mid-acceptance', 'POST', `/api/messages/${erin.id}/clear-request/decline`, dave, { requestId: reqH });
    expect('a decline cannot cut in', r.status, 409);
    r = await call('Dave accepts a second time', 'POST', `/api/messages/${erin.id}/clear-request/accept`, dave, { requestId: reqH });
    expect('nor a second accept', r.status, 409);
    expect('still pending', (await ClearRequest.findById(reqH).lean())?.status, 'pending');

    await ClearRequest.updateOne({ _id: reqH }, { $set: { acceptingSince: new Date(Date.now() - ACCEPT_LEASE_MS - 1000) } });
    r = await call('Erin withdraws once that claim has lapsed', 'DELETE', `/api/messages/${dave.id}/clear-request`, erin);
    expect('a dead claim holds nothing', r.data?.status, 'cancelled');

    /* --- 11. the real list --------------------------------------------------- */

    console.log('\n═══ 11. the real orphaned-media.json');
    expect('byte-for-byte untouched', fingerprint(REAL_MEDIA_FILE), realBefore);

    /* --- 12. the migration --------------------------------------------------- */

    console.log('\n═══ 12. migrate-clear-request-index.ts');
    const migrationUri = mongo.getUri('migrationcheck');
    const migrate = async (apply: boolean): Promise<string> => {
      const { stdout } = await run$(
        process.execPath,
        [require.resolve('tsx/cli'), 'scripts/migrate-clear-request-index.ts', ...(apply ? ['--apply'] : [])],
        // Pointed explicitly at a scratch database on the in-memory server —
        // never left to fall back on whatever backend/.env names.
        { encoding: 'utf8', env: { ...process.env, MONGODB_URI: migrationUri } },
      );
      console.log(stdout.replace(/^/gm, '    '));
      return stdout;
    };
    const scratch = mongoose.connection.getClient().db('migrationcheck');

    let out = await migrate(false);
    expect('dry run says what it would create', out.includes(`would create "${PENDING_INDEX_NAME}"`), true);
    expect('and writes nothing', (await scratch.listCollections({ name: 'clearrequests' }).toArray()).length, 0);

    out = await migrate(true);
    const built = (await scratch.collection('clearrequests').indexes()).find((i) => i.name === PENDING_INDEX_NAME);
    expect('--apply builds it unique', built?.unique, true);
    expect(
      'with the partial filter exactly as the schema declares',
      JSON.stringify(built?.partialFilterExpression),
      JSON.stringify(PENDING_INDEX_FILTER),
    );

    out = await migrate(true);
    expect('a re-run is a no-op', out.includes('already migrated'), true);

    console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed`);
  } finally {
    for (const s of sockets) s.disconnect();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((done) => server!.close(() => done()));
    }
    await disconnectDb().catch(() => {});
    await mongo.stop().catch(() => {});
    rmSync(MEDIA_DIR, { recursive: true, force: true });
  }

  if (fail) process.exit(1);
}

run().catch(async (err) => {
  console.error('verify failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
