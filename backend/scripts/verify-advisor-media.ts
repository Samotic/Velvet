/**
 * Advisor artwork: resolved from the catalogue, capped, never invented.
 *
 *   cd backend && npm run verify:media
 *
 * `testEnv` blanks the TMDB keys, so the real client cannot reach the network —
 * the catalogue module is stubbed here instead. That is the point: these assert
 * the resolution and capping logic, and a test that depended on TMDB being up
 * would fail for reasons that have nothing to do with the code.
 *
 * No model call is involved anywhere in this file, which is the property the
 * feature rests on: the poster is a field of a search the reply already makes.
 */
// Keep first: no real integration keys, email sends, or deployment database.
import './testEnv';

import Module from 'node:module';

import type { CatalogSummary } from '../src/services/catalogTypes';

let pass = 0;
let fail = 0;

const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (s: string) => console.log(`\n${s}`);

/** Every title the fake catalogue knows about, and what it answers with. */
const CATALOGUE: Record<string, CatalogSummary[]> = {};
/** Counts calls, so "no extra lookups" is asserted rather than assumed. */
let searchCalls = 0;

const item = (id: string, title: string, posterUrl: string | null): CatalogSummary => ({
  id,
  type: 'movie',
  title,
  year: '2024',
  posterUrl,
  score: null,
  overview: '',
  genres: [],
});

/**
 * Replaces the tmdb module before the controller imports it.
 *
 * `_load` rather than a DI seam because the controller reaches for
 * `../services/tmdb` directly, and adding an injection point to production code
 * for the sake of one test is a worse trade than this four-line hook.
 */
const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function patched(
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request.endsWith('services/tmdb')) {
    return {
      search: async (q: string) => {
        searchCalls += 1;
        return CATALOGUE[q.toLowerCase()] ?? [];
      },
    };
  }
  return (load as (...a: unknown[]) => unknown).call(this, request, ...rest);
} as unknown as typeof load;

async function run(): Promise<void> {
  // Imported after the hook is installed, so it picks up the stub.
  const { __testing } = (await import('../src/controllers/aiController.js')) as unknown as {
    __testing: { linkTitles: (t: string) => Promise<{ text: string; media: unknown[] }> };
  };
  const linkTitles = __testing.linkTitles;

  /* --- 1. a resolvable title returns artwork -------------------------- */

  section('A resolvable title returns artwork');
  {
    CATALOGUE.dune = [item('438631', 'Dune', 'https://image.tmdb.org/t/p/w500/dune.jpg')];

    const { text, media } = await linkTitles('You would like [[Dune]].');
    check('one poster came back', media.length === 1, String(media.length));

    const art = media[0] as Record<string, unknown>;
    check('it is the catalogue URL, verbatim', art.url === 'https://image.tmdb.org/t/p/w500/dune.jpg');
    check('it carries the resolved pair', art.contentId === '438631' && art.contentType === 'movie');
    check('it is marked a poster', art.kind === 'poster');
    check('it carries a ratio for the reserved box', typeof art.aspect === 'number' && (art.aspect as number) > 0);
    check('and the marker was still linked', text.includes('[[Dune|movie|438631]]'));
  }

  /* --- 2. an unresolvable title returns text only ---------------------- */

  section('An unresolvable title returns text only');
  {
    const { text, media } = await linkTitles('Try [[A Film That Does Not Exist]].');
    check('no artwork', media.length === 0, String(media.length));
    check('the marker is left bare rather than guessed at', text.includes('[[A Film That Does Not Exist]]'));
    check('and no URL was invented', !text.includes('http'));
  }

  section('A title that resolves but has no poster contributes nothing');
  {
    CATALOGUE.posterless = [item('1', 'Posterless', null)];
    const { text, media } = await linkTitles('See [[Posterless]].');
    check('no artwork', media.length === 0, String(media.length));
    check('but the link still resolves', text.includes('[[Posterless|movie|1]]'));
  }

  /* --- 3. the cap ------------------------------------------------------ */

  section('The three-image cap holds');
  {
    for (const n of ['one', 'two', 'three', 'four', 'five']) {
      CATALOGUE[n] = [item(`id-${n}`, n, `https://image.tmdb.org/t/p/w500/${n}.jpg`)];
    }

    const { media } = await linkTitles('[[one]] [[two]] [[three]] [[four]] [[five]]');
    check('five titles yield three posters', media.length === 3, String(media.length));

    const urls = (media as Record<string, unknown>[]).map((m) => m.url);
    check(
      'and they are the first three in reading order',
      Boolean(
        urls[0]?.toString().includes('one') &&
          urls[1]?.toString().includes('two') &&
          urls[2]?.toString().includes('three'),
      ),
      JSON.stringify(urls),
    );
  }

  /* --- 4. dedupe on the resolved pair ---------------------------------- */

  section('Two names for one film are one poster');
  {
    CATALOGUE['blade runner'] = [item('78', 'Blade Runner', 'https://image.tmdb.org/t/p/w500/br.jpg')];
    CATALOGUE['bladerunner'] = [item('78', 'Blade Runner', 'https://image.tmdb.org/t/p/w500/br.jpg')];

    const { media } = await linkTitles('[[Blade Runner]] and [[BladeRunner]]');
    check('deduped on (type, id), not on the title string', media.length === 1, String(media.length));
  }

  /* --- 5. no extra lookups --------------------------------------------- */

  section('Artwork costs no extra catalogue call');
  {
    searchCalls = 0;
    await linkTitles('[[one]] [[two]]');
    check('two distinct titles, two searches', searchCalls === 2, String(searchCalls));

    searchCalls = 0;
    await linkTitles('[[one]] again and [[one]] once more');
    check('a repeated title is searched once', searchCalls === 1, String(searchCalls));
  }

  console.log(`\n${'─'.repeat(52)}\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run().catch((err) => {
  console.error('verify failed:', err);
  process.exit(1);
});
