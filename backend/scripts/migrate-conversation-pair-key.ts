/**
 * Gives every conversation a `pairKey`, and moves thread uniqueness onto it.
 *
 *   cd backend && npx tsx scripts/migrate-conversation-pair-key.ts            # dry run
 *   cd backend && npx tsx scripts/migrate-conversation-pair-key.ts --apply    # writes
 *
 * **Dry run is the default, and `--apply` is required to write anything.**
 *
 * ── What it fixes ──
 * `participants_1` was declared `unique` on the belief that, with the array
 * stored sorted, it made each *pair* unique. An index on an array field has one
 * entry per element, and `unique` applies per element across documents — so no
 * user id could appear in two conversations. Everyone got one thread, ever. The
 * first message to a second person hit E11000, the controller's race retry
 * looked for a thread with that pair, found none, and the send answered 500.
 *
 * ── Run it BEFORE the new code serves traffic ──
 * Unlike the other migrations, this one is not safe to run after the deploy.
 * The new controller finds threads by `pairKey`, which no existing conversation
 * has until this runs. So new code against an unmigrated database breaks
 * threads that work today: an existing thread opens empty, and every send into
 * it 500s — the create collides on the old unique index, and the retry, looking
 * by key, finds nothing.
 *
 * Stop the app, run this with `--apply`, then start the new code. If old code
 * did serve traffic while it ran, run it again after the deploy: old code
 * writes conversations without a key, and this backfills them.
 *
 * ── Steps, each skipped when already true ──
 *   1. Preflight. Refuses before writing if a conversation does not have
 *      exactly two distinct participants, or two conversations share a pair —
 *      either would fail the unique build halfway through.
 *   2. Backfill `pairKey` wherever it is missing or wrong.
 *   3. Create `pairKey_1`, unique — dropping it first if it exists with other
 *      options.
 *   4. Drop `participants_1` if it is unique, and recreate it without `unique`.
 *      The inbox still queries it.
 *
 * 3 runs before 4 on purpose: the collection is never without a uniqueness
 * rule, which closes the drop-then-create window the notification migration
 * has to accept.
 *
 * ── Why a script, and why no model import ──
 * `autoIndex` is off in production, and MongoDB refuses to redefine an existing
 * index with different options, so a schema edit alone changes nothing. And
 * this file works on the raw collection: registering `Conversation` would have
 * Mongoose try to build the new schema's indexes against the unmigrated
 * collection the moment it connects.
 *
 * Idempotent. Safe to re-run, and safe against a partly migrated database.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { env } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/lib/db';
import { pairKeyFor } from '../src/models/conversationKey';

const APPLY = process.argv.includes('--apply');

const COLLECTION = 'conversations';
const PAIR_KEY = { name: 'pairKey_1', key: { pairKey: 1 } } as const;
const MEMBERS = { name: 'participants_1', key: { participants: 1 } } as const;

type IndexInfo = { name?: string; key?: Record<string, unknown>; unique?: boolean };
type Row = { _id: mongoose.Types.ObjectId; participants?: unknown[]; pairKey?: unknown };

const sameKeys = (a: Record<string, unknown> | undefined, b: Record<string, unknown>) =>
  JSON.stringify(a ?? null) === JSON.stringify(b);

const describe = (ix: IndexInfo | undefined) =>
  ix ? `${JSON.stringify(ix.key)}  unique: ${String(ix.unique === true)}` : 'not present';

async function readIndexes(col: mongoose.mongo.Collection): Promise<IndexInfo[]> {
  try {
    return (await col.indexes()) as IndexInfo[];
  } catch (err) {
    // A database that has never held a conversation has no collection to list.
    if ((err as { code?: number }).code === 26) return [];
    throw err;
  }
}

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  console.log(
    APPLY
      ? 'APPLY MODE — writing\n'
      : 'Dry run. Nothing will be written. Re-run with --apply to act.\n',
  );

  const col = mongoose.connection.db!.collection(COLLECTION);

  /* --- current state --------------------------------------------------- */

  const before = await readIndexes(col);
  const pairIx = before.find((i) => i.name === PAIR_KEY.name);
  const membersIx = before.find((i) => i.name === MEMBERS.name);

  console.log('indexes:');
  console.log(`  ${PAIR_KEY.name}: ${describe(pairIx)}`);
  console.log(`  ${MEMBERS.name}: ${describe(membersIx)}`);

  /* --- 1. preflight ---------------------------------------------------- */

  const malformed: string[] = [];
  const idsByKey = new Map<string, string[]>();
  const stale: { _id: mongoose.Types.ObjectId; pairKey: string }[] = [];
  let total = 0;

  for await (const row of col.find({}, { projection: { participants: 1, pairKey: 1 } })) {
    const r = row as Row;
    total += 1;

    const ids = (r.participants ?? []).map(String);
    if (ids.length !== 2 || ids[0].toLowerCase() === ids[1].toLowerCase()) {
      malformed.push(`${String(r._id)}  participants: ${JSON.stringify(ids)}`);
      continue;
    }

    const key = pairKeyFor(ids[0], ids[1]);
    idsByKey.set(key, [...(idsByKey.get(key) ?? []), String(r._id)]);
    if (r.pairKey !== key) stale.push({ _id: r._id, pairKey: key });
  }

  const collisions = [...idsByKey].filter(([, ids]) => ids.length > 1);

  console.log(`\nconversations: ${total}`);
  console.log(`  pairKey missing or wrong: ${stale.length}`);
  console.log(`  malformed (not two distinct participants): ${malformed.length}`);
  console.log(`  pairs held by more than one conversation: ${collisions.length}`);

  if (malformed.length || collisions.length) {
    for (const m of malformed) console.log(`    malformed  ${m}`);
    for (const [key, ids] of collisions) console.log(`    collision  ${key}  ${ids.join(', ')}`);
    throw new Error(
      'preflight failed — nothing written. A unique pairKey index cannot be built over these rows; resolve them and re-run.',
    );
  }

  /* --- plan ------------------------------------------------------------ */

  const pairOk = pairIx?.unique === true && sameKeys(pairIx.key, PAIR_KEY.key);
  const membersOk =
    membersIx !== undefined && membersIx.unique !== true && sameKeys(membersIx.key, MEMBERS.key);

  if (!stale.length && pairOk && membersOk) {
    console.log('\n✓ already migrated — nothing to do');
    await disconnectDb();
    return;
  }

  if (!APPLY) {
    console.log('\nwould:');
    if (stale.length) console.log(`  backfill pairKey on ${stale.length}`);
    if (!pairOk) {
      console.log(
        pairIx
          ? `  drop ${PAIR_KEY.name} and recreate it unique`
          : `  create ${PAIR_KEY.name} unique`,
      );
    }
    if (!membersOk) {
      console.log(
        membersIx
          ? `  drop ${MEMBERS.name} and recreate it without unique`
          : `  create ${MEMBERS.name} (not unique)`,
      );
    }
    console.log('\n✓ dry run complete');
    await disconnectDb();
    return;
  }

  /* --- 2. backfill ----------------------------------------------------- */

  if (stale.length) {
    const result = await col.bulkWrite(
      stale.map((s) => ({
        updateOne: { filter: { _id: s._id }, update: { $set: { pairKey: s.pairKey } } },
      })),
      { ordered: false },
    );
    console.log(`\nbackfilled pairKey on ${result.modifiedCount}`);
  }

  /* --- 3. the new uniqueness rule, before the old one goes -------------- */

  if (!pairOk) {
    if (pairIx) {
      console.log(`dropping ${PAIR_KEY.name}…`);
      await col.dropIndex(PAIR_KEY.name);
    }
    console.log(`creating ${PAIR_KEY.name} unique…`);
    await col.createIndex(PAIR_KEY.key, { unique: true, name: PAIR_KEY.name });
  }

  /* --- 4. participants_1, without unique ------------------------------- */

  if (!membersOk) {
    if (membersIx) {
      console.log(`dropping ${MEMBERS.name}…`);
      await col.dropIndex(MEMBERS.name);
    }
    console.log(`creating ${MEMBERS.name} (not unique)…`);
    await col.createIndex(MEMBERS.key, { name: MEMBERS.name });
  }

  /* --- confirm --------------------------------------------------------- */

  const after = await readIndexes(col);
  const pairAfter = after.find((i) => i.name === PAIR_KEY.name);
  const membersAfter = after.find((i) => i.name === MEMBERS.name);
  const keyed = await col.countDocuments({ pairKey: { $type: 'string' } });

  console.log('\nindexes now:');
  console.log(`  ${PAIR_KEY.name}: ${describe(pairAfter)}`);
  console.log(`  ${MEMBERS.name}: ${describe(membersAfter)}`);
  console.log(`conversations with a pairKey: ${keyed} of ${total}`);

  if (pairAfter?.unique !== true || !membersAfter || membersAfter.unique === true) {
    throw new Error('indexes are not in the expected state after migrating');
  }

  console.log('\n✓ migration complete');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
