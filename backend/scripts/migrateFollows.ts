/**
 * One-off: moves the follow graph out of `users.following` / `users.followers`
 * and into the `follows` collection, then seeds the denormalized counters.
 *
 *   cd backend && npx tsx scripts/migrateFollows.ts [--dry]
 *
 * Idempotent. Every edge is an upsert keyed by the unique (follower, following)
 * index, so re-running converges rather than duplicating — which matters,
 * because the realistic failure mode is a half-finished run.
 *
 * The old arrays are deliberately **not** deleted. They are the only copy of
 * the pre-migration graph; if something is wrong here you want to be able to
 * run it again. Dropping them is a separate decision for a later release.
 *
 * Direction matters and is easy to get backwards: `u.following` holds the
 * people u follows, so each id there becomes an edge followerId=u →
 * followingId=id. Reading `u.followers` as well would produce the same edges a
 * second time from the other side, so this only ever walks `following`.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { Follow } from '../src/models/Follow';
import { User } from '../src/models/User';

const DRY = process.argv.includes('--dry');

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  const users = await User.find({}).select('_id following followers').lean();
  console.log(`${users.length} users to walk${DRY ? '  (dry run — no writes)' : ''}`);

  let edges = 0;
  let skippedSelf = 0;

  for (const u of users) {
    for (const target of u.following ?? []) {
      // A self-follow can exist in legacy data; the new model forbids it.
      if (String(target) === String(u._id)) {
        skippedSelf += 1;
        continue;
      }
      edges += 1;
      if (DRY) continue;

      await Follow.updateOne(
        { followerId: u._id, followingId: target },
        {
          // Everything that already existed was, by definition, accepted —
          // there was no pending state before this migration.
          $setOnInsert: { status: 'accepted', createdAt: new Date(), respondedAt: new Date() },
        },
        { upsert: true },
      );
    }
  }

  console.log(`edges written: ${edges}${skippedSelf ? `  (skipped ${skippedSelf} self-follows)` : ''}`);

  if (!DRY) {
    console.log('seeding counters…');
    await reconcile();
  }

  await disconnectDb();
}

/** Recomputes every counter from the edges themselves. Shared shape with
 *  scripts/reconcileCounters.ts, which is the standalone repair tool. */
async function reconcile(): Promise<void> {
  const users = await User.find({}).select('_id').lean();
  for (const u of users) {
    const [followerCount, followingCount, pendingRequestCount] = await Promise.all([
      Follow.countDocuments({ followingId: u._id, status: 'accepted' }),
      Follow.countDocuments({ followerId: u._id, status: 'accepted' }),
      Follow.countDocuments({ followingId: u._id, status: 'pending' }),
    ]);
    await User.updateOne(
      { _id: u._id },
      { $set: { followerCount, followingCount, pendingRequestCount } },
    );
  }
  console.log(`counters seeded for ${users.length} users`);
}

main()
  .catch(async (err) => {
    console.error('migration failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
