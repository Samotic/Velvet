import type { Request, Response } from 'express';
import { Types } from 'mongoose';

import { FeedCache } from '../models/FeedCache';
import { Rating } from '../models/Rating';
import { computeNeighborsForUser, needsRecompute } from '../lib/cf/neighbors';
import { recomputeUserStats } from '../lib/cf/stats';
import { viewerId } from '../middleware/auth';
import { userStats } from '../services/stats';
import { checkViewById, PRIVATE_MESSAGE } from '../services/visibility';
import { fail, ok } from '../utils/http';
import { notify } from '../utils/notify';
import { distribution, review as toReview } from '../utils/serialize';
import { clean, isContentType, isObjectId, isRatingValue, str } from '../utils/validation';

/**
 * Ratings and reviews.
 *
 * They're one record: the schema carries an optional `review` alongside the
 * score, so "rate it" and "write a review" both upsert the same document on
 * the (userId, contentId, contentType) key. That's why there's no separate
 * review controller — `/api/reviews/*` routes land here too.
 */

const AUTHOR = 'username displayName profilePhoto';

/* -------------------------------- writing -------------------------------- */

/** POST /api/ratings — create or update the caller's rating for one title. */
export async function upsert(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const contentId = str(body.contentId);
    const contentType = body.contentType;
    const rating = body.rating;

    if (!contentId) return fail(res, 'Which title?', 422);
    if (!isContentType(contentType)) return fail(res, 'Unrecognised content type', 422);
    if (!isRatingValue(rating)) return fail(res, 'A rating is a whole number from 1 to 5', 422);

    const doc = await Rating.findOneAndUpdate(
      { userId: req.user!.userId, contentId, contentType },
      {
        $set: {
          contentTitle: str(body.contentTitle),
          poster: typeof body.poster === 'string' ? body.poster : null,
          rating,
          review: clean(body.review, 5000),
          runtimeMinutes: typeof body.runtimeMinutes === 'number' ? body.runtimeMinutes : null,
          genres: Array.isArray(body.genres)
            ? body.genres.filter((g): g is string => typeof g === 'string')
            : [],
        },
        // An explicit rating always supersedes an implicit one — a deliberate
        // verdict outranks anything inferred from behaviour.
        source: 'explicit',
        // Only on insert, so re-rating doesn't wipe likes and replies already
        // left on the review.
        $setOnInsert: { likes: [], replies: [] },
      },
      { new: true, upsert: true, runValidators: true },
    ).populate('userId', AUTHOR);

    /**
     * Keep the CF side in step with the write.
     *
     * `userStats` must be exact — every similarity this user takes part in
     * centres on their mean — so it is awaited. The neighbour recompute is
     * fired without awaiting: it is the expensive half, and criterion 5 asks
     * for a changed feed within 30s, not within this request. The stale feed
     * is dropped either way, so the next load rebuilds.
     */
    const userId = req.user!.userId;
    await recomputeUserStats(userId);
    await FeedCache.deleteOne({ userId });
    if (await needsRecompute(userId)) {
      void computeNeighborsForUser(userId).catch((e) =>
        console.error('neighbour recompute failed:', e),
      );
    }

    return ok(res, { rating: toReview(doc.toObject(), req.user!.userId) }, 201);
  } catch (err) {
    console.error('rating upsert error:', err);
    return fail(res, 'Could not save your rating', 500);
  }
}

/* -------------------------------- reading -------------------------------- */

/** GET /api/ratings/content/:type/:id — community score and distribution. */
export async function contentSummary(req: Request, res: Response): Promise<Response> {
  try {
    const { type, id } = req.params;
    if (!isContentType(type)) return fail(res, 'Unrecognised content type', 422);

    const rows = await Rating.find({ contentId: id, contentType: type })
      .select('rating')
      .lean();

    const count = rows.length;
    const average =
      count > 0 ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / count) * 10) / 10 : null;

    return ok(res, { average, count, distribution: distribution(rows) });
  } catch (err) {
    console.error('contentSummary error:', err);
    return fail(res, 'Could not load ratings', 500);
  }
}

/** GET /api/ratings/content/:type/:id/me — the caller's own rating, or null. */
export async function myRating(req: Request, res: Response): Promise<Response> {
  try {
    const { type, id } = req.params;
    if (!isContentType(type)) return fail(res, 'Unrecognised content type', 422);

    const doc = await Rating.findOne({
      userId: req.user!.userId,
      contentId: id,
      contentType: type,
    }).populate('userId', AUTHOR);

    return ok(res, { rating: doc ? toReview(doc.toObject(), req.user!.userId) : null });
  } catch (err) {
    console.error('myRating error:', err);
    return fail(res, 'Could not load your rating', 500);
  }
}

/**
 * POST /api/ratings/content/mine — the caller's own score for many titles.
 *
 * The poster card shows the viewer's own star badge, so a grid of 20 cards
 * used to mean 20 calls to `myRating`, and every rating write re-fired all of
 * them. This answers the whole grid in one query.
 *
 * It returns bare numbers keyed by `type:id`, not full reviews: the badge only
 * needs the score, and skipping the author populate keeps this cheap enough to
 * call on every grid render.
 */
export async function myRatingsBulk(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(body.items) ? body.items : [];
    if (raw.length === 0) return ok(res, { ratings: {} });

    // Bounded so a crafted body can't turn one request into an unbounded $or.
    const items = raw.slice(0, 100).flatMap((entry) => {
      const it = (entry ?? {}) as Record<string, unknown>;
      const contentId = str(it.contentId);
      const contentType = it.contentType;
      if (!contentId || !isContentType(contentType)) return [];
      return [{ contentId, contentType }];
    });

    if (items.length === 0) return ok(res, { ratings: {} });

    const rows = await Rating.find({
      userId: req.user!.userId,
      $or: items.map(({ contentId, contentType }) => ({ contentId, contentType })),
    })
      .select('contentId contentType rating')
      .lean();

    const ratings: Record<string, number> = {};
    for (const row of rows) {
      ratings[`${row.contentType}:${row.contentId}`] = row.rating;
    }

    return ok(res, { ratings });
  } catch (err) {
    console.error('myRatingsBulk error:', err);
    return fail(res, 'Could not load your ratings', 500);
  }
}

/** GET /api/ratings/user/:userId — everything one person has rated. */
export async function byUser(req: Request, res: Response): Promise<Response> {
  try {
    const { userId } = req.params;
    if (!isObjectId(userId)) return fail(res, 'User not found', 404);

    /**
     * The one that mattered most. This endpoint took a user id off the URL and
     * returned up to 200 of their ratings and reviews to anyone at all, signed
     * in or not — a private account's entire viewing history, one request away.
     */
    const view = await checkViewById(viewerId(req), userId);
    if (!view.ok) {
      return view.reason === 'private'
        ? fail(res, PRIVATE_MESSAGE, 403)
        : fail(res, 'User not found', 404);
    }

    const rows = await Rating.find({ userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('userId', AUTHOR)
      .populate('replies.userId', AUTHOR);

    const viewer = viewerId(req);
    return ok(res, { ratings: rows.map((r) => toReview(r.toObject(), viewer)) });
  } catch (err) {
    console.error('byUser error:', err);
    return fail(res, 'Could not load those ratings', 500);
  }
}

/** GET /api/ratings/stats — the caller's own watch statistics. */
export async function myStats(req: Request, res: Response): Promise<Response> {
  try {
    const s = await userStats(req.user!.userId);
    // `avgRating` is the internal name; the UI contract calls it averageRating.
    return ok(res, { ...s, averageRating: s.avgRating });
  } catch (err) {
    console.error('myStats error:', err);
    return fail(res, 'Could not load your stats', 500);
  }
}

/* -------------------------------- reviews -------------------------------- */

/** GET /api/reviews/content/:type/:id?sort=recent|liked — written reviews. */
export async function contentReviews(req: Request, res: Response): Promise<Response> {
  try {
    const { type, id } = req.params;
    if (!isContentType(type)) return fail(res, 'Unrecognised content type', 422);

    const rows = await Rating.find({ contentId: id, contentType: type })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('userId', AUTHOR)
      .populate('replies.userId', AUTHOR);

    const viewer = viewerId(req);
    let reviews = rows.map((r) => toReview(r.toObject(), viewer));

    // Sorting by popularity happens here rather than in Mongo: `likes` is an
    // array, so ordering by its length would need an aggregation pipeline for
    // what is at most a hundred rows.
    if (str(req.query.sort) === 'liked') {
      reviews = reviews.sort((a, b) => Number(b.likeCount) - Number(a.likeCount));
    }

    return ok(res, { reviews });
  } catch (err) {
    console.error('contentReviews error:', err);
    return fail(res, 'Could not load reviews', 500);
  }
}

/** POST /api/reviews/:id/like — toggles, and reports the resulting state. */
export async function toggleLike(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'Review not found', 404);

    const me = new Types.ObjectId(req.user!.userId);
    const doc = await Rating.findById(id).select('likes userId contentTitle contentId contentType');
    if (!doc) return fail(res, 'Review not found', 404);

    const liked = doc.likes.some((l) => String(l) === req.user!.userId);

    // The server decides the resulting state rather than trusting a client
    // "like"/"unlike" intent, so two tabs can't drive it out of step.
    await Rating.updateOne(
      { _id: id },
      liked ? { $pull: { likes: me } } : { $addToSet: { likes: me } },
    );

    if (!liked) {
      await notify({
        userId: doc.userId,
        type: 'review_like',
        fromUserId: req.user!.userId,
        contentId: doc.contentId,
        contentType: doc.contentType,
        contentTitle: doc.contentTitle,
      });
    }

    return ok(res, { liked: !liked, likeCount: doc.likes.length + (liked ? -1 : 1) });
  } catch (err) {
    console.error('toggleLike error:', err);
    return fail(res, 'Could not update that like', 500);
  }
}

/** POST /api/reviews/:id/reply */
export async function reply(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id;
    if (!isObjectId(id)) return fail(res, 'Review not found', 404);

    const text = clean((req.body ?? {}).text, 1000);
    if (!text) return fail(res, 'Write something first', 422);

    const doc = await Rating.findByIdAndUpdate(
      id,
      {
        $push: {
          replies: { userId: new Types.ObjectId(req.user!.userId), text, createdAt: new Date() },
        },
      },
      { new: true },
    )
      .populate('userId', AUTHOR)
      .populate('replies.userId', AUTHOR);

    if (!doc) return fail(res, 'Review not found', 404);

    await notify({
      userId: doc.userId,
      type: 'review_reply',
      fromUserId: req.user!.userId,
      contentId: doc.contentId,
      contentType: doc.contentType,
      contentTitle: doc.contentTitle,
    });

    return ok(res, { review: toReview(doc.toObject(), req.user!.userId) }, 201);
  } catch (err) {
    console.error('reply error:', err);
    return fail(res, 'Could not post that reply', 500);
  }
}
