/**
 * Marks an account's email verified by hand.
 *
 * Messaging and the advisor sit behind `requireVerified`, which reads the flag
 * from the database on every request. Test accounts created with addresses
 * nobody can open the link for are stuck at that gate, and this is the operator
 * escape hatch — the same "set by hand in the database" treatment `isPro` gets.
 *
 * It is deliberately narrow: it flips one flag on accounts you name, and will
 * not touch an account it cannot find.
 *
 *   npx tsx scripts/verifyAccount.ts ada ben
 *   npx tsx scripts/verifyAccount.ts ada@example.com
 *
 * Pass `--list` to see who is currently unverified instead of changing anything.
 */
import 'dotenv/config';

import mongoose from 'mongoose';

import { env } from '../src/config/env';
import { User } from '../src/models/User';

async function main() {
  const args = process.argv.slice(2);

  if (!env.mongoUri) {
    console.error('MONGODB_URI is not set. Check backend/.env.');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(env.mongoUri);
  try {
    if (args.includes('--list') || args.length === 0) {
      const pending = await User.find({ emailVerified: { $ne: true } })
        .select('username email createdAt')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      if (!pending.length) {
        console.log('Every account is already verified.');
        return;
      }
      console.log(`${pending.length} unverified account(s):\n`);
      for (const u of pending) console.log(`  @${u.username}  ${u.email}`);
      console.log('\nRe-run with the handles you want to verify, e.g.');
      console.log(`  npx tsx scripts/verifyAccount.ts ${pending.slice(0, 2).map((u) => u.username).join(' ')}`);
      return;
    }

    for (const raw of args) {
      const key = raw.trim().toLowerCase().replace(/^@/, '');
      // Accept either a handle or an address, so it works with whatever the
      // operator has to hand.
      const user = await User.findOne(
        key.includes('@') ? { email: key } : { username: key },
      ).select('username email emailVerified');

      if (!user) {
        console.log(`  ?  ${raw} — no such account, skipped`);
        continue;
      }
      if (user.emailVerified) {
        console.log(`  ·  @${user.username} — already verified`);
        continue;
      }
      user.emailVerified = true;
      await user.save();
      console.log(`  ✓  @${user.username} (${user.email}) — verified`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('verifyAccount failed:', err);
  process.exitCode = 1;
});
