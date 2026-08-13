/**
 * Offline evaluation — §15.
 *
 *   cd backend && npx tsx scripts/evaluateCF.ts
 *
 * Do not tune K, beta or lambda by intuition. Every one of them trades
 * coverage against accuracy, and the direction is not guessable — a larger
 * neighbourhood predicts more items and predicts them worse.
 *
 * ── The baseline is the whole point ──
 * Predicting `mean_u` for everything is a recommender that has learned
 * nothing. If CF's RMSE does not beat it, the CF is decorative, regardless of
 * how sophisticated the code looks. That comparison is reported first because
 * it is the only one that can invalidate the rest.
 *
 * Holdout is 20% per user, users with >= 10 ratings only — below that a
 * holdout of two items measures noise.
 */
import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

import { connectDb, disconnectDb } from '../src/lib/db';
import { env } from '../src/config/env';
import { loadIufMap } from '../src/lib/cf/popularity';
import { capInfluence, predict, rankScore } from '../src/lib/cf/predict';
import { similarity, type RatingRow } from '../src/lib/cf/similarity';
import { ItemPopularity } from '../src/models/ItemPopularity';
import { Rating } from '../src/models/Rating';
import { CF_PARAMS, itemKey, type ItemKey } from '../src/types/cf';

const HOLDOUT = 0.2;
const MIN_RATINGS = 10;

interface Row {
  itemKey: ItemKey;
  value: number;
  source: 'explicit' | 'implicit';
}

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  await connectDb(env.mongoUri);

  const all = await Rating.find({}).select('userId contentId contentType rating source').lean();

  const byUser = new Map<string, Row[]>();
  for (const r of all) {
    const uid = String(r.userId);
    const row = byUser.get(uid) ?? [];
    row.push({
      itemKey: itemKey(r.contentType, r.contentId),
      value: r.rating,
      source: r.source ?? 'explicit',
    });
    byUser.set(uid, row);
  }

  const eligible = [...byUser.entries()].filter(([, rows]) => rows.length >= MIN_RATINGS);

  if (!eligible.length) {
    console.log(
      `No users with >= ${MIN_RATINGS} ratings — nothing to evaluate.\n` +
        'Run scripts/seedSyntheticMatrix.ts to generate a fixture, or wait for real data.',
    );
    await disconnectDb();
    return;
  }

  // Split first, then build the training matrix from what's left. Computing
  // similarity over the full rows would leak the holdout into the model and
  // make every metric optimistic.
  const train = new Map<string, Row[]>();
  const test = new Map<string, Row[]>();

  for (const [uid, rows] of eligible) {
    const shuffled = [...rows].sort((a, b) => a.itemKey.localeCompare(b.itemKey));
    const cut = Math.max(1, Math.floor(rows.length * HOLDOUT));
    test.set(uid, shuffled.slice(0, cut));
    train.set(uid, shuffled.slice(cut));
  }
  // Users below the threshold still contribute their full rows as neighbours.
  for (const [uid, rows] of byUser) if (!train.has(uid)) train.set(uid, rows);

  const iuf = await loadIufMap();
  const means = new Map<string, number>();
  for (const [uid, rows] of train) {
    means.set(uid, rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 3);
  }

  const popRows = await ItemPopularity.find({}).select('itemKey raterCount').lean();
  const raterCount = new Map(popRows.map((p) => [p.itemKey, p.raterCount]));

  // Neighbourhoods from the training matrix only.
  const index = new Map<ItemKey, string[]>();
  for (const [uid, rows] of train) {
    for (const r of rows) {
      const list = index.get(r.itemKey) ?? [];
      list.push(uid);
      index.set(r.itemKey, list);
    }
  }

  const neighborsOf = new Map<string, Array<{ uid: string; sim: number }>>();
  for (const [uid, rows] of train) {
    const shared = new Map<string, number>();
    for (const r of rows) {
      for (const other of index.get(r.itemKey) ?? []) {
        if (other !== uid) shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    const found: Array<{ uid: string; sim: number }> = [];
    for (const [other, n] of shared) {
      if (n < CF_PARAMS.minCoRated) continue;
      const s = similarity(rows, train.get(other) as RatingRow[], { iuf });
      if (s.sim > 0) found.push({ uid: other, sim: s.sim });
    }
    neighborsOf.set(uid, found.sort((a, b) => b.sim - a.sim).slice(0, CF_PARAMS.K));
  }

  // Fast lookup: what did user X rate item I.
  const valueOf = new Map<string, Map<ItemKey, number>>();
  for (const [uid, rows] of train) {
    valueOf.set(uid, new Map(rows.map((r) => [r.itemKey, r.value])));
  }

  let sqErr = 0;
  let absErr = 0;
  let baseSqErr = 0;
  let baseAbsErr = 0;
  let predicted = 0;
  let coveredUsers = 0;

  let hits = 0;
  let recommendations = 0;
  const cataloguedItems = new Set<ItemKey>();
  const allItems = new Set<ItemKey>(index.keys());

  for (const [uid, held] of test) {
    const mean = means.get(uid) ?? 3;
    const neigh = neighborsOf.get(uid) ?? [];

    let userPredicted = 0;

    for (const h of held) {
      const raters = neigh
        .map((n) => {
          const v = valueOf.get(n.uid)?.get(h.itemKey);
          return v === undefined ? null : { sim: n.sim, value: v, mean: means.get(n.uid) ?? 3 };
        })
        .filter((x): x is { sim: number; value: number; mean: number } => x !== null);

      // The baseline predicts mean_u for everything, always — so it is scored
      // on every held-out item, including the ones CF declined to predict.
      baseSqErr += (h.value - mean) ** 2;
      baseAbsErr += Math.abs(h.value - mean);

      if (raters.length < CF_PARAMS.minNeighborsPerItem) continue;

      const { pred, conf } = predict(mean, capInfluence(raters));
      if (conf <= 0) continue;

      sqErr += (h.value - pred) ** 2;
      absErr += Math.abs(h.value - pred);
      predicted += 1;
      userPredicted += 1;
    }

    if (userPredicted >= 1) coveredUsers += 1;

    // Precision@10 over items this user actually held out, ranked by CF.
    const ranked = held
      .map((h) => {
        const raters = neigh
          .map((n) => {
            const v = valueOf.get(n.uid)?.get(h.itemKey);
            return v === undefined ? null : { sim: n.sim, value: v, mean: means.get(n.uid) ?? 3 };
          })
          .filter((x): x is { sim: number; value: number; mean: number } => x !== null);
        if (raters.length < CF_PARAMS.minNeighborsPerItem) return null;
        const { pred, conf } = predict(mean, capInfluence(raters));
        return { key: h.itemKey, actual: h.value, score: rankScore(pred, conf, raterCount.get(h.itemKey) ?? 0) };
      })
      .filter((x): x is { key: ItemKey; actual: number; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    for (const r of ranked) {
      recommendations += 1;
      cataloguedItems.add(r.key);
      if (r.actual >= 4) hits += 1;
    }
  }

  const rmse = predicted ? Math.sqrt(sqErr / predicted) : NaN;
  const mae = predicted ? absErr / predicted : NaN;
  const heldTotal = [...test.values()].reduce((s, r) => s + r.length, 0);
  const baseRmse = heldTotal ? Math.sqrt(baseSqErr / heldTotal) : NaN;
  const baseMae = heldTotal ? baseAbsErr / heldTotal : NaN;

  const pad = (s: string) => s.padEnd(26);
  console.log(`\nparams  K=${CF_PARAMS.K}  beta=${CF_PARAMS.beta}  lambda=${CF_PARAMS.lambda}  minSim=${CF_PARAMS.minSim}\n`);
  console.log(`${pad('users evaluated')}${eligible.length}`);
  console.log(`${pad('held-out ratings')}${heldTotal}`);
  console.log(`${pad('CF predicted')}${predicted}  (${pct(predicted, heldTotal)})`);
  console.log('');
  console.log(`${pad('RMSE  (CF)')}${fmt(rmse)}`);
  console.log(`${pad('RMSE  (mean_u baseline)')}${fmt(baseRmse)}`);
  console.log(`${pad('MAE   (CF)')}${fmt(mae)}`);
  console.log(`${pad('MAE   (mean_u baseline)')}${fmt(baseMae)}`);

  const beats = Number.isFinite(rmse) && rmse < baseRmse;
  console.log(
    `\n  => CF ${beats ? 'BEATS' : 'DOES NOT BEAT'} the baseline` +
      (beats ? '' : '  <-- the CF is doing nothing; do not ship this'),
  );

  console.log('');
  console.log(`${pad('Precision@10')}${fmt(recommendations ? hits / recommendations : NaN)}`);
  console.log(`${pad('user coverage')}${pct(coveredUsers, eligible.length)}  (target >= 60%)`);
  console.log(
    `${pad('catalogue coverage')}${pct(cataloguedItems.size, allItems.size)}  (target > 10%)`,
  );

  if (allItems.size && cataloguedItems.size / allItems.size < 0.1) {
    console.log(
      '\n  Catalogue coverage under 10%: the popularity term in rankScore is too ' +
        `strong (currently ${CF_PARAMS.popularityWeight}). The feed is collapsing back into trending.`,
    );
  }

  await disconnectDb();
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : 'n/a');
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');

main().catch(async (err) => {
  console.error('evaluateCF failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
