/**
 * End-to-end verification of the whole API against a real (in-memory) MongoDB.
 *
 * Spins up mongodb-memory-server, connects Mongoose, and drives the actual
 * Express app with supertest — no mocks and no stubs. This is what proves the
 * routes, the auth boundaries and the response shapes the frontend consumes
 * all work before a real Atlas string or any third-party key exists.
 *
 * Third-party integrations are deliberately left unconfigured here, so the
 * "degrades honestly" promise is verified too: catalogue and AI routes must
 * answer 503 with a readable message rather than throwing.
 *
 *   npm run verify:api        (from backend/)
 */
// MUST stay first: it blanks the real .env before src/config/env snapshots it.
// See scripts/testEnv.ts for why an inline assignment here would not work.
import './testEnv';

import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/lib/db';
import { User } from '../src/models/User';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function run() {
  const mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());

  const app = createApp();
  const api = () => request(app);

  /* ------------------------------ accounts ------------------------------ */

  section('Accounts and onboarding');

  const aRes = await api()
    .post('/api/auth/register')
    .send({ email: 'ada@velvet.test', username: 'ada', displayName: 'Ada', password: 'password123' });
  check('register returns 201', aRes.status === 201, `got ${aRes.status}`);
  const ada = aRes.body?.data?.token as string;
  const adaId = aRes.body?.data?.user?.id as string;
  check('register returns a token and id', Boolean(ada && adaId));
  check(
    'a new account is not onboarded',
    aRes.body?.data?.user?.onboardingCompleted === false,
    String(aRes.body?.data?.user?.onboardingCompleted),
  );

  const bRes = await api()
    .post('/api/auth/register')
    .send({ email: 'lin@velvet.test', username: 'lin', displayName: 'Lin', password: 'password123' });
  const lin = bRes.body?.data?.token as string;
  const linId = bRes.body?.data?.user?.id as string;

  const freeHandle = await api().get('/api/auth/check-username?username=brandnew');
  check('check-username reports a free handle', freeHandle.body?.data?.available === true);

  const takenHandle = await api().get('/api/auth/check-username?username=ada');
  check('check-username reports a taken handle', takenHandle.body?.data?.available === false);

  const onboard = await api()
    .post('/api/auth/complete-onboarding')
    .set('Authorization', `Bearer ${ada}`)
    .send({
      age: 29,
      gender: 'female',
      favouriteGenres: ['Thriller', 'Sci-Fi', 'Drama'],
      favouriteMood: 'dark_intense',
    });
  check('complete-onboarding succeeds', onboard.status === 200, `got ${onboard.status}`);
  check(
    'onboarding flips the completed flag',
    onboard.body?.data?.user?.onboardingCompleted === true,
  );

  const tooFew = await api()
    .post('/api/auth/complete-onboarding')
    .set('Authorization', `Bearer ${lin}`)
    .send({ age: 30, gender: 'male', favouriteGenres: ['Drama'], favouriteMood: 'feel_good' });
  check('onboarding rejects fewer than three genres', tooFew.status === 422, `got ${tooFew.status}`);

  await api()
    .post('/api/auth/complete-onboarding')
    .set('Authorization', `Bearer ${lin}`)
    .send({
      age: 30,
      gender: 'male',
      favouriteGenres: ['Drama', 'Comedy', 'Crime'],
      favouriteMood: 'feel_good',
    });

  check('a second account registers too', Boolean(lin && linId), 'duplicate-key regression guard');

  /* --------------------------- the verified gate ------------------------- */

  section('Email verification gate');

  const beforeVerify = await api()
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${ada}`);
  check('messaging is blocked before verifying', beforeVerify.status === 403, `got ${beforeVerify.status}`);
  check(
    'the 403 carries the machine-readable marker',
    String(beforeVerify.body?.error).includes('EMAIL_NOT_VERIFIED'),
  );

  const aiBeforeVerify = await api()
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${ada}`)
    .send({ message: 'hello' });
  check('the advisor is blocked before verifying', aiBeforeVerify.status === 403, `got ${aiBeforeVerify.status}`);

  const bogusVerify = await api().post('/api/auth/verify-email').send({ token: 'not-a-real-token' });
  check('a bogus verification token is refused', bogusVerify.status === 400, `got ${bogusVerify.status}`);

  const forgot = await api()
    .post('/api/auth/forgot-password')
    .send({ email: 'nobody@velvet.test' });
  check('forgot-password never reveals whether an account exists', forgot.status === 200, `got ${forgot.status}`);

  const badReset = await api()
    .post('/api/auth/reset-password')
    .send({ token: 'not-a-real-token', newPassword: 'password456' });
  check('a bogus reset token is refused', badReset.status === 400, `got ${badReset.status}`);

  const googleOff = await api().get('/api/auth/google');
  check('Google redirects out when unconfigured', googleOff.status === 302, `got ${googleOff.status}`);
  check(
    'the Google redirect explains itself',
    String(googleOff.headers.location).includes('google_unavailable'),
  );

  // Everything below tests features, not the gate. Flip both accounts the way
  // opening the emailed link would, rather than reaching for the raw token —
  // only its SHA-256 is stored, so the plaintext genuinely is unavailable here.
  await User.updateMany({}, { $set: { emailVerified: true } });

  const afterVerify = await api()
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${ada}`);
  check('verifying opens messaging', afterVerify.status === 200, `got ${afterVerify.status}`);

  /* ------------------------------- profiles ------------------------------ */

  section('Profiles and follows');

  const profile = await api().get('/api/users/ada').set('Authorization', `Bearer ${lin}`);
  check('a public profile loads by handle', profile.status === 200, `got ${profile.status}`);
  check('profile is viewer-aware (not me)', profile.body?.data?.user?.isMe === false);
  check('profile starts unfollowed', profile.body?.data?.user?.isFollowing === false);
  check(
    'profile never leaks the hash or email',
    !JSON.stringify(profile.body).toLowerCase().includes('passwordhash') &&
      !JSON.stringify(profile.body).includes('ada@velvet.test'),
  );

  const ownProfile = await api().get('/api/users/ada').set('Authorization', `Bearer ${ada}`);
  check('own profile reports isMe', ownProfile.body?.data?.user?.isMe === true);

  const followRes = await api()
    .post(`/api/users/${adaId}/follow`)
    .set('Authorization', `Bearer ${lin}`);
  check('follow succeeds', followRes.status === 200, `got ${followRes.status}`);

  // Idempotency matters: a double tap must not inflate the count.
  await api().post(`/api/users/${adaId}/follow`).set('Authorization', `Bearer ${lin}`);
  const afterFollow = await api().get('/api/users/ada').set('Authorization', `Bearer ${lin}`);
  check('following is reflected', afterFollow.body?.data?.user?.isFollowing === true);
  check(
    'double-follow does not double-count',
    afterFollow.body?.data?.user?.followerCount === 1,
    `got ${afterFollow.body?.data?.user?.followerCount}`,
  );

  const selfFollow = await api()
    .post(`/api/users/${adaId}/follow`)
    .set('Authorization', `Bearer ${ada}`);
  // 400, not 422: the controller treats a self-follow as a malformed request
  // rather than a well-formed one it declined.
  check('cannot follow yourself', selfFollow.status === 400, `got ${selfFollow.status}`);

  const followersList = await api()
    .get(`/api/users/${adaId}/followers`)
    .set('Authorization', `Bearer ${ada}`);
  check('followers list returns the follower', followersList.body?.data?.users?.length === 1);

  const people = await api().get('/api/users/search?q=li').set('Authorization', `Bearer ${ada}`);
  check('people search finds a user', (people.body?.data?.users?.length ?? 0) >= 1);

  const editRes = await api()
    .put('/api/users/me')
    .set('Authorization', `Bearer ${ada}`)
    .send({ bio: 'Thriller apologist.', displayName: 'Ada L.' });
  check('profile edit saves', editRes.body?.data?.user?.bio === 'Thriller apologist.');

  /* ---------------------------- ratings + reviews ------------------------ */

  section('Ratings and reviews');

  const rate = await api()
    .post('/api/ratings')
    .set('Authorization', `Bearer ${ada}`)
    .send({
      contentId: '550',
      contentType: 'movie',
      contentTitle: 'Fight Club',
      poster: null,
      rating: 5,
      review: 'Holds up.',
      runtimeMinutes: 139,
      genres: ['Drama', 'Thriller'],
    });
  check('rating saves', rate.status === 201, `got ${rate.status}`);
  const reviewId = rate.body?.data?.rating?.id as string;
  check('rating comes back shaped for the UI', rate.body?.data?.rating?.likeCount === 0);

  const badRating = await api()
    .post('/api/ratings')
    .set('Authorization', `Bearer ${ada}`)
    .send({ contentId: '550', contentType: 'movie', rating: 9 });
  check('rating outside 1-5 is rejected', badRating.status === 422, `got ${badRating.status}`);

  // Re-rating must update in place, not create a second row.
  await api()
    .post('/api/ratings')
    .set('Authorization', `Bearer ${ada}`)
    .send({
      contentId: '550',
      contentType: 'movie',
      contentTitle: 'Fight Club',
      rating: 4,
      review: 'Still good.',
      runtimeMinutes: 139,
      genres: ['Drama'],
    });
  const mine = await api()
    .get('/api/ratings/content/movie/550/me')
    .set('Authorization', `Bearer ${ada}`);
  check('re-rating updates in place', mine.body?.data?.rating?.rating === 4);

  const summary = await api().get('/api/ratings/content/movie/550');
  check('community summary counts one rating', summary.body?.data?.count === 1);
  check('distribution is a five-bucket histogram', summary.body?.data?.distribution?.length === 5);
  check('distribution puts the rating in the 4-star bucket', summary.body?.data?.distribution?.[3] === 1);

  const likeRes = await api()
    .post(`/api/reviews/${reviewId}/like`)
    .set('Authorization', `Bearer ${lin}`);
  check('liking a review works', likeRes.body?.data?.liked === true);
  check('like count increments', likeRes.body?.data?.likeCount === 1);

  const unlikeRes = await api()
    .post(`/api/reviews/${reviewId}/like`)
    .set('Authorization', `Bearer ${lin}`);
  check('liking again unlikes', unlikeRes.body?.data?.liked === false);

  const replyRes = await api()
    .post(`/api/reviews/${reviewId}/reply`)
    .set('Authorization', `Bearer ${lin}`)
    .send({ text: 'Agreed.' });
  check('replying works', replyRes.status === 201, `got ${replyRes.status}`);
  check('reply carries its author', replyRes.body?.data?.review?.replies?.[0]?.user?.username === 'lin');

  const reviews = await api().get('/api/reviews/content/movie/550');
  check('reviews list is public', reviews.status === 200);
  check('review hides the raw likes array', reviews.body?.data?.reviews?.[0]?.likes === undefined);

  const stats = await api().get('/api/ratings/stats').set('Authorization', `Bearer ${ada}`);
  check('stats count the rated film', stats.body?.data?.films === 1);
  check('stats total the runtime into hours', stats.body?.data?.hours === 2, `got ${stats.body?.data?.hours}`);
  check('stats expose averageRating for the UI', stats.body?.data?.averageRating === 4);

  /* ------------------------------- watchlist ----------------------------- */

  section('Watchlist');

  const toggleOn = await api()
    .post('/api/watchlist/toggle')
    .set('Authorization', `Bearer ${ada}`)
    .send({ contentId: '27205', contentType: 'movie', contentTitle: 'Inception', year: '2010' });
  check('toggle adds', toggleOn.body?.data?.saved === true);

  const listed = await api().get('/api/watchlist').set('Authorization', `Bearer ${ada}`);
  check('watchlist lists the item', listed.body?.data?.items?.length === 1);
  const itemId = listed.body?.data?.items?.[0]?.id as string;

  const progressed = await api()
    .put(`/api/watchlist/${itemId}`)
    .set('Authorization', `Bearer ${ada}`)
    .send({ status: 'finished' });
  check('marking finished sets progress to 100', progressed.body?.data?.item?.progressPercent === 100);

  const foreign = await api()
    .put(`/api/watchlist/${itemId}`)
    .set('Authorization', `Bearer ${lin}`)
    .send({ status: 'want' });
  check("cannot edit someone else's watchlist row", foreign.status === 404, `got ${foreign.status}`);

  const toggleOff = await api()
    .post('/api/watchlist/toggle')
    .set('Authorization', `Bearer ${ada}`)
    .send({ contentId: '27205', contentType: 'movie', contentTitle: 'Inception' });
  check('toggle removes', toggleOff.body?.data?.saved === false);

  /* -------------------------------- messages ----------------------------- */

  section('Messaging');

  // Messaging requires a mutual follow. Only lin → ada exists above, so ada
  // follows back here rather than in the follows section, where an extra edge
  // would move the counts those checks assert on.
  await api().post(`/api/users/${linId}/follow`).set('Authorization', `Bearer ${ada}`);

  const sent = await api()
    .post(`/api/messages/${linId}/send`)
    .set('Authorization', `Bearer ${ada}`)
    .send({ text: 'Seen anything good?' });
  check('sending a message works', sent.status === 201, `got ${sent.status}`);

  const selfMsg = await api()
    .post(`/api/messages/${adaId}/send`)
    .set('Authorization', `Bearer ${ada}`)
    .send({ text: 'hello me' });
  check('cannot message yourself', selfMsg.status === 422, `got ${selfMsg.status}`);

  const convos = await api()
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${lin}`);
  check('conversation appears for the recipient', convos.body?.data?.conversations?.length === 1);
  check('conversation shows the other person', convos.body?.data?.conversations?.[0]?.user?.username === 'ada');
  check('conversation carries an unread count', convos.body?.data?.conversations?.[0]?.unread === 1);

  const unread = await api().get('/api/messages/unread-count').set('Authorization', `Bearer ${lin}`);
  check('unread count is exposed for the badge', unread.body?.data?.unread === 1);

  await api().put(`/api/messages/${adaId}/read`).set('Authorization', `Bearer ${lin}`);
  const afterRead = await api()
    .get('/api/messages/unread-count')
    .set('Authorization', `Bearer ${lin}`);
  check('marking read clears the badge', afterRead.body?.data?.unread === 0);

  const thread = await api().get(`/api/messages/${adaId}`).set('Authorization', `Bearer ${lin}`);
  check('thread returns the messages', thread.body?.data?.messages?.length === 1);
  check('thread returns the other participant', thread.body?.data?.user?.username === 'ada');

  /* ----------------------------- notifications --------------------------- */

  section('Notifications and activity');

  const notifs = await api().get('/api/notifications').set('Authorization', `Bearer ${ada}`);
  check('notifications were generated', (notifs.body?.data?.notifications?.length ?? 0) > 0);
  // 'follow' is deprecated — a public target now yields 'new_follower' and a
  // private one 'follow_request'. Ada is public, so it is the former.
  check(
    'a follow notification exists',
    notifs.body?.data?.notifications?.some((n: { type: string }) => n.type === 'new_follower'),
  );
  check('notifications carry an unread total', typeof notifs.body?.data?.unread === 'number');

  await api().put('/api/notifications/read-all').set('Authorization', `Bearer ${ada}`);
  const afterReadAll = await api()
    .get('/api/notifications')
    .set('Authorization', `Bearer ${ada}`);
  check('read-all clears the unread total', afterReadAll.body?.data?.unread === 0);

  const feed = await api().get('/api/activity/feed').set('Authorization', `Bearer ${lin}`);
  check('activity feed shows a followed user', (feed.body?.data?.items?.length ?? 0) > 0);
  check(
    'a rating with words reads as a review',
    feed.body?.data?.items?.some((i: { action: string }) => i.action === 'reviewed'),
  );

  const emptyFeed = await api().get('/api/activity/feed').set('Authorization', `Bearer ${ada}`);
  check('following nobody is an empty feed, not an error', emptyFeed.status === 200 && emptyFeed.body?.data?.items?.length === 0);

  const userStatsRes = await api()
    .get(`/api/activity/user/${adaId}/stats`)
    .set('Authorization', `Bearer ${lin}`);
  check('profile stats are public', userStatsRes.status === 200);

  /* --------------------------- auth boundaries --------------------------- */

  section('Auth boundaries');

  const noToken = await api().get('/api/watchlist');
  check('watchlist requires auth', noToken.status === 401, `got ${noToken.status}`);

  const badToken = await api().get('/api/ratings/stats').set('Authorization', 'Bearer nonsense');
  check('a bad token is rejected', badToken.status === 401, `got ${badToken.status}`);

  const publicReviews = await api().get('/api/reviews/content/movie/550');
  check('reviews are readable signed out', publicReviews.status === 200);
  check(
    'signed out, nothing is marked as liked by me',
    publicReviews.body?.data?.reviews?.[0]?.likedByMe === false,
  );

  const missing = await api().get('/api/users/nobody-here').set('Authorization', `Bearer ${ada}`);
  check('unknown profile 404s', missing.status === 404, `got ${missing.status}`);

  const badRoute = await api().get('/api/not-a-route');
  check('unknown route 404s in the error envelope', badRoute.status === 404 && Boolean(badRoute.body?.error));

  /* ------------------------- honest degradation -------------------------- */

  section('Degrading without third-party keys');

  const ai = await api()
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${ada}`)
    .send({ message: 'what should I watch?' });
  check('AI answers 503 without a key', ai.status === 503, `got ${ai.status}`);
  check('AI 503 explains itself', typeof ai.body?.error === 'string' && ai.body.error.length > 10);

  const photo = await api()
    .post('/api/users/me/photo')
    .set('Authorization', `Bearer ${ada}`)
    .send({ file: 'not-a-data-url' });
  check('a malformed upload is rejected before Cloudinary', photo.status === 422, `got ${photo.status}`);

  const health = await api().get('/api/health');
  check('health check responds', health.status === 200 && health.body?.data?.status === 'ok');

  /* --------------------------------- done -------------------------------- */

  await disconnectDb();
  await mongo.stop();

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nverify-api crashed:', err);
  process.exit(1);
});
