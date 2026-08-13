import { Schema, model, type Model } from 'mongoose';

import type { ContentType } from './User';

/**
 * Per-item aggregates: how many people rated it, how well, and its inverse
 * user frequency.
 *
 * ── Why IUF exists ──
 * Everyone rates Spider-Man. Two users agreeing on it says almost nothing
 * about their taste. Two users agreeing on an obscure indie game says a great
 * deal. `iuf = log(N / raterCount)` encodes that: a universally-rated item
 * tends to zero weight, a rare one keeps full weight.
 *
 * Recomputed nightly rather than on write. It is a global statistic — one new
 * rating shifts every item's IUF by a rounding error — so recomputing per
 * write would be enormous churn for no accuracy.
 *
 * This collection is also what seeds the cold-start grid. §12 is specific that
 * the picker must select by `raterCount`, not TMDB popularity: seeding exists
 * to maximise *overlap with existing users*, and overlap is precisely what
 * similarity is computed from. A globally popular film nobody here has rated
 * is worthless for that.
 */

export interface IItemPopularity {
  /** `"movie:1315772"` — matches the derived itemKey. */
  itemKey: string;
  contentId: string;
  contentType: ContentType;
  /** Denormalised so the picker grid renders without a catalogue round trip. */
  title: string;
  poster: string | null;
  raterCount: number;
  meanRating: number;
  /** log(N / raterCount). Zero for an item everyone has rated. */
  iuf: number;
  updatedAt: Date;
}

const itemPopularitySchema = new Schema<IItemPopularity>(
  {
    itemKey: { type: String, required: true, unique: true },
    contentId: { type: String, required: true },
    contentType: { type: String, required: true },
    title: { type: String, default: '' },
    poster: { type: String, default: null },
    raterCount: { type: Number, default: 0 },
    meanRating: { type: Number, default: 0 },
    iuf: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

/** The cold-start grid query: most-rated first, optionally within a type. */
itemPopularitySchema.index({ raterCount: -1 });
itemPopularitySchema.index({ contentType: 1, raterCount: -1 });

export type ItemPopularityModel = Model<IItemPopularity>;

export const ItemPopularity: ItemPopularityModel = model<IItemPopularity>(
  'ItemPopularity',
  itemPopularitySchema,
);
