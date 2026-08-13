import { Types } from 'mongoose';

import { Rating } from '../../models/Rating';
import { UserNeighbors } from '../../models/UserNeighbors';
import { UserStats } from '../../models/UserStats';
import { CF_PARAMS, itemKey, type ItemKey } from '../../types/cf';
import { loadIufMap } from './popularity';
import { similarity, type RatingRow } from './similarity';

/**
 * Neighbourhood computation — §10.
 *
 * ── The inverted index is the whole trick ──
 * Comparing every user against every other is O(N²). But two users can only
 * have a non-zero similarity if they share at least one rated item, and in a
 * real rating matrix almost no pairs do. So the job builds `itemKey → [userId]`
 * once and derives candidate pairs from it: the work becomes proportional to
 * **co-rating density**, not user count.
 *
 * Never iterate all users to find candidates. That is the difference between a
 * job that finishes and one that doesn't.
 */

export type RatingsByUser = Map<string, RatingRow[]>;

export interface NeighborComputation {
  usersProcessed: number;
  pairsCompared: number;
  edgesWritten: number;
}

/** Loads the whole matrix as rows. Fine at Velvet's scale; see the SCALE note. */
export async function loadMatrix(): Promise<{ rows: RatingsByUser; index: Map<ItemKey, string[]> }> {
  const all = await Rating.find({})
    .select('userId contentId contentType rating source')
    .lean();

  const rows: RatingsByUser = new Map();
  const index = new Map<ItemKey, string[]>();

  for (const r of all) {
    const uid = String(r.userId);
    const key = itemKey(r.contentType, r.contentId);

    const row = rows.get(uid) ?? [];
    row.push({ itemKey: key, value: r.rating, source: r.source ?? 'explicit' });
    rows.set(uid, row);

    const raters = index.get(key) ?? [];
    raters.push(uid);
    index.set(key, raters);
  }

  return { rows, index };
}

/**
 * Candidate neighbours for one user: everyone sharing at least `minCoRated`
 * items, found by walking only the items that user actually rated.
 *
 * SCALE: above ~50k users, replace this with MinHash LSH banding over rating
 * sets. The inverted index still beats O(N²) but the postings list for a
 * popular item becomes the bottleneck. Do not build that now — it is a
 * different algorithm with different failure modes, and premature here.
 */
export function candidatesFor(
  userId: string,
  userRow: RatingRow[],
  index: Map<ItemKey, string[]>,
): Map<string, number> {
  const shared = new Map<string, number>();

  for (const r of userRow) {
    const raters = index.get(r.itemKey);
    if (!raters) continue;
    for (const other of raters) {
      if (other === userId) continue;
      shared.set(other, (shared.get(other) ?? 0) + 1);
    }
  }

  // Prune before the expensive part: a pair below the co-rated floor is
  // discarded by `similarity` anyway, so correlating it is wasted work.
  for (const [other, n] of shared) {
    if (n < CF_PARAMS.minCoRated) shared.delete(other);
  }
  return shared;
}

/**
 * Recomputes neighbours for every user, writing symmetrically.
 *
 * Similarity is symmetric — sim(u,v) === sim(v,u) — so each pair is correlated
 * once and written to both documents. Computing both directions would double
 * the most expensive part of the job for an identical answer.
 */
export async function computeAllNeighbors(): Promise<NeighborComputation> {
  const { rows, index } = await loadMatrix();
  const iuf = await loadIufMap();

  const userIds = [...rows.keys()];
  const acc = new Map<string, Array<{ userId: string; sim: number; rawSim: number; coRated: number }>>();
  for (const id of userIds) acc.set(id, []);

  const seen = new Set<string>();
  let pairsCompared = 0;

  for (const u of userIds) {
    const rowU = rows.get(u)!;
    for (const v of candidatesFor(u, rowU, index).keys()) {
      // Canonical pair key, so (u,v) and (v,u) are the same unit of work.
      const pair = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(pair)) continue;
      seen.add(pair);

      const rowV = rows.get(v);
      if (!rowV) continue;

      pairsCompared += 1;
      const s = similarity(rowU, rowV, { iuf });
      if (s.sim <= 0) continue;

      acc.get(u)?.push({ userId: v, sim: s.sim, rawSim: s.rawSim, coRated: s.coRated });
      acc.get(v)?.push({ userId: u, sim: s.sim, rawSim: s.rawSim, coRated: s.coRated });
    }
  }

  let edgesWritten = 0;
  const ops = [];

  for (const [uid, list] of acc) {
    const top = list
      .sort((a, b) => b.sim - a.sim)
      .slice(0, CF_PARAMS.maxStoredNeighbors)
      .map((n) => ({
        userId: new Types.ObjectId(n.userId),
        sim: n.sim,
        rawSim: n.rawSim,
        coRated: n.coRated,
      }));

    edgesWritten += top.length;
    ops.push({
      updateOne: {
        filter: { userId: new Types.ObjectId(uid) },
        update: { $set: { neighbors: top, computedAt: new Date() } },
        upsert: true,
      },
    });
  }

  if (ops.length) await UserNeighbors.bulkWrite(ops);

  // The watermark the incremental path compares against.
  await UserStats.updateMany(
    { userId: { $in: userIds.map((i) => new Types.ObjectId(i)) } },
    [{ $set: { ratingsAtLastNeighborRun: '$ratingCount' } }],
  );

  return { usersProcessed: userIds.length, pairsCompared, edgesWritten };
}

/**
 * Recomputes one user's row only.
 *
 * §10's incremental path. Rating one film should not re-walk the matrix, and
 * §16 criterion 5 wants a visible feed change within 30s of a 5.0 — which is
 * only achievable if a single-user recompute is cheap enough to run inline.
 *
 * Note the asymmetry with the full job: this writes the new edges into *both*
 * documents too, so the neighbour's view updates as well. Skipping that would
 * leave v thinking it has no relationship with u until the nightly run.
 */
export async function computeNeighborsForUser(userId: string): Promise<number> {
  const { rows, index } = await loadMatrix();
  const row = rows.get(userId);
  if (!row?.length) return 0;

  const iuf = await loadIufMap();
  const found: Array<{ userId: string; sim: number; rawSim: number; coRated: number }> = [];

  for (const v of candidatesFor(userId, row, index).keys()) {
    const rowV = rows.get(v);
    if (!rowV) continue;
    const s = similarity(row, rowV, { iuf });
    if (s.sim <= 0) continue;
    found.push({ userId: v, sim: s.sim, rawSim: s.rawSim, coRated: s.coRated });
  }

  const top = found
    .sort((a, b) => b.sim - a.sim)
    .slice(0, CF_PARAMS.maxStoredNeighbors);

  await UserNeighbors.updateOne(
    { userId: new Types.ObjectId(userId) },
    {
      $set: {
        neighbors: top.map((n) => ({
          userId: new Types.ObjectId(n.userId),
          sim: n.sim,
          rawSim: n.rawSim,
          coRated: n.coRated,
        })),
        computedAt: new Date(),
      },
    },
    { upsert: true },
  );

  // Mirror into each neighbour's document so the relationship is visible from
  // both sides immediately.
  for (const n of top) {
    await UserNeighbors.updateOne(
      { userId: new Types.ObjectId(n.userId) },
      { $pull: { neighbors: { userId: new Types.ObjectId(userId) } } },
    );
    await UserNeighbors.updateOne(
      { userId: new Types.ObjectId(n.userId) },
      {
        $push: {
          neighbors: {
            $each: [
              {
                userId: new Types.ObjectId(userId),
                sim: n.sim,
                rawSim: n.rawSim,
                coRated: n.coRated,
              },
            ],
            $sort: { sim: -1 },
            $slice: CF_PARAMS.maxStoredNeighbors,
          },
        },
      },
      { upsert: true },
    );
  }

  await UserStats.updateOne({ userId: new Types.ObjectId(userId) }, [
    { $set: { ratingsAtLastNeighborRun: '$ratingCount' } },
  ]);

  return top.length;
}

/** True once the user has added enough ratings that their row has moved on. */
export async function needsRecompute(userId: string): Promise<boolean> {
  const stats = await UserStats.findOne({ userId })
    .select('ratingCount ratingsAtLastNeighborRun')
    .lean();
  if (!stats) return false;
  return stats.ratingCount - (stats.ratingsAtLastNeighborRun ?? 0) >= 10;
}
