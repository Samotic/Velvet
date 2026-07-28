import { Schema, model, type Types, type Model } from 'mongoose';

import { CONTENT_TYPES, type ContentType } from './User';

/** The three watchlist tabs. */
export const WATCH_STATUSES = ['want', 'watching', 'finished'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export interface IWatchlistItem {
  userId: Types.ObjectId;
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  poster: string | null;
  year: string | null;
  status: WatchStatus;
  /** 0-100. Only meaningful while `status` is 'watching'. */
  progressPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const watchlistSchema = new Schema<IWatchlistItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contentId: { type: String, required: true },
    contentType: { type: String, enum: CONTENT_TYPES, required: true },
    contentTitle: { type: String, required: true },
    poster: { type: String, default: null },
    year: { type: String, default: null },
    status: { type: String, enum: WATCH_STATUSES, default: 'want' },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/** A title appears at most once in a user's watchlist, whatever the status. */
watchlistSchema.index({ userId: 1, contentId: 1, contentType: 1 }, { unique: true });

export type WatchlistItemModel = Model<IWatchlistItem>;

export const WatchlistItem: WatchlistItemModel = model<IWatchlistItem>(
  'WatchlistItem',
  watchlistSchema,
);
