import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CF_PARAMS } from '../../types/cf';
import { capInfluence, confidence, predict, rankScore } from './predict';

/**
 * Hand-computed like the similarity tests, and for the same reason: a wrong
 * prediction ranks the wrong things and never throws.
 */

describe('predict — §8', () => {
  it('adds the similarity-weighted deviation to the user mean', () => {
    // mean_u = 3. Three neighbours, all sim 1, deviations +1, +1, +1.
    // pred = 3 + (1·1 + 1·1 + 1·1) / 3 = 4
    const out = predict(3, [
      { sim: 1, value: 5, mean: 4 },
      { sim: 1, value: 4, mean: 3 },
      { sim: 1, value: 3, mean: 2 },
    ]);
    assert.equal(round(out.pred), 4);
    assert.equal(out.support, 3);
  });

  it('centres on each neighbour’s own mean, not the raw score', () => {
    // A generous rater giving 4 when they average 4.5 is a NEGATIVE signal.
    // Raw-average would predict 4 (looks good); deviation predicts below mean.
    const out = predict(3, [
      { sim: 1, value: 4, mean: 4.5 },
      { sim: 1, value: 4, mean: 4.5 },
      { sim: 1, value: 4, mean: 4.5 },
    ]);
    assert.ok(out.pred < 3, `expected below the user mean, got ${out.pred}`);
  });

  it('weights a closer neighbour more heavily', () => {
    const close = predict(3, [
      { sim: 0.9, value: 5, mean: 3 },
      { sim: 0.1, value: 1, mean: 3 },
      { sim: 0.1, value: 1, mean: 3 },
    ]);
    const far = predict(3, [
      { sim: 0.1, value: 5, mean: 3 },
      { sim: 0.9, value: 1, mean: 3 },
      { sim: 0.9, value: 1, mean: 3 },
    ]);
    assert.ok(close.pred > far.pred);
  });

  it('refuses to predict below the neighbour floor, with zero confidence', () => {
    const out = predict(3.4, [
      { sim: 0.9, value: 5, mean: 3 },
      { sim: 0.9, value: 5, mean: 3 },
    ]);
    assert.equal(out.pred, 3.4, 'falls back to the user mean');
    assert.equal(out.conf, 0, 'and must not be rankable above real predictions');
    assert.ok(out.support < CF_PARAMS.minNeighborsPerItem);
  });

  it('clamps to the rating scale', () => {
    const high = predict(4.8, [
      { sim: 1, value: 5, mean: 1 },
      { sim: 1, value: 5, mean: 1 },
      { sim: 1, value: 5, mean: 1 },
    ]);
    const low = predict(1.2, [
      { sim: 1, value: 1, mean: 5 },
      { sim: 1, value: 1, mean: 5 },
      { sim: 1, value: 1, mean: 5 },
    ]);
    assert.ok(high.pred <= 5, `over scale: ${high.pred}`);
    assert.ok(low.pred >= 0.5, `under scale: ${low.pred}`);
  });

  it('never returns NaN when similarities cancel', () => {
    const out = predict(3, [
      { sim: 0.5, value: 5, mean: 3 },
      { sim: -0.5, value: 1, mean: 3 },
      { sim: 0.5, value: 4, mean: 3 },
    ]);
    assert.ok(Number.isFinite(out.pred));
  });
});

describe('confidence — the reason ranking is not just pred', () => {
  it('rises with similarity mass', () => {
    assert.ok(confidence(10) > confidence(1));
  });

  it('is zero with no agreement and never reaches 1', () => {
    assert.equal(confidence(0), 0);
    assert.ok(confidence(1000) < 1);
  });

  it('makes 20 weak neighbours outrank 3 strong-but-thin ones', () => {
    // The comparison §8 exists to get right.
    const thin = rankScore(4.6, confidence(3 * 0.2), 100);
    const thick = rankScore(4.3, confidence(20 * 0.35), 100);
    assert.ok(thick > thin, `thin ${thin} should not beat thick ${thick}`);
  });
});

describe('rankScore — popularity is a tiebreaker, not a ranker', () => {
  it('cannot let a popular item beat a much better prediction', () => {
    const greatObscure = rankScore(4.8, 0.8, 3);
    const mediocreFamous = rankScore(3.0, 0.8, 100000);
    assert.ok(greatObscure > mediocreFamous, 'popularity term is dominating — feed has collapsed to trending');
  });

  it('breaks a genuine tie toward the better-known title', () => {
    const known = rankScore(4.0, 0.7, 5000);
    const unknown = rankScore(4.0, 0.7, 2);
    assert.ok(known > unknown);
  });
});

describe('capInfluence — §7', () => {
  it('stops one neighbour dominating a large neighbourhood', () => {
    const many = Array.from({ length: 20 }, () => ({ sim: 0.1, value: 4, mean: 3 }));
    many.push({ sim: 5, value: 1, mean: 3 }); // the hyperactive outlier
    const capped = capInfluence(many);
    const outlier = capped[capped.length - 1];
    assert.ok(outlier.sim < 5, 'outlier was not capped');
  });

  it('leaves a small neighbourhood alone — an 8% ceiling would zero it', () => {
    const few = [
      { sim: 0.9, value: 5, mean: 3 },
      { sim: 0.5, value: 4, mean: 3 },
      { sim: 0.4, value: 4, mean: 3 },
    ];
    assert.deepEqual(capInfluence(few), few);
  });
});

function round(n: number, dp = 6): number {
  return Number(n.toFixed(dp));
}
