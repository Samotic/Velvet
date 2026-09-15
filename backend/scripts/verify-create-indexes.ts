/**
 * Proves `scripts/create-indexes.ts` builds every index the code assumes — and
 * nothing it must not touch — against a throwaway in-memory MongoDB.
 *
 *   - every model exported under `src/models` is in the script's list;
 *   - a dry run against an empty database writes nothing, not even a collection;
 *   - `--apply` creates every declared index with its exact options, checked for
 *     all sixteen models and by name for the ones a mistake would hurt most;
 *   - the uniqueness rules are enforced, not merely listed;
 *   - a second `--apply` changes nothing;
 *   - against a pre-pair-key database it skips the conflicted models, drops
 *     nothing, and still builds everything else.
 *
 *   cd backend && npm run verify:indexes
 */
import './testEnv';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { createIndexes, expectedIndexes, MODELS, type LiveIndex } from './create-indexes';

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

const section = (title: string) => console.log(`\n${title}`);
const json = (value: unknown) => JSON.stringify(value ?? null);

async function run() {
  const mongo = await MongoMemoryServer.create();
  const base = mongo.getUri().replace(/\/$/, '');
  const uriFor = (database: string) => `${base}/${database}`;

  const client = new mongoose.mongo.MongoClient(base);
  await client.connect();

  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  const indexesOf = async (database: string, collection: string): Promise<LiveIndex[]> => {
    const db = client.db(database);
    if (!(await db.listCollections({ name: collection }).toArray()).length) return [];
    return (await db.collection(collection).indexes()) as LiveIndex[];
  };
  const named = (list: LiveIndex[], name: string) => list.find((i) => i.name === name);
  const snapshot = async (database: string) =>
    json(
      await Promise.all(
        MODELS.map(async (m) => [
          m.collection.collectionName,
          (await indexesOf(database, m.collection.collectionName))
            .map((i) => ({
              name: i.name,
              key: i.key,
              unique: i.unique,
              sparse: i.sparse,
              partialFilterExpression: i.partialFilterExpression,
              expireAfterSeconds: i.expireAfterSeconds,
            }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name))),
        ]),
      ),
    );
  const succeeds = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  const duplicateKey = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return false;
    } catch (err) {
      return (err as { code?: number }).code === 11000;
    }
  };

  const declared = MODELS.flatMap((m) => expectedIndexes(m));

  /* ------------------------------------------------------------------------ */
  section('COVERAGE — every model is in the script');
  {
    // Read, not required: requiring a model file a second time under another
    // path spelling would compile the model twice and throw.
    const dir = join(__dirname, '../src/models');
    const exported = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .flatMap((f) =>
        [...readFileSync(join(dir, f), 'utf8').matchAll(/export const (\w+)\s*(?::\s*\w+)?\s*=\s*model\s*</g)].map(
          (m) => m[1],
        ),
      )
      .sort();
    const listed = MODELS.map((m) => m.modelName).sort();
    const registered = mongoose.modelNames().sort();

    check('src/models exports 16 models', exported.length === 16, exported.join(', '));
    check(
      'the script lists every exported model',
      json(exported) === json(listed),
      `not in the script: ${exported.filter((n) => !listed.includes(n)).join(', ') || 'none'}`,
    );
    check('and nothing else is registered with Mongoose', json(registered) === json(listed), registered.join(', '));
    check('the models declare their indexes', declared.length >= 40, `${declared.length} declared`);
  }

  /* ------------------------------------------------------------------------ */
  section('DRY RUN — an empty database stays empty');
  {
    const dry = await createIndexes({ uri: uriFor('fresh'), apply: false, log });
    check('exits 0', dry.exitCode === 0, String(dry.exitCode));
    check(
      'reports every declared index as missing',
      dry.missingBefore === declared.length,
      `${dry.missingBefore} of ${declared.length}`,
    );
    check('reports no conflict', dry.skippedModels.length === 0, dry.skippedModels.join(', '));
    const collections = await client.db('fresh').listCollections().toArray();
    check('creates no collection', collections.length === 0, collections.map((c) => c.name).join(', '));
  }

  /* ------------------------------------------------------------------------ */
  section('APPLY — every index the code assumes');
  {
    const applied = await createIndexes({ uri: uriFor('fresh'), apply: true, log });
    check('exits 0', applied.exitCode === 0, applied.failures.map((f) => `${f.model}: ${f.error}`).join('; '));
    check('creates every missing index', applied.created === declared.length, `${applied.created} of ${declared.length}`);
    check('prints the resulting index list', lines.some((l) => l.includes('indexes now:')));

    const mismatches: string[] = [];
    for (const e of declared) {
      const live = await indexesOf('fresh', e.collection);
      const m = live.find((l) => json(l.key) === json(e.key));
      if (!m) {
        mismatches.push(`${e.collection}.${e.name} missing`);
        continue;
      }
      if (
        m.name !== e.name ||
        (m.unique === true) !== e.unique ||
        (m.sparse === true) !== e.sparse ||
        json(m.partialFilterExpression) !== json(e.partialFilterExpression) ||
        (m.expireAfterSeconds ?? null) !== e.expireAfterSeconds
      ) {
        mismatches.push(`${e.collection}.${e.name} differs`);
      }
    }
    check(`all ${declared.length} declared indexes exist with the schema's exact options`, mismatches.length === 0, mismatches.join('; '));

    const conversations = await indexesOf('fresh', 'conversations');
    check('conversations.pairKey_1 exists and is unique', named(conversations, 'pairKey_1')?.unique === true);
    const members = named(conversations, 'participants_1');
    check('conversations.participants_1 exists and is NOT unique', Boolean(members) && members?.unique !== true);

    const dedupe = named(await indexesOf('fresh', 'notifications'), 'userId_1_type_1_followId_1');
    check('notifications dedupe index is unique', dedupe?.unique === true);
    check(
      '…partial on followId being an ObjectId',
      json(dedupe?.partialFilterExpression) === json({ followId: { $type: 'objectId' } }),
      json(dedupe?.partialFilterExpression),
    );
    check('…and not sparse', dedupe?.sparse !== true);

    const clears = await indexesOf('fresh', 'clearrequests');
    const pending = named(clears, 'one_pending_per_conversation');
    check(
      'clearrequests.one_pending_per_conversation is unique on conversationId',
      pending?.unique === true && json(pending?.key) === json({ conversationId: 1 }),
    );
    check(
      '…partial on status $eq pending',
      json(pending?.partialFilterExpression) === json({ status: { $eq: 'pending' } }),
      json(pending?.partialFilterExpression),
    );
    check(
      'clearrequests lookup index { conversationId, status, resolvedAt: -1 } exists',
      clears.some((i) => json(i.key) === json({ conversationId: 1, status: 1, resolvedAt: -1 })),
    );

    const users = await indexesOf('fresh', 'users');
    check('users.email_1 and users.username_1 are unique', named(users, 'email_1')?.unique === true && named(users, 'username_1')?.unique === true);
    check('users.googleId_1 is unique and sparse', named(users, 'googleId_1')?.unique === true && named(users, 'googleId_1')?.sparse === true);

    const requests = named(await indexesOf('fresh', 'followrequests'), 'from_1_to_1');
    check(
      'followrequests.from_1_to_1 is unique among pending requests',
      requests?.unique === true && json(requests?.partialFilterExpression) === json({ status: 'pending' }),
    );
    check(
      'ratelimits and feedcaches expire on expiresAt',
      named(await indexesOf('fresh', 'ratelimits'), 'expiresAt_1')?.expireAfterSeconds === 0 &&
        named(await indexesOf('fresh', 'feedcaches'), 'expiresAt_1')?.expireAfterSeconds === 0,
    );
  }

  /* ------------------------------------------------------------------------ */
  section('BEHAVIOUR — the rules are enforced, not just listed');
  {
    const db = client.db('fresh');
    const id = () => new mongoose.Types.ObjectId();
    const pair = (x: mongoose.Types.ObjectId, y: mongoose.Types.ObjectId) => [String(x), String(y)].sort().join(':');

    const [a, b, c] = [id(), id(), id()];
    await db.collection('conversations').insertOne({ participants: [a, b], pairKey: pair(a, b) });
    check(
      'a second thread for the same pair → E11000',
      await duplicateKey(() => db.collection('conversations').insertOne({ participants: [a, b], pairKey: pair(a, b) })),
    );
    check(
      'the same person in a thread with someone else is allowed',
      await succeeds(() => db.collection('conversations').insertOne({ participants: [a, c], pairKey: pair(a, c) })),
    );

    const user = id();
    const followId = id();
    check(
      'two message notifications for one user are allowed',
      await succeeds(async () => {
        await db.collection('notifications').insertOne({ userId: user, type: 'message', followId: null });
        await db.collection('notifications').insertOne({ userId: user, type: 'message', followId: null });
      }),
    );
    await db.collection('notifications').insertOne({ userId: user, type: 'follow_request', followId });
    check(
      'a second card for the same follow edge → E11000',
      await duplicateKey(() => db.collection('notifications').insertOne({ userId: user, type: 'follow_request', followId })),
    );

    const conversationId = id();
    await db.collection('clearrequests').insertOne({ conversationId, status: 'pending' });
    check(
      'a second pending clear request for one thread → E11000',
      await duplicateKey(() => db.collection('clearrequests').insertOne({ conversationId, status: 'pending' })),
    );
    check(
      'a resolved request beside the pending one is allowed',
      await succeeds(() => db.collection('clearrequests').insertOne({ conversationId, status: 'accepted' })),
    );
  }

  /* ------------------------------------------------------------------------ */
  section('RE-RUN — safe, and changes nothing');
  {
    const before = await snapshot('fresh');
    const again = await createIndexes({ uri: uriFor('fresh'), apply: true, log });
    check('a second --apply exits 0', again.exitCode === 0, again.failures.map((f) => f.error).join('; '));
    check('…finds nothing missing and creates nothing', again.missingBefore === 0 && again.created === 0);
    check('…and leaves the index list identical', before === (await snapshot('fresh')));
    const dry = await createIndexes({ uri: uriFor('fresh'), apply: false, log });
    check('a dry run afterwards exits 0 with nothing missing', dry.exitCode === 0 && dry.missingBefore === 0);
  }

  /* ------------------------------------------------------------------------ */
  section('CONFLICT — a pre-pair-key database is reported, never rewritten');
  {
    const old = client.db('prepairkey');
    await old.collection('conversations').createIndex({ participants: 1 }, { unique: true, name: 'participants_1' });
    await old
      .collection('notifications')
      .createIndex({ userId: 1, type: 1, followId: 1 }, { unique: true, sparse: true, name: 'userId_1_type_1_followId_1' });

    lines.length = 0;
    const dry = await createIndexes({ uri: uriFor('prepairkey'), apply: false, log });
    check('a dry run exits 1', dry.exitCode === 1, String(dry.exitCode));
    check(
      '…naming Conversation and Notification',
      json([...dry.skippedModels].sort()) === json(['Conversation', 'Notification']),
      dry.skippedModels.join(', '),
    );
    check('…and saying what differs', lines.some((l) => l.includes('conflict:') && l.includes('unique')));

    const applied = await createIndexes({ uri: uriFor('prepairkey'), apply: true, log });
    check('--apply exits 1', applied.exitCode === 1, String(applied.exitCode));
    const conversations = await indexesOf('prepairkey', 'conversations');
    check('participants_1 is still unique — nothing was dropped', named(conversations, 'participants_1')?.unique === true);
    check('pairKey_1 was not created — that is the migration\'s job', !named(conversations, 'pairKey_1'));
    check(
      'the old sparse notification index is untouched',
      named(await indexesOf('prepairkey', 'notifications'), 'userId_1_type_1_followId_1')?.sparse === true,
    );
    check(
      'every other model was still built',
      named(await indexesOf('prepairkey', 'users'), 'email_1')?.unique === true &&
        Boolean(named(await indexesOf('prepairkey', 'clearrequests'), 'one_pending_per_conversation')),
    );
    check('nothing failed besides the two skipped models', applied.failures.length === 0, applied.failures.map((f) => f.error).join('; '));
  }

  await client.close();
  await mongo.stop();

  if (failed) {
    console.log('\nlast script output:');
    for (const l of lines.slice(-40)) console.log(`  | ${l}`);
  }
  console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nverify-create-indexes crashed:', err);
  process.exit(1);
});
