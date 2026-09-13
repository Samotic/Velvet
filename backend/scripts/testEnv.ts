/**
 * Test environment, applied before anything else loads.
 *
 * **This module must be the first import in a verify script.**
 *
 * `src/config/env.ts` snapshots `process.env` into a frozen object the moment it
 * is first imported, and esbuild hoists `import` statements above any plain
 * assignments at the top of a file. So setting these inline in the script does
 * nothing — by the time those lines run, `env` has already captured the real
 * `.env`. As a module, this runs at import time, and import *order* is
 * preserved, so it lands before `../src/app` pulls in the config.
 *
 * Without it a verify run signs tokens with the developer's real JWT secret,
 * calls TMDB and IGDB for real, and — the one that actually bit — sends live
 * email through Resend to `ada@velvet.test`.
 *
 * dotenv does not overwrite a variable that is already present, and `''` counts
 * as present, so blanking here wins.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'verify_script_secret';

// mongodb-memory-server starts a bare `mongod`, not a replica set, so every
// transaction it is handed throws "Transaction numbers are only allowed on a
// replica set member or mongos". `supportsTransactions` defaults on for Atlas,
// which means the verify run must opt out explicitly or the whole follow graph
// 500s and takes notifications, the activity feed and messaging down with it.
process.env.SUPPORTS_TRANSACTIONS = 'false';

process.env.RESEND_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
// Both advisor providers, not just the selected one: a verify run must never
// reach a real model. Leaving GEMINI_API_KEY set made `verify:api` spend money
// on a live call and turned "AI answers 503 without a key" into a 200.
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.TMDB_READ_TOKEN = '';
process.env.TMDB_API_KEY = '';
process.env.IGDB_CLIENT_ID = '';
process.env.IGDB_CLIENT_SECRET = '';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

// With Cloudinary blanked, every retraction in a verify run strands its fixture
// media, and stranded media is appended to `orphaned-media.json` relative to the
// working directory — `backend/`, where the real list from a production dry run
// lives. Without this, each run writes fake asset ids into the real list.
process.env.ORPHANED_MEDIA_FILE = join(tmpdir(), `velvet-verify-${process.pid}-orphaned-media.json`);

export {};
