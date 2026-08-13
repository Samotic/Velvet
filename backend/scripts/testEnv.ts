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
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'verify_script_secret';

process.env.RESEND_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.TMDB_READ_TOKEN = '';
process.env.TMDB_API_KEY = '';
process.env.IGDB_CLIENT_ID = '';
process.env.IGDB_CLIENT_SECRET = '';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

export {};
