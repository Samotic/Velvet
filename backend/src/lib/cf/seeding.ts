import { ItemPopularity } from '../../models/ItemPopularity';
import { getTopRatedGames } from '../../services/igdb';
import { getTopRated } from '../../services/tmdb';
import type { ContentType } from '../../models/User';

/**
 * The cold-start grid.
 *
 * ── The rule that makes this work ──
 * §12 is specific: select by `raterCount` from `itemPopularity`, **not** by
 * TMDB popularity. Seeding exists to maximise overlap with users who already
 * exist, and overlap is exactly what Pearson is computed from. A globally
 * famous film that nobody on Velvet has rated contributes nothing to a single
 * similarity — it is a wasted slot on the only screen where the user is
 * willing to rate twenty things in a row.
 *
 * ── But Velvet has no ratings yet ──
 * On an empty matrix that rule selects nothing, and a picker with an empty
 * grid seeds nobody. So the catalogue is the fallback, and only the fallback:
 * as soon as real ratings exist they take precedence, and the grid converges
 * on the overlap-maximising set the spec asks for. This is the bootstrap
 * problem stated honestly rather than papered over.
 */

export interface SeedItem {
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
  /** How many Velvet users have rated it. 0 for catalogue fallbacks. */
  raterCount: number;
}

/** 5×4 — the grid §12 specifies. */
export const SEED_GRID_SIZE = 20;

/**
 * Builds the grid, ordered deterministically for this user.
 *
 * Determinism matters more than it sounds: §12 requires a refresh not to
 * reshuffle. A grid that reorders under a reload makes the user lose their
 * place mid-way through rating twenty things, and they abandon the flow.
 */
export async function buildSeedGrid(
  userId: string,
  opts: { size?: number } = {},
): Promise<SeedItem[]> {
  const size = opts.size ?? SEED_GRID_SIZE;

  // Preferred source: what Velvet users have actually rated.
  const rated = await ItemPopularity.find({ raterCount: { $gt: 0 } })
    .sort({ raterCount: -1 })
    .limit(size * 2)
    .lean();

  const picks: SeedItem[] = rated.map((r) => ({
    contentId: r.contentId,
    contentType: r.contentType,
    title: r.title,
    poster: r.poster,
    raterCount: r.raterCount,
  }));

  if (picks.length < size) {
    // Bootstrap: not enough rated items to fill a grid yet.
    const filler = await catalogueFallback(size - picks.length, new Set(picks.map(keyOf)));
    picks.push(...filler);
  }

  return shuffleDeterministic(picks, userId).slice(0, size);
}

const keyOf = (i: SeedItem) => `${i.contentType}:${i.contentId}`;

/**
 * Well-known titles from the catalogue, used only until real ratings exist.
 *
 * Degrades honestly, like every other integration here: with no TMDB or IGDB
 * key configured this returns an empty list and the picker shows what it has,
 * rather than throwing on the first screen a new account ever sees.
 */
async function catalogueFallback(need: number, taken: Set<string>): Promise<SeedItem[]> {
  const out: SeedItem[] = [];

  const push = (contentId: string, contentType: ContentType, title: string, poster: string | null) => {
    const k = `${contentType}:${contentId}`;
    if (taken.has(k)) return;
    taken.add(k);
    out.push({ contentId, contentType, title, poster, raterCount: 0 });
  };

  // Top-rated rather than trending: a seeding grid wants titles a new user is
  // likely to have actually seen, not this week's releases.
  const wantFilms = Math.ceil(need * 0.45);
  const wantSeries = Math.ceil(need * 0.25);

  try {
    for (const f of (await getTopRated('movie')).slice(0, wantFilms)) {
      push(f.id, 'movie', f.title, f.posterUrl ?? null);
    }
  } catch {
    /* No TMDB key, or it's down. The grid is smaller; nothing breaks. */
  }

  try {
    for (const s of (await getTopRated('series')).slice(0, wantSeries)) {
      push(s.id, 'series', s.title, s.posterUrl ?? null);
    }
  } catch {
    /* Same contract. */
  }

  if (out.length < need) {
    try {
      // A cross-media grid is the point — a picker of twenty films can only
      // ever seed a film-shaped row vector, and the cross-media matrix is
      // exactly what Velvet has that Letterboxd does not.
      for (const g of (await getTopRatedGames()).slice(0, need - out.length)) {
        push(g.id, 'game', g.title, g.posterUrl ?? null);
      }
    } catch {
      /* Same contract as above. */
    }
  }

  return out;
}

/**
 * A stable shuffle keyed by user id.
 *
 * Every user sees a different order — so the grid isn't a monoculture where
 * everyone rates the same first five — but the *same* user sees the same order
 * on every reload.
 */
function shuffleDeterministic<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const out = [...items];
  // Fisher-Yates driven by a small xorshift, so the permutation is uniform
  // rather than the biased sort-by-random it would be otherwise.
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return Math.abs(h) / 2147483647;
  };

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
