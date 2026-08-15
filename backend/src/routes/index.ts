import { Router } from 'express';

import * as activity from '../controllers/activityController';
import * as ai from '../controllers/aiController';
import * as catalog from '../controllers/catalogController';
import * as feedCtl from '../controllers/feedController';
import * as messages from '../controllers/messageController';
import * as notifications from '../controllers/notificationController';
import * as ratings from '../controllers/ratingController';
import * as users from '../controllers/userController';
import * as watchlist from '../controllers/watchlistController';
import { optionalAuth, requireAuth, requireVerified } from '../middleware/auth';

import authRoutes from './auth';

/**
 * The API surface, mounted in one place so the whole contract is readable at a
 * glance and `app.ts` stays a bootstrap file.
 *
 * Three access levels:
 *   - public         browsing the catalogue needs no account
 *   - optionalAuth   public, but renders differently when signed in
 *   - requireAuth    anything that reads or writes personal data
 */
const router = Router();

router.use('/auth', authRoutes);

/* ------------------------------- catalogue ------------------------------- */
/* Public. The keys live on this server; the browser never sees them.        */

router.get('/tmdb/trending', catalog.trending);
router.get('/tmdb/search', catalog.search);
router.get('/tmdb/movie/:id', catalog.movieDetail);
router.get('/tmdb/series/:id', catalog.seriesDetail);
router.get('/igdb/search', catalog.searchGames);
router.get('/igdb/game/:id', catalog.gameDetail);

/* --------------------------------- users --------------------------------- */

router.get('/users/search', optionalAuth, users.search);
router.put('/users/me', requireAuth, users.updateMe);
router.post('/users/me/photo', requireAuth, users.uploadPhoto);
router.get('/users/:id/followers', optionalAuth, users.followers);
router.get('/users/:id/following', optionalAuth, users.following);
router.post('/users/:id/follow', requireAuth, users.follow);
router.delete('/users/:id/follow', requireAuth, users.unfollow);
router.post('/users/:id/block', requireAuth, users.block);
router.delete('/users/:id/block', requireAuth, users.unblock);
// Last among /users routes: a bare `:username` would otherwise swallow
// `/users/search` and `/users/me`.
router.get('/users/:username', optionalAuth, users.getByUsername);

/* ---------------------------- ratings + reviews --------------------------- */

router.post('/ratings', requireAuth, ratings.upsert);
router.get('/ratings/stats', requireAuth, ratings.myStats);
// Declared before the `:type/:id` patterns so "mine" isn't swallowed as a type.
router.post('/ratings/content/mine', requireAuth, ratings.myRatingsBulk);
router.get('/ratings/content/:type/:id/me', requireAuth, ratings.myRating);
router.get('/ratings/content/:type/:id', optionalAuth, ratings.contentSummary);
router.get('/ratings/user/:userId', optionalAuth, ratings.byUser);

router.get('/reviews/content/:type/:id', optionalAuth, ratings.contentReviews);
router.post('/reviews/:id/like', requireAuth, ratings.toggleLike);
router.post('/reviews/:id/reply', requireAuth, ratings.reply);

/* ------------------------------- watchlist -------------------------------- */

router.get('/watchlist', requireAuth, watchlist.list);
router.post('/watchlist/toggle', requireAuth, watchlist.toggle);
router.post('/watchlist', requireAuth, watchlist.add);
router.put('/watchlist/:id', requireAuth, watchlist.update);
router.delete('/watchlist/:id', requireAuth, watchlist.remove);

/* ---------------------------------- AI ------------------------------------ */

// Importing the AI controller pulls in the Gemini SDK, which is safe with
// no key set: the client is constructed lazily on first use, so a server
// without GEMINI_API_KEY still boots and these routes answer 503.
// The advisor is gated on a verified address: it costs real money per call and
// is the obvious thing to point a throwaway signup at. `picks` is exempt — it
// is a TMDB query with no model call behind it, and it renders on the home
// screen, which an unverified account is explicitly still allowed to browse.
router.post('/ai/chat', requireAuth, requireVerified, ai.chat);
router.get('/ai/history', requireAuth, requireVerified, ai.history);
router.get('/ai/picks', requireAuth, ai.picks);

/* -------------------------------- messages -------------------------------- */

// Also gated: messaging reaches other people, so an unverified account must not
// be able to use it. `unread-count` stays open because the nav badge polls it on
// every screen, and a 403 storm there would be noise for no benefit.
router.get('/messages/conversations', requireAuth, requireVerified, messages.conversations);
router.get('/messages/unread-count', requireAuth, messages.unreadCount);
router.get('/messages/:userId', requireAuth, requireVerified, messages.thread);
router.post('/messages/:userId/send', requireAuth, requireVerified, messages.send);
router.put('/messages/:userId/read', requireAuth, requireVerified, messages.markRead);

/* ----------------------------- notifications ------------------------------ */

router.get('/notifications', requireAuth, notifications.list);
// Before '/notifications/:id/read', or ':id' would swallow 'count'.
router.get('/notifications/count', requireAuth, notifications.count);
router.post('/notifications/read', requireAuth, notifications.markRead);
router.put('/notifications/read-all', requireAuth, notifications.readAll);
router.put('/notifications/:id/read', requireAuth, notifications.readOne);

/* ----------------------------- follow requests ---------------------------- */

router.post('/follow-requests/:id/accept', requireAuth, notifications.acceptRequest);
router.post('/follow-requests/:id/decline', requireAuth, notifications.declineRequest);

/* ---------------------------------- feed ---------------------------------- */

router.get('/feed', requireAuth, feedCtl.feed);
router.get('/feed/seed', requireAuth, feedCtl.seedGrid);
router.post('/feed/seed', requireAuth, feedCtl.submitSeed);
router.post('/feed/dismiss', requireAuth, feedCtl.dismiss);

/* -------------------------------- activity -------------------------------- */

router.get('/activity/feed', requireAuth, activity.feed);
router.get('/activity/user/:userId/stats', optionalAuth, activity.statsForUser);
router.get('/activity/user/:userId', optionalAuth, activity.forUser);

export default router;
