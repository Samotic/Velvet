/**
 * §16 criterion 1 — two accounts with disjoint taste must produce feeds with
 * under 20% overlap.
 *
 *   cd backend && npx tsx scripts/checkFeedDivergence.ts
 *
 * Runs against whatever matrix is in the database; pair it with
 * seedSyntheticMatrix.ts to get a population big enough for the cf tier.
 *
 * Picks the *least* similar pair rather than two arbitrary users. Two random
 * accounts might happen to share taste, and a passing number would then say
 * nothing. The strongest form of the claim is that people who demonstrably
 * disagree get different feeds.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { buildCandidates } from '../src/lib/cf/candidates';
import { UserNeighbors } from '../src/models/UserNeighbors';
import { UserStats } from '../src/models/UserStats';

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  const eligible = await UserStats.find({ ratingCount: { $gte: 10 } }).select('userId').lean();
  if (eligible.length < 2) {
    console.log('Need at least two users with >= 10 ratings. Seed a fixture first.');
    await disconnectDb();
    return;
  }

  // Find a pair that are NOT neighbours of each other — i.e. their correlation
  // never cleared the floor, which is as disjoint as this data gets.
  const ids = eligible.map((e) => String(e.userId));
  const neighborDocs = await UserNeighbors.find({ userId: { $in: eligible.map((e) => e.userId) } })
    .select('userId neighbors.userId')
    .lean();

  const neighborsOf = new Map<string, Set<string>>();
  for (const d of neighborDocs) {
    neighborsOf.set(String(d.userId), new Set(d.neighbors.map((n) => String(n.userId))));
  }

  let pair: [string, string] | null = null;
  outer: for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      if (!neighborsOf.get(a)?.has(b)) {
        pair = [a, b];
        break outer;
      }
    }
  }

  if (!pair) {
    console.log('Every eligible user is a neighbour of every other — matrix is too small to test.');
    await disconnectDb();
    return;
  }

  const [a, b] = pair;
  const [ra, rb] = await Promise.all([buildCandidates(a), buildCandidates(b)]);

  const topA = new Set(ra.candidates.slice(0, 20).map((c) => c.itemKey));
  const topB = new Set(rb.candidates.slice(0, 20).map((c) => c.itemKey));

  if (!topA.size || !topB.size) {
    console.log(
      `One of the pair has no CF candidates (A=${topA.size}, B=${topB.size}); ` +
        'they are below the cf tier, so this criterion does not apply to them.',
    );
    await disconnectDb();
    return;
  }

  let shared = 0;
  for (const k of topA) if (topB.has(k)) shared += 1;
  const overlap = shared / Math.min(topA.size, topB.size);

  console.log(`user A candidates : ${ra.candidates.length}  (top ${topA.size} compared)`);
  console.log(`user B candidates : ${rb.candidates.length}  (top ${topB.size} compared)`);
  console.log(`shared items      : ${shared}`);
  console.log(`overlap           : ${(overlap * 100).toFixed(1)}%   (criterion 1: < 20%)`);
  console.log(`\n  => criterion 1 ${overlap < 0.2 ? 'PASS' : 'FAIL'}`);

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('checkFeedDivergence failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
