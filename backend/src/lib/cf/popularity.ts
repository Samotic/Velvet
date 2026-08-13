import { ItemPopularity } from '../../models/ItemPopularity';
import { Rating } from '../../models/Rating';
import { User } from '../../models/User';
import { itemKey, type ItemKey } from '../../types/cf';
import type { ContentType } from '../../models/User';

/**
 * Rebuilds `itemPopularity` from the ratings table.
 *
 * One aggregation over the whole collection rather than a per-item loop: this
 * runs nightly across every rated title, and N round trips would dominate the
 * job.
 */
export async function recomputePopularity(): Promise<{ items: number; users: number }> {
  const userCount = await User.countDocuments({});
  // log(N/1) is the ceiling; with no users at all every IUF would be -Infinity.
  const N = Math.max(userCount, 1);

  const rows: Array<{
    _id: { contentId: string; contentType: ContentType };
    raterCount: number;
    meanRating: number;
    title: string;
    poster: string | null;
  }> = await Rating.aggregate([
    {
      $group: {
        _id: { contentId: '$contentId', contentType: '$contentType' },
        raterCount: { $sum: 1 },
        meanRating: { $avg: '$rating' },
        // $first is arbitrary but stable enough for a display label; the
        // catalogue is the authority and this is only a cache.
        title: { $first: '$contentTitle' },
        poster: { $first: '$poster' },
      },
    },
  ]);

  /**
   * Drop rows for items nobody rates any more.
   *
   * The aggregation only produces items that currently have ratings, so an
   * upsert-only rebuild leaves the rest behind forever. Those stale rows are
   * not inert: "Widely loved" and the cold-start grid both read this
   * collection, so a deleted account's ratings would keep recommending titles
   * that no longer have a single rater.
   */
  const liveKeys = rows.map((r) => itemKey(r._id.contentType, r._id.contentId));
  const removed = await ItemPopularity.deleteMany({ itemKey: { $nin: liveKeys } });
  if (removed.deletedCount) console.log(`  pruned ${removed.deletedCount} stale popularity rows`);

  if (!rows.length) return { items: 0, users: userCount };

  const ops = rows.map((r) => {
    const key: ItemKey = itemKey(r._id.contentType, r._id.contentId);
    return {
      updateOne: {
        filter: { itemKey: key },
        update: {
          $set: {
            itemKey: key,
            contentId: r._id.contentId,
            contentType: r._id.contentType,
            title: r.title ?? '',
            poster: r.poster ?? null,
            raterCount: r.raterCount,
            meanRating: r.meanRating,
            iuf: iufFor(N, r.raterCount),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  });

  await ItemPopularity.bulkWrite(ops);
  return { items: rows.length, users: userCount };
}

/**
 * log(N / raterCount), floored at 0.
 *
 * The floor matters: when every user has rated an item, log(1) is 0 — correct,
 * the item carries no information. But `raterCount` can briefly exceed `N`
 * after an account is deleted, which would make the log negative and *invert*
 * that item's contribution to similarity. A negative weight would turn
 * agreement into disagreement.
 */
export function iufFor(userCount: number, raterCount: number): number {
  if (raterCount <= 0) return Math.log(Math.max(userCount, 1));
  return Math.max(0, Math.log(userCount / raterCount));
}

/** The IUF lookup the similarity computation takes. One query, not one per pair. */
export async function loadIufMap(keys?: ItemKey[]): Promise<Map<ItemKey, number>> {
  const filter = keys?.length ? { itemKey: { $in: keys } } : {};
  const rows = await ItemPopularity.find(filter).select('itemKey iuf').lean();

  const map = new Map<ItemKey, number>();
  for (const r of rows) map.set(r.itemKey, r.iuf);
  return map;
}
