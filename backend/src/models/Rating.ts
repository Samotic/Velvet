import { Schema, model, type Types, type Model } from 'mongoose';

import { CONTENT_TYPES, type ContentType } from './User';
import type { RatingSource } from '../types/cf';

/**
 * One user's verdict on one title. A rating and a review are the same document:
 * the spec's Rating schema carries an optional `review`, so "rate it" and
 * "write a review" both upsert here on the (userId, contentId, contentType) key.
 *
 * `likes` holds the users who liked the review, so the length is the count and
 * membership answers "did I like this?" without a second collection.
 */
export interface IRating {
  userId: Types.ObjectId;
  contentId: string;
  contentType: ContentType;
  /** Denormalised so the profile and activity feeds don't re-hit TMDB per row. */
  contentTitle: string;
  poster: string | null;
  /** 1-5, the five-star scale the UI shows. */
  rating: number;
  /**
   * How this row entered the rating matrix.
   *
   * `implicit` rows are inferred from behaviour — completed, watchlisted,
   * dismissed — and carry less weight in the similarity computation than a
   * deliberate verdict. An implicit write must **never** overwrite an explicit
   * one: a user who rated something 2 and later watchlisted it still thinks
   * it's a 2.
   *
   * Pre-CF rows have no value here and default to `explicit`, which is
   * correct — everything written before this field existed came from the
   * rating UI.
   */
  source: RatingSource;
  review: string;
  likes: Types.ObjectId[];
  replies: RatingReply[];
  /** Recorded at rate time so watch-hour totals stay honest for old rows. */
  runtimeMinutes: number | null;
  genres: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RatingReply {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  text: string;
  createdAt: Date;
}

const replySchema = new Schema<RatingReply>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 1000, trim: true },
  createdAt: { type: Date, default: () => new Date() },
});

const ratingSchema = new Schema<IRating>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contentId: { type: String, required: true },
    contentType: { type: String, enum: CONTENT_TYPES, required: true },
    contentTitle: { type: String, default: '' },
    poster: { type: String, default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    source: { type: String, enum: ['explicit', 'implicit'], default: 'explicit' },
    review: { type: String, default: '', maxlength: 5000 },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    replies: { type: [replySchema], default: [] },
    runtimeMinutes: { type: Number, default: null },
    genres: { type: [String], default: [] },
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

/** One rating per user per title — the upsert in the controller relies on this. */
ratingSchema.index({ userId: 1, contentId: 1, contentType: 1 }, { unique: true });
/** The inverted index computeNeighbors walks: who else rated this item. */
ratingSchema.index({ contentType: 1, contentId: 1, userId: 1 });
/** A user's row, newest first — the incremental recompute watermark check. */
ratingSchema.index({ userId: 1, updatedAt: -1 });
/** Community score + review list for a title, newest first. */
ratingSchema.index({ contentId: 1, contentType: 1, createdAt: -1 });

export type RatingModel = Model<IRating>;

export const Rating: RatingModel = model<IRating>('Rating', ratingSchema);
