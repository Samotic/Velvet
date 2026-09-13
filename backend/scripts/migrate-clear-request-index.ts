/**
 * Creates the indexes behind clearing a conversation for both participants.
 *
 *   cd backend && npx tsx scripts/migrate-clear-request-index.ts            # dry run
 *   cd backend && npx tsx scripts/migrate-clear-request-index.ts --apply    # writes
 *
 * **Dry run is the default, and `--apply` is required to write anything**,
 * like every migration here.
 *
 * ── What it creates ──
 *  1. `one_pending_per_conversation` — `{ conversationId: 1 }`, unique, with
 *     `partialFilterExpression: { status: { $eq: 'pending' } }`. One pending
 *     request per thread, and any number of resolved ones. See the note on the
 *     index in `src/models/ClearRequest.ts` for why it must be partial.
 *  2. `{ conversationId: 1, status: 1, resolvedAt: -1 }` — the lookup for the
 *     thread's "cleared" notice and the inbox's "Chat cleared".
 *
 * ── Why a script ──
 * `autoIndex` is off in production, so neither index reaches Atlas on its own.
 * Without the first, the feature still works but two simultaneous requests for
 * the same thread can both be created.
 *
 * ── When ──
 * **Before** the deploy that ships the feature. The collection is new: no
 * running code reads it, so there is nothing to stop, and an index on an empty
 * collection builds instantly. Run afterwards instead and the gap is a window
 * in which duplicates can land — if they have, this reports them and the create
 * fails loudly rather than half-succeeding.
 *
 * Imports the index definition from `clearRequestIndex.ts`, never the model:
 * registering the schema would let autoIndex build the index outside production
 * and turn the dry run into a write.
 *
 * Idempotent: an index already matching is left alone. Safe to re-run.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import {
  PENDING_INDEX_FILTER,
  PENDING_INDEX_KEYS,
  PENDING_INDEX_NAME,
  RESOLVED_INDEX_KEYS,
} from '../src/models/clearRequestIndex';

const DRY = !process.argv.includes('--apply');

type IndexInfo = {
  name?: string;
  key?: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  if (DRY) console.log('dry run — no writes\n');

  const db = mongoose.connection.db!;
  const col = db.collection('clearrequests');

  const exists = (await db.listCollections({ name: 'clearrequests' }).toArray()).length > 0;
  const existing: IndexInfo[] = exists ? ((await col.indexes()) as IndexInfo[]) : [];
  console.log(`collection "clearrequests": ${exists ? `present, ${existing.length} indexes` : 'not present yet'}`);

  /* --- 1. the partial unique index ----------------------------------------- */

  const current = existing.find((i) => i.name === PENDING_INDEX_NAME);
  const pendingDone =
    !!current &&
    current.unique === true &&
    same(current.key, PENDING_INDEX_KEYS) &&
    same(current.partialFilterExpression, PENDING_INDEX_FILTER);

  console.log(`\nindex "${PENDING_INDEX_NAME}":`);
  if (!current) console.log('  not present');
  else {
    console.log(`  key:     ${JSON.stringify(current.key)}`);
    console.log(`  unique:  ${String(current.unique)}`);
    console.log(`  partial: ${JSON.stringify(current.partialFilterExpression ?? null)}`);
  }

  // Reported before any write: these are what would make the create fail.
  const duplicates = exists
    ? await col
        .aggregate<{ _id: unknown; n: number }>([
          { $match: { status: 'pending' } },
          { $group: { _id: '$conversationId', n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
        ])
        .toArray()
    : [];
  if (duplicates.length) {
    console.log(`\n!! ${duplicates.length} conversation(s) already hold more than one pending request:`);
    for (const d of duplicates) console.log(`   ${String(d._id)}  ${d.n} pending`);
    console.log('   Cancel all but the newest of each before --apply, or the create will fail.');
  }

  /* --- 2. the lookup index --------------------------------------------------- */

  const resolvedDone = existing.some((i) => same(i.key, RESOLVED_INDEX_KEYS));
  console.log(`\nindex ${JSON.stringify(RESOLVED_INDEX_KEYS)}: ${resolvedDone ? 'present' : 'not present'}`);

  if (pendingDone && resolvedDone) {
    console.log('\n✓ already migrated — nothing to do');
    await disconnectDb();
    return;
  }

  if (DRY) {
    if (!pendingDone) {
      console.log(
        `\nwould ${current ? 'drop and re-create' : 'create'} "${PENDING_INDEX_NAME}" with:` +
          `\n  key: ${JSON.stringify(PENDING_INDEX_KEYS)}  unique: true` +
          `\n  partialFilterExpression: ${JSON.stringify(PENDING_INDEX_FILTER)}`,
      );
    }
    if (!resolvedDone) console.log(`would create ${JSON.stringify(RESOLVED_INDEX_KEYS)}`);
    console.log('\n✓ dry run complete');
    await disconnectDb();
    return;
  }

  if (!pendingDone) {
    // A same-named index with other options cannot be redefined in place
    // (IndexKeySpecsConflict), so it is dropped explicitly first.
    if (current) {
      console.log(`\ndropping "${PENDING_INDEX_NAME}"…`);
      await col.dropIndex(PENDING_INDEX_NAME);
    }
    console.log(`creating "${PENDING_INDEX_NAME}"…`);
    await col.createIndex(PENDING_INDEX_KEYS, {
      name: PENDING_INDEX_NAME,
      unique: true,
      partialFilterExpression: PENDING_INDEX_FILTER,
    });
  }

  if (!resolvedDone) {
    console.log(`creating ${JSON.stringify(RESOLVED_INDEX_KEYS)}…`);
    await col.createIndex(RESOLVED_INDEX_KEYS);
  }

  const after = ((await col.indexes()) as IndexInfo[]).find((i) => i.name === PENDING_INDEX_NAME);
  console.log(`  "${PENDING_INDEX_NAME}" now: unique=${String(after?.unique)} partial=${JSON.stringify(after?.partialFilterExpression ?? null)}`);

  console.log('\n✓ migration complete');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
