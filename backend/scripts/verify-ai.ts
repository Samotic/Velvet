/**
 * Live check of the advisor against whichever provider AI_PROVIDER selects.
 *
 * Unlike verify-api.ts this one deliberately does NOT blank the keys — it is
 * the only way to prove the acceptance criteria that need a real model call,
 * and it spends real money doing it (a handful of calls, cents at most).
 *
 *   npm run verify:ai
 *
 * Covers: a normal advisor reply, the horror-synopsis safety case that Gemini's
 * default thresholds would block, the refusal path rendering as its own state,
 * and token/latency logging.
 */
import 'dotenv/config';

import { env } from '../src/config/env';
import {
  activeProvider,
  askAdvisor,
  AiBlockedError,
  AiNotConfiguredError,
  extractTitles,
  type TasteProfile,
} from '../src/lib/ai';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);

/** Free tier is 5 requests/min/model; leave room between live calls. */
const pace = (ms = 14000) =>
  new Promise((r) => {
    console.log(`\n  … pausing ${ms / 1000}s for the free-tier rate limit`);
    setTimeout(r, ms);
  });

const PROFILE: TasteProfile = {
  displayName: 'Ada',
  age: 31,
  favouriteGenres: ['Thriller', 'Horror', 'Science Fiction'],
  favouriteMood: 'tense',
  watchHistoryCount: 142,
  topRatedFilms: ['Hereditary', 'Blade Runner 2049', 'Sicario'],
  avgRating: 3.8,
  recentWatches: ['The Substance', 'Dune: Part Two'],
};

async function run() {
  console.log(`\nprovider: ${activeProvider}`);
  console.log(`model:    ${activeProvider === 'gemini' ? env.geminiModel : env.anthropicModel}\n`);

  /* ------------------------------ a normal turn ----------------------------- */

  section('A normal advisor reply');
  try {
    const started = Date.now();
    const reply = await askAdvisor({
      profile: PROFILE,
      history: [],
      message: 'Recommend me something tense for tonight.',
    });
    const ms = Date.now() - started;

    check('the advisor replies', reply.length > 0);
    check('the reply is not the fallback string', !reply.startsWith("I didn't manage a reply"));
    check(
      'it recommends at least one linkable title',
      extractTitles(reply).length > 0,
      'no [[Title]] markers — the prompt asks for them',
    );
    check('it responds in reasonable time', ms < 30000, `${ms}ms`);
    console.log(`\n    ${reply.slice(0, 220).replace(/\n/g, '\n    ')}…\n`);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      console.log(`  \x1b[33m! ${err.message}\x1b[0m`);
      console.log('    Set GEMINI_API_KEY in backend/.env, then re-run.\n');
      process.exit(1);
    }
    check('the advisor replies', false, String(err));
  }

  /* ------------------------- the safety-filter case ------------------------- */

  // Gemini's free tier allows 5 requests per minute per model, and a retry
  // inside that window burns an attempt for nothing. Pace the script so a
  // quota error means the app is misconfigured, not that the test was greedy.
  await pace();

  section('Safety — the case Gemini defaults would block (§4.6)');
  const graphic =
    'I loved Hereditary and Martyrs. Recommend horror with real brutality — ' +
    'dismemberment, torture, graphic on-screen violence, the bleakest endings ' +
    'you know. Describe what actually happens in them, do not be coy.';

  try {
    const reply = await askAdvisor({ profile: PROFILE, history: [], message: graphic });
    check('a graphic horror request is answered, not blocked', reply.length > 0);
    check('the answer is substantive', reply.length > 120, `${reply.length} chars`);
    console.log(`\n    ${reply.slice(0, 220).replace(/\n/g, '\n    ')}…\n`);
  } catch (err) {
    if (err instanceof AiBlockedError) {
      check(
        'a graphic horror request is answered, not blocked',
        false,
        `blocked (${err.reason}) — safety thresholds are not permissive enough`,
      );
    } else {
      check('a graphic horror request is answered, not blocked', false, String(err));
    }
  }

  /* ---------------------- a refusal is its own outcome ---------------------- */

  section('A refusal renders as its own state, never a 500');
  check(
    'AiBlockedError carries a user-facing sentence',
    new AiBlockedError('SAFETY').message === "I can't discuss that title.",
  );
  check('AiBlockedError keeps the machine reason', new AiBlockedError('SAFETY').reason === 'SAFETY');

  console.log(
    `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m` +
      '\n(token counts and latency are the `ai <provider> …` lines above)\n',
  );
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error('verify:ai crashed:', err);
  process.exit(1);
});
