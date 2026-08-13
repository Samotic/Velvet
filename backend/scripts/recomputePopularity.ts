/**
 * Rebuilds `itemPopularity` — rater counts, mean ratings and IUF.
 *
 *   cd backend && npx tsx scripts/recomputePopularity.ts
 *
 * Nightly in production. IUF is a global statistic: one new rating moves every
 * item's value by a rounding error, so recomputing it per write would be
 * enormous churn for no accuracy.
 *
 * Also backfills `userStats` for anyone missing it, since similarity cannot be
 * computed for a user with no cached mean.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { recomputePopularity } from '../src/lib/cf/popularity';
import { recomputeUserStats } from '../src/lib/cf/stats';
import { ItemPopularity } from '../src/models/ItemPopularity';
import { User } from '../src/models/User';

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  const { items, users } = await recomputePopularity();
  console.log(`itemPopularity: ${items} items across ${users} users`);

  const all = await User.find({}).select('_id').lean();
  for (const u of all) await recomputeUserStats(u._id);
  console.log(`userStats: refreshed for ${all.length} users`);

  // The number that decides whether CF can do anything at all.
  const shared = await ItemPopularity.countDocuments({ raterCount: { $gt: 1 } });
  console.log(`\nitems rated by more than one user: ${shared}`);
  if (shared === 0) {
    console.log(
      '  -> no co-rated items, so every Pearson correlation is 0 or undefined.\n' +
        '     CF stays inert until users share rated titles. This is expected on a\n' +
        '     new instance; the taste picker is what fixes it.',
    );
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('recomputePopularity failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
