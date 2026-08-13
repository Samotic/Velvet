/**
 * Generates a synthetic rating matrix so the CF pipeline can actually be
 * evaluated.
 *
 *   npx tsx scripts/seedSyntheticMatrix.ts [--users 60] [--wipe]
 *
 * ── Why this exists ──
 * Velvet's real matrix has zero co-rated items, so every Pearson correlation
 * is 0 and the evaluation harness has nothing to measure. Without a fixture,
 * "the CF works" is an untested claim about code that will not throw when it
 * is wrong — the precise failure §17 warns about.
 *
 * ── What makes it a fair test ──
 * Ratings are generated from **latent taste vectors**, not at random. Each
 * synthetic user gets a hidden affinity across a few taste dimensions; each
 * item gets its own; a rating is their dot product plus noise. That means real
 * structure exists to be found, and a working CF should recover it while a
 * broken one should not — which is exactly what RMSE-vs-baseline detects.
 * Uniformly random ratings would make every recommender look equally useless.
 *
 * All accounts are prefixed `synth_` and `--wipe` removes them. This writes to
 * whatever database MONGODB_URI points at, so do not run it against
 * production.
 */
import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { recomputePopularity } from '../src/lib/cf/popularity';
import { recomputeUserStats } from '../src/lib/cf/stats';
import { Rating } from '../src/models/Rating';
import { User } from '../src/models/User';
import { UserNeighbors } from '../src/models/UserNeighbors';
import { UserStats } from '../src/models/UserStats';
import type { ContentType } from '../src/models/User';

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const USERS = arg('users', 60);
const ITEMS = arg('items', 120);
const DIMENSIONS = 4;
/** Roughly how many of the catalogue each user rates. Sparse, like real life. */
const DENSITY = 0.22;

const PREFIX = 'synth_';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967295;
  };
}

async function wipe(): Promise<void> {
  const users = await User.find({ email: new RegExp(`^${PREFIX}`) }).select('_id').lean();
  const ids = users.map((u) => u._id);
  await Rating.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  await UserStats.deleteMany({ userId: { $in: ids } });
  await UserNeighbors.deleteMany({ userId: { $in: ids } });
  console.log(`removed ${ids.length} synthetic users and their ratings`);
}

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  if (process.argv.includes('--wipe')) {
    await wipe();
    await recomputePopularity();
    await disconnectDb();
    return;
  }

  await wipe();

  const rand = rng(20260813);
  const types: ContentType[] = ['movie', 'series', 'game'];

  // Latent vectors: the structure the CF is supposed to rediscover.
  const itemVecs = Array.from({ length: ITEMS }, () =>
    Array.from({ length: DIMENSIONS }, () => rand() * 2 - 1),
  );
  const userVecs = Array.from({ length: USERS }, () =>
    Array.from({ length: DIMENSIONS }, () => rand() * 2 - 1),
  );

  const users: Types.ObjectId[] = [];
  for (let u = 0; u < USERS; u += 1) {
    const doc = await User.create({
      email: `${PREFIX}${u}@velvet.local`,
      username: `${PREFIX}${u}`,
      displayName: `Synth ${u}`,
      passwordHash: 'x'.repeat(60),
      emailVerified: true,
      onboardingCompleted: true,
      onboardingStep: 3,
    });
    users.push(doc._id);
  }

  let written = 0;
  const ops = [];

  for (let u = 0; u < USERS; u += 1) {
    // Per-user rating bias — some people rate generously, some harshly. This
    // is what mean-centring exists to remove, so the fixture must contain it.
    const bias = (rand() - 0.5) * 1.2;

    for (let i = 0; i < ITEMS; i += 1) {
      if (rand() > DENSITY) continue;

      const dot = userVecs[u].reduce((s, x, d) => s + x * itemVecs[i][d], 0);
      const noise = (rand() - 0.5) * 0.9;
      // dot is roughly [-1,1]; map to the 1-5 scale around a centre of 3.
      const raw = 3 + dot * 1.6 + bias + noise;
      const value = Math.max(1, Math.min(5, Math.round(raw)));

      const type = types[i % 3];
      ops.push({
        insertOne: {
          document: {
            userId: users[u],
            contentId: `synth-${i}`,
            contentType: type,
            contentTitle: `Synthetic Title ${i}`,
            poster: null,
            rating: value,
            source: 'explicit',
            review: '',
            likes: [],
            replies: [],
            runtimeMinutes: null,
            genres: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      });
      written += 1;
    }
  }

  await Rating.bulkWrite(ops);
  for (const id of users) await recomputeUserStats(id);
  const pop = await recomputePopularity();

  console.log(`users        : ${USERS}`);
  console.log(`items        : ${ITEMS}`);
  console.log(`ratings      : ${written}  (density ${(written / (USERS * ITEMS)).toFixed(3)})`);
  console.log(`popularity   : ${pop.items} items`);
  console.log('\nnow run:  npx tsx scripts/computeNeighbors.ts && npx tsx scripts/evaluateCF.ts');

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('seed failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
