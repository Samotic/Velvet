import { CF_PARAMS, type ItemKey, type RatingSource } from '../../types/cf';

/**
 * User-user similarity: Pearson correlation over co-rated items, weighted by
 * inverse user frequency, then shrunk by co-rating overlap.
 *
 * ── Read this before changing anything below ──
 * Every later stage — neighbours, predictions, the whole feed — is a function
 * of this number. A wrong formula here does not throw; it produces a feed that
 * looks plausible and is worthless. `similarity.test.ts` hand-computes the
 * expected values from small matrices for exactly that reason, and was written
 * first.
 *
 * The matrix is never split by media type. A neighbour found through a game
 * surfacing a film is the point of Velvet's rating space, not a leak.
 */

export interface RatingRow {
  itemKey: ItemKey;
  value: number;
  source: RatingSource;
}

export interface SimilarityResult {
  /** Significance-weighted, floored. What ranking should use. */
  sim: number;
  /** Pre-shrink correlation, for the evaluation harness. */
  rawSim: number;
  /** |I_uv| */
  coRated: number;
}

export interface PearsonOptions {
  /** itemKey → log(N / raterCount). Missing entries default to 1 (neutral). */
  iuf?: Map<ItemKey, number>;
}

const weightFor = (source: RatingSource): number =>
  source === 'implicit' ? CF_PARAMS.implicitWeight : CF_PARAMS.explicitWeight;

/**
 * Pearson correlation over the intersection of two rows.
 *
 * Two details that are easy to get wrong and both matter:
 *
 *  - **The means are taken over the overlap**, not over each user's whole row.
 *    Centring on a mean that includes items the other user never rated biases
 *    every deviation in the sum.
 *  - **Weights multiply each term**, not each rating. Halving a rating changes
 *    the correlation's shape; halving a term's contribution changes only how
 *    much that item counts, which is what §4 and §6 step 2 actually ask for.
 */
export function pearson(
  a: RatingRow[],
  b: RatingRow[],
  opts: PearsonOptions = {},
): SimilarityResult {
  const bByKey = new Map<ItemKey, RatingRow>();
  for (const r of b) bByKey.set(r.itemKey, r);

  const pairs: Array<{ au: number; bv: number; w: number }> = [];
  for (const ra of a) {
    const rb = bByKey.get(ra.itemKey);
    if (!rb) continue;

    // Rare agreement is informative; agreeing on what everyone rates is not.
    // A missing IUF entry means "unknown", which should be neutral (1) rather
    // than silently zeroing the item out of the calculation.
    const iuf = opts.iuf?.get(ra.itemKey) ?? 1;
    pairs.push({ au: ra.value, bv: rb.value, w: iuf * weightFor(ra.source) * weightFor(rb.source) });
  }

  const coRated = pairs.length;
  if (coRated < 2) return { sim: 0, rawSim: 0, coRated };

  // Weighted means over the overlap. If every weight is zero — which happens
  // when the only shared items are universally-rated ones with iuf 0 — there is
  // no information here at all.
  const totalW = pairs.reduce((s, p) => s + p.w, 0);
  if (totalW <= 0) return { sim: 0, rawSim: 0, coRated };

  const meanA = pairs.reduce((s, p) => s + p.w * p.au, 0) / totalW;
  const meanB = pairs.reduce((s, p) => s + p.w * p.bv, 0) / totalW;

  let num = 0;
  let devA = 0;
  let devB = 0;
  for (const p of pairs) {
    const da = p.au - meanA;
    const db = p.bv - meanB;
    num += p.w * da * db;
    devA += p.w * da * da;
    devB += p.w * db * db;
  }

  // A constant row has zero variance and an undefined correlation. Returning 0
  // rather than NaN keeps the undefined case out of every downstream sum.
  if (devA <= 0 || devB <= 0) return { sim: 0, rawSim: 0, coRated };

  const raw = num / Math.sqrt(devA * devB);
  if (!Number.isFinite(raw)) return { sim: 0, rawSim: 0, coRated };

  // Floating-point error can push a perfect correlation a hair outside [-1,1].
  const clamped = Math.max(-1, Math.min(1, raw));
  return { sim: clamped, rawSim: clamped, coRated };
}

/**
 * §6 step 3 — significance weighting.
 *
 * The single most important line in the system. A correlation of 0.98 computed
 * from 2 co-rated items is noise; 0.5 from 40 is signal. This shrinks toward
 * zero when the evidence is thin, so the second outranks the first.
 *
 * Never remove it. With a small user base almost every raw correlation is
 * near ±1 on 2-3 items, and without the shrink the neighbourhood fills with
 * strangers who happened to agree twice.
 */
export function significanceWeight(rawSim: number, coRated: number, beta: number): number {
  return rawSim * (Math.min(coRated, beta) / beta);
}

/**
 * The composed pipeline: correlate, shrink, then apply §6 step 4's floors.
 *
 * Returns `sim: 0` for a rejected pair rather than null, so callers can sum
 * without branching — a zero contributes nothing to a weighted average.
 */
export function similarity(
  a: RatingRow[],
  b: RatingRow[],
  opts: PearsonOptions = {},
): SimilarityResult {
  const base = pearson(a, b, opts);
  if (base.coRated < CF_PARAMS.minCoRated) {
    return { sim: 0, rawSim: base.rawSim, coRated: base.coRated };
  }

  const shrunk = significanceWeight(base.rawSim, base.coRated, CF_PARAMS.beta);
  if (shrunk <= CF_PARAMS.minSim) {
    return { sim: 0, rawSim: base.rawSim, coRated: base.coRated };
  }

  return { sim: shrunk, rawSim: base.rawSim, coRated: base.coRated };
}
