/**
 * Backfills the edit and soft-delete fields, and the per-participant inbox
 * preview that per-user deletes made necessary.
 *
 *   cd backend && npx tsx scripts/migrate-message-soft-delete.ts            # dry run
 *   cd backend && npx tsx scripts/migrate-message-soft-delete.ts --apply    # writes
 *
 * **Dry run is the default, and `--apply` is required to write anything.** It
 * used to be the reverse — writes by default, `--dry` to hold back — and was
 * changed to match the other migrations. `--dry` is now simply ignored.
 *
 * Two halves, and the second is the one that matters.
 *
 *   1. Messages get the new fields at their defaults. Mongoose would supply
 *      these on read anyway, but a document that carries them can be queried
 *      on them — and `deletedFor: { $ne: <me> }`, which every read path now
 *      applies, is only index-usable against a field that exists.
 *
 *   2. Conversations get `lastFor` seeded for **both** participants from the
 *      shared `lastMessage` they already had. Without this every existing
 *      thread falls back to the shared string, so the first per-user delete
 *      is the moment the preview starts telling one of them the truth and the
 *      other something stale. Seeding both to the current value means the
 *      fallback is never reached and the map is authoritative from the start.
 *
 * Idempotent: the message pass filters on the field being absent, and the
 * conversation pass rewrites `lastFor` from data that does not change unless a
 * message does. Safe to run more than once, and safe to run against a database
 * already partly migrated.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { Conversation } from '../src/models/Conversation';
import { Message } from '../src/models/Message';

// Dry unless told otherwise, like every migration here: a default that writes is
// one muscle-memory invocation away from running against production by accident.
const DRY = !process.argv.includes('--apply');

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  if (DRY) console.log('dry run — no writes\n');

  /* --- 1. messages ------------------------------------------------------ */

  const pending = await Message.countDocuments({ deletedForEveryone: { $exists: false } });
  console.log(`messages missing the new fields: ${pending}`);

  if (!DRY && pending) {
    const result = await Message.updateMany(
      { deletedForEveryone: { $exists: false } },
      {
        $set: {
          deletedForEveryone: false,
          deletedAt: null,
          deletedBy: null,
          deletedFor: [],
          editedAt: null,
          editHistory: [],
          // Media sent before these existed keeps a null id on purpose: it is
          // the signal that `destroyMedia` should fall back to parsing the URL.
          mediaPublicId: null,
          mediaResourceType: null,
        },
      },
    );
    console.log(`  modified ${result.modifiedCount}`);
  }

  /* --- 2. conversation previews ----------------------------------------- */

  const convos = await Conversation.find({})
    .select('_id participants lastMessage lastMessageAt lastSenderId lastFor')
    .lean();

  console.log(`conversations to seed: ${convos.length}`);

  let seeded = 0;
  for (const c of convos) {
    const shared = {
      text: c.lastMessage ?? '',
      at: c.lastMessageAt ?? null,
      senderId: c.lastSenderId ?? null,
    };

    const set: Record<string, unknown> = {};
    for (const p of c.participants ?? []) set[`lastFor.${String(p)}`] = shared;
    if (!Object.keys(set).length) continue;

    seeded += 1;
    if (!DRY) await Conversation.updateOne({ _id: c._id }, { $set: set });
  }

  console.log(`  ${DRY ? 'would seed' : 'seeded'} ${seeded}`);
  console.log('\n✓ migration complete');

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
