import type { Types } from 'mongoose';

import { WatchlistItem } from '../models/WatchlistItem';

/**
 * What the watchlist tells the advisor.
 *
 * Two facts it never had, and they pull in opposite directions:
 *
 *  - **Saved but unwatched** is intent. Recommending something already sitting
 *    on the list is not wrong so much as useless — the user has already agreed
 *    to watch it and did not. Naming it back to them ("you saved this in
 *    March") is worth far more than presenting it as a discovery.
 *  - **Part-way through** is the strongest signal of all and the shortest
 *    lived. Someone forty minutes into a series does not want a new
 *    recommendation, and an advisor that cannot see this will cheerfully
 *    suggest starting something else.
 */
export interface WatchlistSignal {
  /** `status: 'want'` — agreed to watch, has not. */
  saved: string[];
  /** `status: 'watching'` — mid-way, with how far in. */
  inProgress: { title: string; percent: number }[];
}

export async function watchlistSignal(
  userId: string | Types.ObjectId,
  limit = 10,
): Promise<WatchlistSignal> {
  const rows = await WatchlistItem.find({ userId, status: { $in: ['want', 'watching'] } })
    .sort({ updatedAt: -1 })
    .limit(limit * 2)
    .select('contentTitle status progressPercent')
    .lean();

  const saved: string[] = [];
  const inProgress: { title: string; percent: number }[] = [];

  for (const r of rows) {
    if (!r.contentTitle) continue;
    if (r.status === 'watching') {
      inProgress.push({ title: r.contentTitle, percent: r.progressPercent ?? 0 });
    } else if (saved.length < limit) {
      saved.push(r.contentTitle);
    }
  }

  return { saved, inProgress };
}
