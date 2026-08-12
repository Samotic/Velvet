/**
 * Repairs drift between the denormalized counters on `users` and the edges
 * they summarise.
 *
 *   cd backend && npx tsx scripts/reconcileCounters.ts [--dry]
 *
 * The counters are maintained by `$inc` alongside every edge write, inside a
 * transaction where the deployment has them. Two things still cause drift:
 *
 *   1. `SUPPORTS_TRANSACTIONS=false` (standalone mongod). The edge write and
 *      the `$inc` are then separate operations, and a crash between them
 *      leaves the counter wrong permanently.
 *   2. Direct database edits — exactly what the manual test scripts do.
 *
 * So this is not a nicety. It is the thing that makes acceptance criterion 9
 * — "followerCount matches countDocuments for every user" — true again, and
 * it should run on a schedule in any deployment without transactions.
 *
 * Safe to run at any time: it only ever writes counts recomputed from the
 * edges themselves, so it converges and never compounds an error.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { Follow } from '../src/models/Follow';
import { Notification } from '../src/models/Notification';
import { User } from '../src/models/User';

const DRY = process.argv.includes('--dry');

type Drift = { username: string; field: string; was: number; now: number };

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  const users = await User.find({})
    .select('_id username followerCount followingCount pendingRequestCount unreadNotificationCount')
    .lean();

  console.log(`checking ${users.length} users${DRY ? '  (dry run — no writes)' : ''}`);

  const drifts: Drift[] = [];

  for (const u of users) {
    const [followerCount, followingCount, pendingRequestCount, unreadNotificationCount] =
      await Promise.all([
        // Accepted only, both ways — a pending request is not a follow.
        Follow.countDocuments({ followingId: u._id, status: 'accepted' }),
        Follow.countDocuments({ followerId: u._id, status: 'accepted' }),
        Follow.countDocuments({ followingId: u._id, status: 'pending' }),
        Notification.countDocuments({ userId: u._id, read: false }),
      ]);

    const truth = {
      followerCount,
      followingCount,
      pendingRequestCount,
      unreadNotificationCount,
    };

    for (const [field, now] of Object.entries(truth)) {
      const was = (u as unknown as Record<string, number>)[field] ?? 0;
      if (was !== now) drifts.push({ username: u.username, field, was, now });
    }

    if (!DRY) await User.updateOne({ _id: u._id }, { $set: truth });
  }

  if (!drifts.length) {
    console.log('✓ no drift — every counter already matches its edges');
  } else {
    console.log(`${drifts.length} counter(s) ${DRY ? 'would be' : ''} corrected:`);
    for (const d of drifts) console.log(`  ${d.username}.${d.field}: ${d.was} -> ${d.now}`);
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('reconcile failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
