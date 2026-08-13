import { CF_PARAMS } from '../../types/cf';

/**
 * Rating prediction and ranking — §8.
 *
 * The prediction is a deviation-weighted average: take the neighbours who
 * rated this item, measure how far each strayed from *their own* mean, weight
 * by similarity, and apply that to the target's mean.
 *
 * Predicting the raw average of neighbours' ratings instead is the classic
 * mistake. A neighbour who rates everything 4-5 and gave this a 4 is telling
 * you they were unimpressed; the deviation captures that, the raw score does
 * the opposite.
 */

export interface NeighborRating {
  /** Significance-weighted similarity to the target user. */
  sim: number;
  /** What this neighbour rated the item. */
  value: number;
  /** This neighbour's own mean, for centring. */
  mean: number;
}

export interface Prediction {
  pred: number;
  conf: number;
  /** |N(u,i)| — how many neighbours actually rated it. */
  support: number;
}

/**
 * pred(u,i) = mean_u + Σ sim·(r_vi − mean_v) / Σ|sim|
 *
 * Clamped to the rating scale: a strong neighbourhood of enthusiasts can push
 * the weighted deviation past 5, and a 5.4 prediction is both meaningless and
 * a ranking artefact that would float above everything real.
 */
export function predict(userMean: number, neighbors: NeighborRating[]): Prediction {
  const usable = neighbors.filter((n) => Number.isFinite(n.sim) && n.sim !== 0);

  if (usable.length < CF_PARAMS.minNeighborsPerItem) {
    // Not enough evidence. Returning the user's mean with zero confidence
    // keeps the item rankable but harmless — it cannot outrank a real
    // prediction, because rankScore multiplies by conf.
    return { pred: userMean, conf: 0, support: usable.length };
  }

  let num = 0;
  let den = 0;
  let simSum = 0;

  for (const n of usable) {
    num += n.sim * (n.value - n.mean);
    den += Math.abs(n.sim);
    simSum += Math.max(0, n.sim);
  }

  if (den <= 0) return { pred: userMean, conf: 0, support: usable.length };

  const raw = userMean + num / den;
  const pred = Math.max(0.5, Math.min(5, raw));

  return { pred, conf: confidence(simSum), support: usable.length };
}

/**
 * conf = Σsim / (Σsim + λ)
 *
 * Why ranking needs this: a 4.6 predicted from 3 weak neighbours should not
 * outrank a 4.3 from 20 strong ones. Confidence rises with the *mass* of
 * agreement, not the count, so twenty neighbours at 0.15 and three at 0.9 are
 * treated as comparably informative — which they are.
 */
export function confidence(simSum: number): number {
  if (simSum <= 0) return 0;
  return simSum / (simSum + CF_PARAMS.lambda);
}

/**
 * rankScore = pred·conf + 0.15·log10(raterCount + 1)
 *
 * The popularity term is a **weak tiebreaker only** — it breaks ties between
 * two items the neighbourhood likes equally, by preferring the one more people
 * have actually seen. If it starts dominating, the feed has collapsed back
 * into trending, which is the thing this whole system exists to replace.
 * §15's catalogue-coverage metric is what detects that: below 10%, this weight
 * is too high.
 */
export function rankScore(pred: number, conf: number, raterCount: number): number {
  return pred * conf + CF_PARAMS.popularityWeight * Math.log10(Math.max(0, raterCount) + 1);
}

/**
 * Caps any single neighbour's share of the similarity mass — §7.
 *
 * Without it, one hyperactive user who happens to correlate well becomes the
 * de facto recommender for everyone near them: they have rated everything, so
 * they are in N(u,i) for every item, and the feed becomes their profile.
 * Capping influence keeps a sparse neighbourhood plural.
 */
export function capInfluence(neighbors: NeighborRating[]): NeighborRating[] {
  const total = neighbors.reduce((s, n) => s + Math.abs(n.sim), 0);
  if (total <= 0) return neighbors;

  const ceiling = total * CF_PARAMS.maxNeighborInfluence;
  // Only meaningful once the neighbourhood is big enough for a cap to bind;
  // with 3 neighbours an 8% ceiling would zero all of them.
  if (neighbors.length < Math.ceil(1 / CF_PARAMS.maxNeighborInfluence)) return neighbors;

  return neighbors.map((n) =>
    Math.abs(n.sim) > ceiling ? { ...n, sim: Math.sign(n.sim) * ceiling } : n,
  );
}
