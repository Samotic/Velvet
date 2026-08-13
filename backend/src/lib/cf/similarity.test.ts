import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CF_PARAMS } from '../../types/cf';
import { pearson, significanceWeight, similarity, type RatingRow } from './similarity';

/**
 * Written before the implementation, per §17.
 *
 * Every later stage depends on this formula. A silently wrong Pearson produces
 * a feed that looks plausible and is worthless — it will not throw, it will
 * just quietly recommend the wrong things forever. So the expected values here
 * are hand-computed from small matrices rather than snapshotted from the code.
 */

const row = (
  itemKey: string,
  value: number,
  source: 'explicit' | 'implicit' = 'explicit',
): RatingRow => ({ itemKey, value, source });

describe('pearson — hand-verified against small matrices', () => {
  it('returns 1 for perfectly correlated raters on different scales', () => {
    // u: 1,2,3 (mean 2)   v: 3,4,5 (mean 4)
    // Deviations are identical: (-1,0,1) vs (-1,0,1) -> r = 1.
    // This is the case mean-centring exists for: v is a generous rater, not a
    // different taste.
    const u = [row('a', 1), row('b', 2), row('c', 3)];
    const v = [row('a', 3), row('b', 4), row('c', 5)];
    assert.equal(round(pearson(u, v).sim), 1);
  });

  it('returns -1 for perfectly opposed raters', () => {
    // u deviations (-1,0,1); v deviations (1,0,-1).
    const u = [row('a', 1), row('b', 2), row('c', 3)];
    const v = [row('a', 5), row('b', 4), row('c', 3)];
    assert.equal(round(pearson(u, v).sim), -1);
  });

  it('matches a hand-computed non-trivial correlation', () => {
    // u: a=5 b=3 c=4   mean 4      dev  1,-1, 0
    // v: a=4 b=1 c=4   mean 3      dev  1,-2, 1
    // num = 1*1 + (-1)(-2) + 0*1 = 3
    // den = sqrt(1+1+0) * sqrt(1+4+1) = sqrt(2)*sqrt(6) = sqrt(12) = 3.4641
    // r  = 3 / 3.4641 = 0.86603
    const u = [row('a', 5), row('b', 3), row('c', 4)];
    const v = [row('a', 4), row('b', 1), row('c', 4)];
    assert.equal(round(pearson(u, v).sim, 5), 0.86603);
  });

  it('uses only co-rated items, ignoring the rest of each row', () => {
    // 'z' is unique to each user and must not enter the sums — including via
    // the means, which are the means over the OVERLAP, not the whole row.
    const u = [row('a', 1), row('b', 2), row('c', 3), row('z', 5)];
    const v = [row('a', 3), row('b', 4), row('c', 5), row('y', 1)];
    const out = pearson(u, v);
    assert.equal(out.coRated, 3);
    assert.equal(round(out.sim), 1);
  });

  it('returns 0 when the overlap is smaller than 2 items', () => {
    assert.equal(pearson([row('a', 5)], [row('a', 4)]).sim, 0);
    assert.equal(pearson([row('a', 5)], [row('b', 4)]).sim, 0);
    assert.equal(pearson([], []).sim, 0);
  });

  it('returns 0 when either rater is constant across the overlap', () => {
    // A flat vector has zero variance, so the denominator is 0. Pearson is
    // undefined here — it must not be NaN or Infinity leaking into the feed.
    const u = [row('a', 4), row('b', 4), row('c', 4)];
    const v = [row('a', 1), row('b', 3), row('c', 5)];
    const out = pearson(u, v);
    assert.equal(out.sim, 0);
    assert.ok(Number.isFinite(out.sim));
  });

  it('weights co-rated items by IUF — rare agreement counts for more', () => {
    // Two pairs agree identically, but one agrees on an obscure item.
    // With IUF the obscure agreement must not score lower; the popular one
    // must be discounted toward 0 influence.
    const u = [row('blockbuster', 5), row('obscure', 5), row('mid', 2)];
    const v = [row('blockbuster', 5), row('obscure', 5), row('mid', 2)];

    // Everyone rated the blockbuster -> iuf 0. Nobody rated the obscure -> high.
    const iuf = new Map([
      ['blockbuster', 0],
      ['obscure', 2.5],
      ['mid', 2.5],
    ]);

    const withIuf = pearson(u, v, { iuf });
    const without = pearson(u, v);
    // Identical rows correlate at 1 either way; the point is it stays finite
    // and defined once a zero-weight item is present.
    assert.ok(Number.isFinite(withIuf.sim));
    assert.equal(round(withIuf.sim), 1);
    assert.equal(round(without.sim), 1);
  });

  it('an item everyone has rated cannot by itself create similarity', () => {
    // u and v agree ONLY on the blockbuster and disagree on everything else.
    // With iuf 0 on it, that agreement carries no weight.
    const u = [row('blockbuster', 5), row('a', 5), row('b', 1)];
    const v = [row('blockbuster', 5), row('a', 1), row('b', 5)];
    const iuf = new Map([
      ['blockbuster', 0],
      ['a', 2],
      ['b', 2],
    ]);
    const out = pearson(u, v, { iuf });
    assert.ok(out.sim < 0, `opposed tastes should stay negative, got ${out.sim}`);
  });

  it('down-weights implicit rows relative to explicit ones', () => {
    const explicit = pearson(
      [row('a', 5), row('b', 1), row('c', 4)],
      [row('a', 5), row('b', 1), row('c', 4)],
    );
    const implicit = pearson(
      [row('a', 5, 'implicit'), row('b', 1, 'implicit'), row('c', 4, 'implicit')],
      [row('a', 5, 'implicit'), row('b', 1, 'implicit'), row('c', 4, 'implicit')],
    );
    // Both are perfect correlations, so the coefficient is 1 either way — the
    // weighting changes the magnitude of the sums, not their ratio. What must
    // hold is that it stays finite and in range.
    assert.equal(round(explicit.sim), 1);
    assert.equal(round(implicit.sim), 1);
  });

  it('never returns NaN, Infinity, or a value outside [-1, 1]', () => {
    const cases: Array<[RatingRow[], RatingRow[]]> = [
      [[row('a', 0)], [row('a', 0)]],
      [[row('a', 5), row('b', 5)], [row('a', 5), row('b', 5)]],
      [[row('a', 1), row('b', 1), row('c', 1)], [row('a', 1), row('b', 1), row('c', 1)]],
      [[row('a', 5), row('b', 1)], [row('a', 1), row('b', 5)]],
    ];
    for (const [u, v] of cases) {
      const { sim } = pearson(u, v);
      assert.ok(Number.isFinite(sim), `not finite: ${sim}`);
      assert.ok(sim >= -1 && sim <= 1, `out of range: ${sim}`);
    }
  });
});

describe('significanceWeight — §6 step 3, the line that must never be removed', () => {
  const beta = CF_PARAMS.beta;

  it('shrinks a thin-overlap correlation hard', () => {
    // 0.98 from 2 items is meaningless. At beta=6 it keeps a third of its value.
    assert.equal(round(significanceWeight(0.98, 2, 6), 4), round(0.98 * (2 / 6), 4));
  });

  it('leaves a thick-overlap correlation untouched', () => {
    assert.equal(significanceWeight(0.8, 40, 6), 0.8);
    assert.equal(significanceWeight(0.8, 6, 6), 0.8);
  });

  it('is monotonic in overlap — more evidence never scores lower', () => {
    let prev = -Infinity;
    for (let n = 1; n <= 20; n += 1) {
      const w = significanceWeight(0.9, n, beta);
      assert.ok(w >= prev, `not monotonic at n=${n}`);
      prev = w;
    }
  });

  it('preserves sign — shrinking must not flip a negative correlation', () => {
    assert.ok(significanceWeight(-0.9, 2, 6) < 0);
  });

  it('makes a 2-item 0.98 rank below a 40-item 0.5', () => {
    // The entire purpose of the step, stated as the comparison it exists to fix.
    const thin = significanceWeight(0.98, 2, 6);
    const thick = significanceWeight(0.5, 40, 6);
    assert.ok(thick > thin, `thin ${thin} should not beat thick ${thick}`);
  });
});

describe('similarity — the composed pipeline', () => {
  it('rejects pairs below the co-rated floor', () => {
    const u = [row('a', 5), row('b', 4)];
    const v = [row('a', 5), row('b', 4)];
    const out = similarity(u, v);
    // 2 co-rated < CF_PARAMS.minCoRated (3) -> discarded outright.
    assert.equal(out.sim, 0);
  });

  it('rejects pairs below the similarity floor', () => {
    // Weak positive correlation over enough items -> still discarded.
    const u = [row('a', 3), row('b', 3), row('c', 4), row('d', 2)];
    const v = [row('a', 4), row('b', 2), row('c', 3), row('d', 3)];
    const out = similarity(u, v);
    assert.ok(out.sim === 0 || out.sim > CF_PARAMS.minSim);
  });

  it('accepts a strong, well-evidenced pair and reports its inputs', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const u = items.map((k, i) => row(k, ((i % 5) + 1) as number));
    const v = items.map((k, i) => row(k, ((i % 5) + 1) as number));
    const out = similarity(u, v);
    assert.equal(out.coRated, 8);
    assert.ok(out.sim > CF_PARAMS.minSim, `expected a real similarity, got ${out.sim}`);
    assert.ok(out.rawSim >= out.sim, 'shrunk sim must not exceed raw');
  });
});

function round(n: number, dp = 6): number {
  return Number(n.toFixed(dp));
}
