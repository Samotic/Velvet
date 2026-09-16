# Velvet

Discover, rate and talk about **films, series and games**. Velvet is two
services: a Next.js app and an Express + MongoDB API. Ratings, reviews,
watchlists, follows and direct messages live on the server; recommendations come
from a collaborative-filtering pipeline over real ratings, and a Gemini-backed
advisor answers questions in prose.

The design system — monochrome indigo, three typefaces, the motion rules — is
specified in [CLAUDE.md](CLAUDE.md), with `app/globals.css` as the source of
truth for tokens.

## Stack

**Frontend** — Next.js 14 (App Router), React 18, TypeScript, Tailwind,
`socket.io-client`. It holds no third-party credentials: the only variable it
reads is `NEXT_PUBLIC_API_URL`, and every catalogue, AI, upload and mail key
lives in the API.

**Backend** — Express 4, Mongoose 8 (MongoDB), Socket.io, JWT auth, bcrypt,
Helmet, `express-rate-limit`, Cloudinary, Nodemailer with a Resend fallback, and
`@google/genai` for the advisor (`@anthropic-ai/sdk` stays behind a provider
flag). Node 22–24, TypeScript throughout, run in development with `tsx`.

**Tests** — unit tests on `node:test` for the pure parts (similarity,
prediction, validation, email shaping, templates, device parsing, Cloudinary
helpers), plus the verify scripts in `backend/package.json`: `npm run verify`
and 17 `verify:*` scripts. Most drive the real Express app over HTTP — and over
sockets where messaging needs them — against an in-memory MongoDB, and
`verify:indexes` drives the index-creation script the same way. Two are not
self-contained tests: `verify:ai` calls the real model and costs money, and
`verify:account` marks accounts verified in whatever database `.env` points at.
There are no frontend tests and no CI configuration.

## What exists

### Accounts
- Email and password registration, bcrypt at 12 rounds.
- A JWT valid for 7 days, kept in `localStorage` and mirrored into a cookie so
  the Next middleware gate can route without reading it. The gate decodes
  without verifying; only the API verifies signatures, and it authorises nothing
  from the cookie.
- `tokenVersion` on the user: logging out or resetting a password invalidates
  every session already issued, not just the current browser.
- Email verification and password reset use 32-byte random tokens, stored as
  SHA-256 and checked with their expiry in the same query (24 hours and 1 hour).
- **Google OAuth runs in Express**, not in the browser. `GET /api/auth/google`
  redirects to Google; the callback exchanges the code, links or creates the
  account, and bounces to the frontend. The redirect URI is the API's origin,
  and both `/api/auth/google/callback` and `/api/auth/callback/google` are
  served so either registered spelling works.
- Onboarding is three screens: profile (required), avatar, taste. The advisor
  and messaging additionally require a verified address; browsing and rating do
  not.

### Catalogue
TMDB for films and series, IGDB for games, mapped server-side into one shape so
no component branches on the source. Trending, search and detail for all three.

### Ratings, reviews, watchlist
Ratings are per `(type, id)` and unique per user. Reviews carry likes and
replies, and are filtered by author visibility — a private account's review is
not served to someone who does not follow them. The watchlist supports
want/watching/finished.

### Follows
**Every follow is a request**, on public and private accounts alike;
`profileVisibility` decides who can see your content, not who may follow. Edges
live in their own collection with a `pending`/`accepted` status, counters are
kept alongside the writes, and declines are silent and reversible. Blocking is
separate and enforced in both directions. `services/social.ts` owns every
transition, so counters and notifications cannot drift between call sites.

### Messaging
One-to-one threads between people who follow each other mutually, over
Socket.io with per-user rooms. Messages are text, a photo, or a voice note
(`kind` is stored, never inferred). Editing is allowed for 48 hours.

Deletion has exactly two outcomes, and every bulk action is one of them applied
widely:
- **for me** — hidden for one viewer; the other copy is untouched.
- **for everyone** — a tombstone: content cleared, document kept. Sender only,
  inside 48 hours.

`DELETE /api/messages/:userId/history` applies those to a whole thread: "clear
for me", or "delete my recent messages", which retracts only your own messages
inside the window and reports how many were too old.

**Clearing for both people is a request the other person answers**, not a third
deletion rule. Acceptance runs the same two writes for both participants, with
the sender-only rule and the 48-hour window lifted because both agreed. The
cutoff is stamped when the request is made, so anything sent while it waits
survives. A partial unique index allows one pending request per thread; asking
is capped at 3 an hour and 5 a day per person per thread; declining is silent.
Accepted clears destroy the media on Cloudinary and cannot be undone.

Read receipts are a mutual per-user setting: turning them off stops you sending
them and stops you seeing them.

### Recommendations
A collaborative-filtering pipeline, not a single query:
- `UserStats` holds each user's rated items and mean rating.
- Similarity is Pearson with significance weighting, so a perfect correlation
  over 2 shared items is discounted against one over 40. Current settings:
  `beta 6`, `K 40`, minimum similarity `0.1`, minimum 3 co-rated items.
- `UserNeighbors` stores up to 80 neighbours per user; predictions use the top
  40 and need at least 3 neighbours who rated the item.
- `ItemPopularity` holds rater counts, mean ratings and inverse user frequency.
- The feed picks one of four strategies per request — `cold`, `seeded`,
  `hybrid`, `cf` — from how much data the viewer actually has, and caches the
  result in `FeedCache`. A new account gets a seeding grid instead of empty
  rails.

`scripts/computeNeighbors.ts` and `scripts/recomputePopularity.ts` rebuild the
neighbourhoods and popularity table. They are meant to run nightly; **nothing in
the API schedules them.**

### The advisor
Gemini behind an `AIProvider` interface — `backend/src/lib/ai/` is the only
place that names a vendor, and `AI_PROVIDER` selects. The model is pinned, never
a `-latest` alias.
- Ten turns of history are replayed from Mongo on each request.
- `[[Title]]` markers in the reply are resolved against the catalogue into links
  and up to three posters. Artwork is resolved, never generated.
- A spoken question is transcribed server-side and then treated as ordinary
  text.
- The daily allowance (`AI_FREE_DAILY_MESSAGES`, default 25) is taken *before*
  any model call and refunded on any failure. `isPro` exempts an account and is
  set by hand in the database.
- `GET /api/ai/picks` is TMDB discover filtered by the user's genres — no model
  call, because it renders on every home view.
- Without a key the advisor answers 503 rather than crashing.

### Media
Cloudinary, uploaded server-side from a base64 data URL on the JSON body. Images
cap at 5 MB, voice notes at 3 MB; audio duration is probed at upload rather than
trusted from the browser. Avatars use a deterministic id so a replacement
overwrites; message media does not, so a new photo never overwrites an older
one. Assets that cannot be destroyed are recorded to `orphaned-media.json` and
logged.

### Email
One module sends everything: **SMTP through Nodemailer** when the `SMTP_*`
variables are set, **Resend** as a fallback, and a logged no-op when neither is
configured — so signup works on a machine with no mail set up. Templates
(verification, welcome, password reset, login alert, new follower, new message)
share one responsive dark shell and all carry a plain-text part. Every
successful sign-in sends a login alert, SMTP only, to verified addresses only.
`POST /api/email/test` exists only when `NODE_ENV` is `development`.

## Layout

```
middleware.ts              auth gate; runs before any HTML is sent
app/
  (auth)/                  no chrome: signin, signup, onboarding, verify,
                           reset, and the Google callback
  (app)/                   everything behind the nav
    page.tsx               home
    movie|series|game/[id] one detail screen, three types
    ai/ messages/ notifications/ profile/ search/ settings/ watchlist/
components/                AppShell, TopNav, BottomNav, plus ai/ auth/ detail/
                           home/ messages/ notifications/ onboarding/ profile/
                           search/ ui/
lib/                       api client, socket, auth, catalog, ratings,
                           messages, users, notifications, feed, formatting
backend/
  src/
    app.ts index.ts        Express app and bootstrap
    config/                env, SMTP validation, messaging constants
    controllers/           auth, catalog, ratings, watchlist, users, messages,
                           notifications, feed, activity, ai, email
    models/                16 Mongoose models
    services/              tmdb, igdb, cloudinary, email, social, visibility,
                           rateLimit, stats, conversationPreview
    lib/ai/                provider interface, Gemini, prompt, clock
    lib/cf/                similarity, neighbours, candidates, prediction,
                           popularity, seeding
  scripts/                 index creation, migrations, verify scripts
```

## Running it

You need Node 22–24 and a MongoDB (local or Atlas). Transactions need a replica
set; against a standalone `mongod`, set `SUPPORTS_TRANSACTIONS=false`.

```bash
# API
cd backend
npm install
cp .env.example .env     # JWT_SECRET and MONGODB_URI are the only required values
npm run dev              # http://localhost:4000

# app, from the repo root
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env
npm run dev              # http://localhost:3000, and only 3000
```

Every integration is optional. Without TMDB or IGDB keys those catalogue routes
answer 503; without a Gemini key the advisor says it is not configured; without
Cloudinary, uploads are refused and text messaging still works; without mail,
emails become logged no-ops. The boot log prints which are live.

Indexes are built automatically outside production. In production they are not,
so a **new, empty database** needs `npm run db:indexes -- --apply` (from
`backend/`) before the API serves traffic, and nothing else. The four
`migrate-*` scripts in `backend/scripts/` are **not** needed on a fresh
database: they only apply to an existing database created before the
conversation pair key, and bring its data and indexes up to date. See
[DEPLOY.md](DEPLOY.md) for the deployment itself.

```bash
npm run typecheck                  # both packages have one
cd backend && npm test             # unit tests
cd backend && npm run verify       # auth end to end, in-memory MongoDB
cd backend && npm run verify:email # SMTP against a fake local server
```

## Deliberate seams

Three of these are the original seams, two of which changed shape when the
backend arrived; the rest have accumulated since.

- **`lib/contentTypes.ts` mirrors `backend/src/services/catalogTypes.ts`.** TMDB
  films, TMDB series and IGDB games arrive in one shape, so no component
  branches on source. Adding a catalogue means writing a mapper, not touching
  the UI. (The old `lib/tmdb.ts` mapping seam, moved server-side.)
- **`lib/ratings.ts` is the only module that calls the rating and watchlist
  endpoints**, and it broadcasts `LIBRARY_CHANGED` after every write, so rating
  a film on a detail page updates the poster badge on the grid behind it. (This
  replaced the `localStorage` seam; ratings are server-side now.)
- **`lib/homeFilters.ts` holds the filter vocabulary, and `lib/onboarding.ts`
  the genre and mood lists** — plain data outside the `'use client'` components,
  because importing an array out of a client module hands the server a client
  reference proxy.
- **`lib/socket.ts` owns one connection per tab.** A component-scoped socket
  would make one user look like several and multiply every broadcast.
- **`backend/src/lib/ai/` is the only place that knows which AI vendor is in
  use.** Nothing outside imports `./gemini` directly.
- **`services/social.ts` owns every follow transition**, and
  `services/conversationPreview.ts` is the only writer of a thread's per-viewer
  preview.

## Not built, and known gaps

- **No delete-account endpoint.** Accounts have only ever been removed by hand
  in the database, which leaves references behind. `scripts/cleanup-orphans.ts`
  repairs the wreckage; it is not the missing feature.
- **The advisor cannot link or illustrate games.** Title resolution searches
  TMDB only, so a game it recommends renders as a bare search link.
- **The advisor does not stream.** `stream()` exists on both providers; no route
  uses it.
- **No Watch Together, and no voice or video calls.** Socket.io carries messages,
  typing and notifications only. Voice notes are uploaded files, not live audio.
- **No payments and no paid tier.** `isPro` is a manual database flag that lifts
  the advisor's daily cap.
- **Two email templates are unused.** "Password changed" and "security alert"
  render but nothing sends them. The "manage email preferences" link in social
  emails points at `/settings`, which has no email controls — it offers private
  account, read receipts, account details and sign-out.
- **The inbox reads the newest 200 conversations**, sorted on a shared timestamp
  and then re-sorted per viewer. Above 200 threads a row can be ordered late;
  content, previews and unread counts are per-viewer and unaffected.
- **The Google callback puts a live session token in the URL**, which browser
  history and host access logs keep. A one-time exchange code is the intended
  fix.
- **The recommendation jobs are not scheduled** by anything in the API.
- **No frontend tests, and no CI.**
- **Velvet has not been deployed.** DEPLOY.md is a plan, not a record.
