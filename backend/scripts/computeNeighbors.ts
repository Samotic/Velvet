/**
 * Rebuilds every user's neighbourhood — §10.
 *
 *   cd backend && npx tsx scripts/computeNeighbors.ts
 *
 * Nightly in production. Similarity against every other user at request time
 * is O(N·M); §16 asks for p95 under 400ms, which is only reachable because
 * this has already run.
 *
 * Uses the inverted index, so the work is proportional to co-rating density
 * rather than user count. A user who shares no items with anyone is compared
 * against nobody.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { computeAllNeighbors } from '../src/lib/cf/neighbors';
import { recomputePopularity } from '../src/lib/cf/popularity';
import { UserNeighbors } from '../src/models/UserNeighbors';
import { CF_PARAMS } from '../src/types/cf';

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  // IUF feeds the similarity weights, so it has to be current before the pass.
  await recomputePopularity();

  const started = Date.now();
  const out = await computeAllNeighbors();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`users processed : ${out.usersProcessed}`);
  console.log(`pairs compared  : ${out.pairsCompared}   (O(N^2) would be ${
    (out.usersProcessed * (out.usersProcessed - 1)) / 2
  })`);
  console.log(`edges written   : ${out.edgesWritten}`);
  console.log(`elapsed         : ${seconds}s`);

  const withEnough = await UserNeighbors.countDocuments({
    [`neighbors.${CF_PARAMS.cfMinNeighbors - 1}`]: { $exists: true },
  });
  console.log(
    `\nusers with >=${CF_PARAMS.cfMinNeighbors} neighbours (cf tier eligible): ${withEnough} / ${out.usersProcessed}`,
  );

  if (out.edgesWritten === 0) {
    console.log(
      '\nNo edges. Every pair either shares fewer than ' +
        `${CF_PARAMS.minCoRated} items or correlates at or below ${CF_PARAMS.minSim}. ` +
        'This is expected on a matrix with no co-rated titles.',
    );
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('computeNeighbors failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
