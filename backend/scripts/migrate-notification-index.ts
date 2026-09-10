/**
 * Swaps the notification dedupe index from `sparse` to a partial filter.
 *
 *   cd backend && npx tsx scripts/migrate-notification-index.ts            # dry run
 *   cd backend && npx tsx scripts/migrate-notification-index.ts --apply    # writes
 *
 * **Dry run is the default, and `--apply` is required to write anything.** It
 * used to be the reverse — writes by default, `--dry` to hold back — and was
 * changed to match the other migrations. `--dry` is now simply ignored.
 *
 * ── Why a script and not autoIndex ──
 * MongoDB refuses to redefine an index with the same keys and different
 * options (`IndexKeySpecsConflict`), so `createIndex` alone cannot do this.
 * Mongoose raises that as an event nobody listens to, meaning the app boots
 * with the schema and the database disagreeing and nothing says so. The swap
 * has to be an explicit drop followed by a create, and it has to be somewhere
 * a failure is visible.
 *
 * ── What it fixes ──
 * The old index was `unique + sparse` on `(userId, type, followId)`. In a
 * **compound** index, sparse skips a document only when *every* indexed field
 * is missing — and `userId` and `type` are always present. So every
 * notification was indexed, including the ones whose `followId` is null, and
 * each user could hold exactly one `message`, one `review_like` and one
 * `review_reply` notification ever. The rest hit a duplicate key, `notify`
 * swallowed it, and the card was never created.
 *
 * ── Safety ──
 * The new index covers a strict **subset** of the old one — only rows where
 * `followId` is a real ObjectId — and those were already unique under the old
 * index. So no existing document can violate it, and the follow dedupe the
 * index exists for is unchanged.
 *
 * There is a window between the drop and the create with no unique constraint.
 * It is milliseconds, and what could slip through is a duplicate *follow*
 * notification from someone double-tapping Follow at that instant. If it does,
 * the create fails loudly rather than silently, and re-running after removing
 * the duplicate finishes the job.
 *
 * Idempotent: it inspects the live index first and does nothing when the
 * partial index is already in place. Safe to re-run.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';

// Dry unless told otherwise, like every migration here: a default that writes is
// one muscle-memory invocation away from running against production by accident.
const DRY = !process.argv.includes('--apply');

const NAME = 'userId_1_type_1_followId_1';
const KEYS = { userId: 1, type: 1, followId: 1 } as const;
const PARTIAL = { followId: { $type: 'objectId' } } as const;

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  if (DRY) console.log('dry run — no writes\n');

  const col = mongoose.connection.db!.collection('notifications');
  const existing = (await col.indexes()) as {
    name?: string;
    key?: Record<string, number>;
    unique?: boolean;
    sparse?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  }[];

  const current = existing.find((i) => i.name === NAME);

  console.log(`index "${NAME}":`);
  if (!current) {
    console.log('  not present');
  } else {
    console.log(`  unique:  ${String(current.unique)}`);
    console.log(`  sparse:  ${String(current.sparse)}`);
    console.log(`  partial: ${JSON.stringify(current.partialFilterExpression ?? null)}`);
  }

  const alreadyDone =
    current?.partialFilterExpression !== undefined &&
    JSON.stringify(current.partialFilterExpression) === JSON.stringify(PARTIAL);

  if (alreadyDone) {
    console.log('\n✓ already migrated — nothing to do');
    await disconnectDb();
    return;
  }

  /**
   * Reported before touching anything, because it is the number that says
   * whether this was actually hurting: every one of these rows is a
   * notification that could not be created a second time.
   */
  const affected = await col.countDocuments({ followId: null });
  console.log(`\nrows with followId: null (message / review_like / review_reply): ${affected}`);

  if (DRY) {
    console.log('\nwould drop the index and recreate it with:');
    console.log(`  partialFilterExpression: ${JSON.stringify(PARTIAL)}`);
    console.log('\n✓ dry run complete');
    await disconnectDb();
    return;
  }

  if (current) {
    console.log('\ndropping…');
    await col.dropIndex(NAME);
  }

  console.log('creating…');
  await col.createIndex(KEYS, { unique: true, partialFilterExpression: PARTIAL, name: NAME });

  const after = (await col.indexes()).find((i) => i.name === NAME) as
    | { partialFilterExpression?: Record<string, unknown> }
    | undefined;
  console.log(`  partial now: ${JSON.stringify(after?.partialFilterExpression ?? null)}`);

  console.log('\n✓ migration complete');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
