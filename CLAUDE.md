# Velvet

Discover, rate and socially experience **films, series and games**. Next.js 14
App Router + TypeScript on the front, an Express + MongoDB API behind it, a
Gemini-powered advisor at its centre.

```bash
npm run dev        # http://localhost:3000
npm run build
npm run typecheck

cd backend && npm run dev   # http://localhost:4000
```

The frontend holds **no third-party secrets** — only `NEXT_PUBLIC_API_URL`.
Every catalogue, AI, upload and payment credential lives in `backend/.env`, and
the browser reaches all of them through the API.

---

# The design system: monochrome indigo

`app/globals.css` holds the tokens and the component classes; it is the source
of truth. `tailwind.config.ts` mirrors the same values so utility classes agree.
A colour that only exists in the Tailwind config is a colour outside the system.

## Colour

Real velvet is not two colours. It is one dye at three values — the nap catches
light by direction, so the same hue reads dark at the base of the pile and
bright where light lands. The whole palette is therefore **one hue**, varied
only in lightness and saturation.

That is also what makes it self-extending: a new component's colour is derived
by moving along the ramp, **never** by introducing a hue.

Five rules, in order of how easily they are broken:

1. **One hue only.** If a component needs emphasis, move along the value ramp.
2. **No glow.** No `text-shadow`, no coloured `box-shadow`. Elevation is black
   only: `0 20px 44px -18px rgba(0,0,0,.8)`.
3. **Posters are the only saturated thing on screen.** Nothing in the chrome
   may compete with them.
4. **Semantic colours are the sole exception**, and appear only in status
   contexts, never as decoration.
5. **Accent means interactive or important.** If an element is neither, it is
   `--v-text` or `--v-mist`.

The `--v-*` names below are canonical. The older names (`--bg`, `--accent`,
`--ink`, `--muted`…) remain as aliases mapped **by meaning**, so the component
classes did not have to be rewritten. Note `--ink`: it names the primary *text*
colour, not the background — `--v-ink` is the background. Matching those two on
name rather than meaning would invert the page.

### Ground — base of the pile

| Token | Hex | Use | Alias |
| --- | --- | --- | --- |
| `--v-ink` | `#07071A` | Page, deepest layer. | `--bg` |
| `--v-surface` | `#0D0E2A` | Cards, stat bar. | `--bg-raise` |
| `--v-nav` | `#12133A` | Navbar — one step lighter than surface. | — |
| `--v-raise` | `#181A48` | Hover, elevated panels, every form field. | `--bg-input` |
| `--v-sunk` | `#04040E` | Deepest inset. | `--bg-sunk` |
| `--v-hero-a` / `--v-hero-b` | `#171645` / `#07071A` | Hero gradient. | — |
| `--card` | `rgba(255,255,255,.032)` | Card and chip washes. | — |
| `--card-hover` | `rgba(255,255,255,.055)` | Their hover state. | — |

### Accent — where the light lands

| Token | Hex | Use | Alias |
| --- | --- | --- | --- |
| `--v-accent` | `#9691E0` | Active nav, buttons, links, stars, ripples, sent bubbles. | `--accent` |
| `--v-accent-hi` | `#CFCCF5` | Headline highlight, stat values, focus ring. | `--accent-bright` |
| `--v-accent-mid` | `#B1ADE8` | Derived step: hero italic. | `--accent-light` |
| `--v-accent-dim` | `#4C4890` | Hairlines, disabled, muted icons. | `--accent-deep` |
| `--v-on-accent` | `#050516` | **Text on any accent fill.** | `--on-accent` |

`--v-on-accent` is load-bearing. The accent is *light*, so a filled button takes
dark text. Putting `--white` on an accent fill — which is what the copper system
did — lands at 2.1:1 and is unreadable.

### Text

| Token | Hex | Use | Alias |
| --- | --- | --- | --- |
| `--v-display` | `#F0EEFA` | Headings, stat figures, names. Never `#FFF`. | `--white` / `--display` |
| `--v-text` | `#E0DEF2` | Primary copy, synopsis, received bubbles. | `--ink` / `--cream` / `--accent-pale` |
| `--v-mist-2` | `#9996B3` | Derived step: secondary labels, review body. | `--muted-2` |
| `--v-mist` | `#807DA1` | Meta, captions, placeholders. | `--muted` |
| `--v-faint` | `#55527A` | Tertiary, timestamps. | — |

`--v-mist` is `#807DA1`, not the `#77749B` the migration brief specified: same
hue and saturation, lightness lifted 53.1% → 56.1%. At the original value it
measured 4.27:1 on `--v-surface` and missed the 4.5:1 floor the brief itself
sets. Do not darken it back.

### Lines and semantic

`--v-line` (default borders) · `--line-soft` (hairlines, card borders) ·
`--line-strong` (primary button border) · `--v-line-solid` `#1E1F52` ·
`--line-accent` → `--v-accent-hi` (selected chip, focus ring).

`--v-accent-dim` appears structurally in exactly two places: the navbar's
bottom border and the top hairline on each stat cell. That is what makes the
layout read as built rather than stacked.

Semantic — status contexts only: `--v-success` `#5FBF95` · `--v-warning`
`#D8B45C` · `--v-danger` `#D9707A`.

### The permitted exceptions

Three, and no others.

The **semantic** colours above, and the **Google sign-in button**
(`.btn-google` plus the four `fill` values on the G in
`components/auth/GoogleButton.tsx`) — Google's branding requires their mark on
white, and a recoloured Google button reads as phishing. Both are requirements,
not decoration, so the one-hue rule does not reach them.

The third is the **direct-message thread**, which runs on six near-neutral
`--chat-*` tokens instead of the indigo ramp:

| Token | Hex | Use |
| --- | --- | --- |
| `--chat-bg` | `#0A0A0F` | The thread's scroll ground. |
| `--chat-surface` | `#16161F` | Incoming bubbles, composer field, inbox rows. |
| `--chat-surface-raised` | `#1F1F2B` | Header bar, hover, photo placeholder. |
| `--chat-border` | `rgba(255,255,255,.08)` | Hairlines. |
| `--chat-text` | `#EDEDF2` | Primary text, focus rings. |
| `--chat-text-muted` | `#8A8A9A` | Timestamps, placeholders, meta. |

Chat is the only surface in Velvet that stacks four planes in one column —
page, bubble, composer field, hover. On the indigo ramp those four sit close
enough in hue that nothing reads as figure against ground, and the screen goes
purple-on-purple. Every other screen stacks two or three and the ramp separates
them fine, which is why this exception does not generalise.

`--chat-accent` is still `--v-accent`, and on that screen the accent appears in
**exactly two places**: outgoing bubbles and the send button. Not the selected
inbox row, not the unread dot, not the incoming bubble's border, and not the
focus ring — all four used to, and all four now use `--chat-text`. If you add a
third accent use to the thread, you have broken the rule the palette exists to
serve.

These tokens are valid inside `.msg-shell` and nowhere else.

Composition happens through `rgba(var(--v-*-rgb), α)` — an alpha wash is still
a token and never a raw hue. Keep each `*-rgb` triple in step with its hex.

## Type

| Family | Role |
| --- | --- |
| **Inter** (`--font-ui`) | Everything structural: nav, body, meta, chips, buttons. Light 300 is the body default. |
| **DM Serif Display** (`--font-display`) | Editorial display: hero titles, screen titles, taglines. The italic is load-bearing. |
| **Barlow Condensed** (`--font-cond`) | Condensed caps and numerics: wordmark, section titles, stat figures, tabs, rank labels. |

## The signature gesture

A featured title splits in two: **first word upright in `--display`, the
remainder in the indigo DM Serif italic.**

```
The
Brutalist     ← italic, --v-accent-mid (--accent-light)
```

`splitTitle()` in `lib/format.ts` does this. Used by the home hero, the detail
hero and the editorial lead card. A single-word title goes wholly to the italic
rather than losing the two-tone.

## Motion — the rules that must not be broken

| Rule | Where it lives |
| --- | --- |
| Every button ripples indigo on click | `useRipple()` / `<RippleButton>` in `components/ui/Ripple.tsx`; host needs `.ripple-host` |
| Every section animates in on scroll (fade + rise) | `<Reveal>` in `components/ui/Reveal.tsx` |
| Cards lift on hover (−4 to −8px) | `.poster-card:hover`, `.select-card`, `.genre-card` |
| Posters carry a shine sweep | `.poster-shell::after` |
| Transitions run .2s–.35s on `--ease` | `--t-fast` / `--t-mid` / `--t-slow` |
| Inputs show an indigo focus ring | `.input:focus`, `:focus-visible` |
| Star ratings are always indigo | `.star.filled path` |
| Section numbers (01, 02…) in indigo | `.section-num` |
| Toasts: bottom right, dark card, indigo dot | `components/Toast.tsx` |
| Loading states are indigo shimmer skeletons | `.skeleton`, `components/ui/States.tsx` |
| Empty states: friendly message + indigo CTA | `<EmptyState>` |

`@media (prefers-reduced-motion: reduce)` collapses all of it at the end of
`globals.css`. `useRipple` and `Reveal` also check the query in JS, because a
0.01ms animation doesn't reliably fire `animationend`.

## Layout

- Content runs **full width** — `--col: 100%`, gutter `--gutter: 32px` (18px on
  phones). Every container caps at `var(--col)`, so that one token governs the
  nav, hero, stat strip and all sections; there is no second place to change.
  The gutter is the only thing holding text off the screen edge, so a section
  that opts out of `.app-content` must supply its own.
- Fixed top nav, `--nav-h: 76px` (60px on phones). `.app-main` pads for it.
- Corners are **small**: 4–6px on panels, 100px on pills. No 14–20px radii.
- Buttons: `.btn-fill` is the one solid indigo CTA; `.btn-primary` /
  `.btn-secondary` / `.btn-outline` are outlined.
- Below 900px the nav links collapse and `BottomNav` takes over.

## Navigation

`components/navItems.tsx` is the single source. `PRIMARY_NAV` is Home, Search,
Movies, Series, Games, AI Advisor (with a `New` badge), Messages. The right side
of the nav carries the search pill, notification bell, messages and the avatar
menu.

Movies / Series / Games have no routes — they set `?filter=` on the home
screen, the same state the tab row drives, so nav and tabs always agree.

---

# Architecture

```
middleware.ts           the auth gate — runs before any HTML is sent
app/
  layout.tsx            root: fonts + providers ONLY. No nav.
  globals.css           the design system — read before styling anything
  (auth)/               no chrome at all; layout renders bare
    layout.tsx
    signin/ signup/     the 55/45 split screen
    onboarding/         layout.tsx + profile/ avatar/ taste/
    auth/callback/      where Google returns; stores the JWT and routes on
    verify-email/ forgot-password/ reset-password/
  (app)/                everything behind the nav — authed only
    layout.tsx          renders <AppShell>: TopNav, banner, BottomNav
    page.tsx            home shell → components/home/HomeScreen
    movie|series|game/[id]  one DetailScreen, three types
    ai/                 the advisor
    messages/[userId]/  inbox + thread
    profile/[username]/ public profile; profile/edit
    watchlist/ search/ notifications/ settings/
components/
  AppShell TopNav BottomNav PosterCard Toast icons navItems
  ui/       Ripple Reveal Avatar States
  auth/     AuthProvider ProtectedRoute GoogleButton VerifyBanner VerifyGate
  onboarding/ home/ ai/ messages/ detail/ profile/ search/ notifications/
lib/
  api.ts          fetch client, token, 401 teardown, multipart upload
  socket.ts       the one Socket.io connection (messages + notifications)
  contentTypes.ts the shapes the UI consumes — mirrors backend catalogTypes.ts
  authTypes.ts    AuthUser, PublicProfile, onboarding + profile inputs
  auth.ts         verification, password reset, the Google handoff URL
  catalog.ts ai.ts messages.ts users.ts ratings.ts
  onboarding.ts   genres, moods, genders (plain data, server-importable)
  homeFilters.ts  filter/sort vocabulary
  format.ts       formatScore, splitTitle, timeAgo, stars, compactCount
```

## Auth

There is **one session mechanism**: a JWT in localStorage, sent as
`Authorization: Bearer`. Everything funnels into it.

**Everything is gated, in `middleware.ts`, before any HTML is sent.** Only
`/signin`, `/signup`, `/auth/*`, `/verify-email`, `/forgot-password` and
`/reset-password` are public. An unauthenticated visitor never sees the app
shell — not for a frame. Deep links survive: the gate puts the attempted path in
`?next=` and the sign-in form returns you there.

The nav is **not** in the root layout. It belongs to `(app)/layout.tsx`, so a
screen with no chrome is one that lives in `(auth)` — there is no list of "bare
routes" to keep in step, and the nav cannot leak onto a sign-in page.

**How middleware sees a localStorage session.** It can't. `setToken`/`clearToken`
mirror the JWT into a `velvet.session` cookie, plus `velvet.onboarded` carrying
the step number (`lib/sessionCookie.ts`). `verifySession` **decodes without
verifying** — the signing secret must never reach the frontend, and it need not,
because *nothing is authorised on that decision*. The Express API verifies the
signature on every request. Never move an authorisation check into middleware.

Onboarding is three routes. Step 1 (`profile`) is required and flips
`onboardingCompleted`; steps 2 and 3 are skippable. The gate keys its "you're
done, stay out" rule on `onboardingStep >= 3`, **not** on `onboardingCompleted` —
that flag flips at step 1, so keying on it would redirect users home mid-flow.

- **Google OAuth runs in Express, not the frontend.** `GET /api/auth/google`
  redirects to Google; `/api/auth/google/callback` exchanges the code, resolves
  or creates the account, and bounces to `/auth/callback?token=…`, which stores
  the JWT like any other login. `next-auth` was considered and rejected: it puts
  the client secret in the browser bundle, opens a second Mongo connection that
  skips the Mongoose models, and issues a **cookie** session the Express API
  cannot read — so every API call after a Google login would 401.
- The redirect URI registered with Google is the **API's** origin
  (`{API_URL}/api/auth/google/callback`), not the frontend's.
- A Google profile resolves in three steps: known `googleId` → sign in; known
  email → link the id and sign in; neither → create, already verified, with a
  handle derived from the address.
- **Credential tokens are stored hashed** (SHA-256) and the raw value only ever
  exists in the email. `passwordHash` and all four token fields are
  `select: false` *and* deleted in the `toJSON` transform.
- `emailVerified` gates the advisor and messaging via `requireVerified`, which
  reads the flag from the database rather than the JWT — a token lives seven
  days and a user who verifies must not have to sign out for the app to notice.
  Browsing, rating and onboarding stay open.
- Registration emails the link at **step 2** of onboarding but does not redirect
  there: steps 3–6 collect the taste profile the advisor cannot work without.
  `StepReady` carries the prompt, `VerifyBanner` carries it thereafter.

Email lives in `backend/src/services/email.ts` (Resend) — five templates sharing
one dark-indigo shell. `send()` never throws and no-ops with a log when
`RESEND_API_KEY` is absent, so signup works on a machine with no mail set up.
The two notification emails hang off `notify()`, the funnel every follow and
message already passes through, and only ever go to **verified** addresses.

Seams worth preserving:

- **`lib/contentTypes.ts` mirrors `backend/src/services/catalogTypes.ts`.**
  TMDB films, TMDB series and IGDB games all arrive in one shape, so no
  component branches on source. If a field moves there, move it here.
- **`lib/ratings.ts` is the only module that talks to the rating and watchlist
  endpoints.** It broadcasts `LIBRARY_CHANGED` after every write, so rating a
  film on a detail page updates the poster badge on the grid behind it. Use
  `onLibraryChange(handler)` — it fires once immediately, then on each change.
- **`lib/onboarding.ts` holds the genre/mood vocabulary, not the step
  components.** Those are `'use client'`; importing plain data out of a client
  module hands the server a client reference proxy, which throws at request
  time rather than build time.
- **`lib/socket.ts` owns one connection per tab.** A component-scoped socket
  would make one user look like several to the presence tracker and multiply
  every broadcast.

## The follow graph

**Every follow is a request.** Pressing Follow asks; it does not connect. There
is no public/private branch on that — `profileVisibility` governs who may *see*
your content, not who may follow, and a target's setting never decides whether
approval is needed. A single rule is why the button has three states everywhere
instead of three states on some profiles and two on others.

The edges live in their own collection (`Follow`), not in arrays on the user.
An array can hold a member but not a *state*, and this needs `pending`; it also
grows a popular account's document without bound, so their profile read drags
their whole follower list along. `User.followers` / `following` survive as
**confirmed-only mirrors** maintained beside the edge writes, because existing
feed and messaging code reads them.

```
POST   /api/users/:id/follow-request   → { status: 'requested' | 'following' }
POST   /api/users/:id/accept-follow    → { status: 'following' }
POST   /api/users/:id/decline-follow   → { status: 'declined' }
DELETE /api/users/:id/follow           → { status: 'not_following' }
GET    /api/users/me/follow-requests   → { requests, total, nextCursor }
```

`:id` is always **the other person** — on accept and decline it names the
requester, and the recipient comes from the session. There is no id a caller can
supply that makes them the target of someone else's request.
`POST /api/users/:id/follow` and `/api/follow-requests/:id/accept|decline`
predate this and still work; the latter pair is addressed by *edge* id, which is
what lets a notification card resolve the exact request it was raised for rather
than the newest one from that person.

- **`services/social.ts` owns every transition.** Controllers validate and
  translate errors; they never write an edge, a counter or a notification
  themselves. Two implementations of "accept a follow" is two sets of counters
  to drift, which is what `notificationController` used to be.
- **`createFollow` raises its own notification, inside the edge's
  transaction.** A controller that also called `notify()` counted the row twice
  and left the bell permanently one ahead of the list.
- **All four writes are idempotent.** A double-tapped Follow reports the current
  state as a success, and cancelling twice still answers `not_following` —
  ending up in the state you asked for is what the user meant.
- **Counters are denormalized and `$inc`d beside every edge write.**
  `countDocuments()` on render gets slow exactly when an account gets popular.
  `followerCount` counts **accepted edges only**: showing a pending request as a
  follower would leak that someone asked. `scripts/reconcileCounters.ts` repairs
  drift.
- **A decline is silent and reversible.** The requester is never told — saying
  so is hostile and creates pressure to ask again — and the edge is deleted so
  they may ask later. The `FollowRequest` document is kept as history. Stopping
  someone permanently is what blocking is for.
- **Cancelling deletes the recipient's notification; declining keeps it**,
  marked `actionState: 'declined'`. A withdrawn request must leave nothing to
  act on, but a card the user just answered has to stay where their finger was.
- **`withPairWrite` serializes a pair's transitions** so the flow is correct on
  standalone Mongo, where `SUPPORTS_TRANSACTIONS=false` and `withTxn` is a
  passthrough.

On the client, `lib/users.ts` and `lib/notifications.ts` are the only modules
that call these routes, and both announce through `lib/socialEvents.ts` after a
write. `onNotificationsChange` is what keeps the navbar bell honest when a
request is answered somewhere else on the page — without a subscriber the badge
only corrects itself on the next poll.

The queue lives on **its own screen**, `/notifications/requests`, reached from a
single collapsed row at the top of `/notifications` and from your own profile.
A request is the one notification that is a task, and a queue of twelve inlined
above the feed buries everything else on the page rather than surfacing itself.
`FollowRequests.tsx` exports both halves — `FollowRequestsSummary` for the row
and `FollowRequestsList` for the screen — over **one hook**, so the row's count
and the screen's list cannot disagree about how many are waiting.

The feed still renders its own card per request, with the same Accept and
Decline: `aggregate.ts` never collapses `follow_request` into a group, because
that would hide an action behind a tap. Both surfaces resolve through the same
endpoint, so whichever is used the other settles from the server.
`verify:follow` covers the whole flow against a real database.

## Messaging

The thread is four components, not one. `Thread` owns data, sockets and scroll;
`MessageGroup` owns everything that appears once per *turn* rather than once per
message; `Composer` owns input and attachment; `VoiceNote` owns playback.
`lib/messageGroups.ts` holds the grouping rules as plain data so they are
testable without a renderer — in a flat map over messages, "one avatar per
group" degenerates into index arithmetic.

- **Consecutive messages from one sender within 5 minutes are one group.** A
  group also breaks on a calendar-day change, which is not redundant: two
  messages four minutes apart can still straddle midnight, and without the check
  the date divider lands *inside* a group instead of between two.
- **Avatar, sender name and timestamp render once per group**, and the avatar
  aligns to the group's *last* message. Every other incoming row reserves its
  width so the bubbles above stay flush instead of stepping left.
- **Corner radii carry the grouping**: 16px on the outer corners of the leading
  and trailing bubbles, 4px where bubbles meet. That is what makes a stack read
  as one utterance rather than three unrelated cards.
- **`.bubble` dimming must use `filter`, not `opacity`.** `.bubble` runs `msgIn`
  with `fill-mode: both`, so the animation's final `opacity: 1` persists and
  outranks any normal `opacity` declaration — a plain `opacity: .6` on a failed
  bubble computes to 1 and never dims.
- **A failed send keeps its place** at 60%, with a retry beneath it. It is never
  removed from the list.
- **The DM composer is `.chat-*`, the advisor's is `.composer`.** They were one
  set of rules and are now two, deliberately: the two screens have different
  measures and different chrome, and sharing meant every DM change silently
  restyled the advisor.

A message is **text, a photo or a voice note** — `kind` on the `Message` model
says which, and it is stored rather than inferred. A renderer that branches on
`mediaUrl != null` cannot tell a photo from a recording, and every kind added
later makes that guess worse.

Media is uploaded to Cloudinary and only the URL is stored; Mongo holds the
record of the conversation, never the bytes. Both paths travel as a **base64
data URL on the JSON body**, the same transport `POST /api/users/me/photo`
already uses — no multipart dependency, and the payload is pattern-checked
before a byte reaches Cloudinary.

- **The media data URL must never go through `clean()`.** `sanitizeText` strips
  `data:` as an active URI scheme, which is right for prose and fatal here: it
  would empty every upload before it was read. Only the text branch is
  user-authored prose, so only it is sanitised.
- **Voice notes upload with `resource_type: 'video'`.** Cloudinary has no
  separate audio bucket. As `'raw'` the bytes store but the duration and the
  streaming URL are both lost.
- **`mediaDuration` is measured server-side, not claimed by the client.** A
  MediaRecorder webm carries no duration in its header, so the browser reads
  `audio.duration` as `Infinity` until the clip is played through. Cloudinary
  probes the file at upload, and that number is what the player trusts.
- **Message media gets no deterministic `public_id`.** Avatars do, so a
  replacement overwrites in place — doing the same here would make each new
  photo silently overwrite the last one in the thread.
- **The mutual-follow gate and the rate limit both run before the upload.** A
  check that runs afterwards has already paid for the request it was meant to
  prevent. Attachments are capped per user (20/min, 200/hour) while text is
  not: text costs a document, media costs storage and egress on an account with
  no revenue behind it — the same reasoning that makes `AI_FREE_DAILY_MESSAGES`
  load-bearing.
- **`previewFor()` supplies the inbox row and the email preview.** A media
  message has no text, so without it the inbox renders a blank row.
- Recording needs a **secure context** — `getUserMedia` is unavailable on plain
  http outside localhost. The composer hides the mic where it cannot work
  rather than offering a dead button.

### Deleting, and clearing

Deletion has exactly **two** outcomes, and everything else is a bulk
application of them — never a third rule:

- **for me** sets `deletedFor[]`, per viewer. The other copy is untouched and
  the other person is told nothing.
- **for everyone** tombstones: `deletedForEveryone`, content fields cleared,
  the document kept so counters and cached lists stay coherent. Sender only,
  and only inside `DELETE_WINDOW_MS` (48h).

`DELETE /api/messages/:userId/history` applies those two to a whole
conversation. It reuses the same predicates, the same window and the same
`recomputePreview` / `releaseThreadUnread` / `retractMessage` helpers — there is
no second implementation of "what deletion means", and adding one is how the two
paths start disagreeing about what a thread looks like afterwards.

- **The second scope is called "Delete my recent messages", not "clear for
  everyone".** It retracts only what *I* sent, inside the window, so it
  routinely leaves most of the thread standing. A label promising an empty
  conversation and delivering a thinned one is a broken promise discovered
  *after* the irreversible step, and no explanatory copy underneath rescues it.
  The name states the outcome; the note states the limits.
- **The response carries `{ cleared, retracted, skippedTooOld }` and the UI says
  so** — "12 messages deleted, 3 too old". A silent partial reads as a bug, or
  worse, as older messages having gone when they have not.
- **Clear-for-me leaves Cloudinary alone.** The other person still has the
  message, so the asset is still in use. Clear-for-everyone destroys the media,
  throttled at concurrency 4 *after* the response — a stranded asset is a
  sweep-up job, a clear that 500s because Cloudinary was slow is a thread the
  user was told they could not tidy.
- **The notification card is retracted once, not once per message**, because
  message notifications dedupe to one card per sender.
- Every socket event through `emitEach` carries **`withUserId`**, the other
  participant from that recipient's point of view. The per-message events can
  reconcile by `messageId` and ignore it; a clear has no message id, and the
  open thread is keyed by the other person rather than by `conversationId`.
- **The thread reloads rather than patching** after a clear. A bulk change is
  the one case where replaying it into local state means re-deriving, on the
  client, exactly the rules the server has just finished applying.

**Known limit — the inbox reads the newest 200 conversations.** `conversations`
sorts in Mongo on the shared `lastMessageAt`, then **re-sorts in JS** on the
per-viewer `lastFor` time, because a Map field cannot be indexed for a sort and
every row displays the per-viewer value. Clearing makes the gap between the two
visible, which is why the re-sort exists. The `.limit(200)` is still on the
shared field: in principle a viewer with more than 200 threads could have one
whose per-viewer time would have placed it on screen dropped before the re-sort
runs. It is a **safe upper bound, not a correctness hole**: reaching it needs
more than 200 conversations *and* enough clearing that a thread's per-viewer
time outranks 200 shared ones, and the failure is a row ordered late or missing
from an already-overfull list — never wrong content, a wrong preview or a wrong
unread count, all of which are computed per viewer. Fixing it means storing a
sortable per-viewer timestamp, which is a schema change with no user behind it
yet. Do not rediscover this as a bug.

`npm run verify:clear` covers both scopes against a real database — including a
message backdated past the window, which cannot be created over the API.

## Conventions

- Server components by default; `'use client'` where state, storage or the
  socket is needed. Anything reading `useSearchParams` needs a `Suspense`
  boundary.
- Scores always render through `formatScore()` — one decimal everywhere, so
  `8` must not print as `8`.
- Stats show **real figures**. `0` is a real value and prints as `0`; the `—`
  placeholder is only for values that genuinely don't exist yet. Never
  substitute the mockup's demo numbers (247 / 618 / 3.8).
- Detail links always go through `hrefFor(type, id)` — routes are per-type.
- `contentId` is a **string** throughout; TMDB and IGDB ids only coincide by
  accident, so the real key is the `(type, id)` pair.
- Optimistic writes (save, follow, like) roll back on failure and say so.
- Every integration degrades honestly: a missing Gemini key gives the
  advisor a "not configured" state, not a crash.

## Removed

**Watch Together is gone** — no rooms, no Agora, no playback sync. Socket.io
remains, scoped to messaging and notification pushes only: it carries message
records and typing state, never a media stream. Messages themselves may be
text, a photo or a voice note (see **Messaging** above), but that media is an
uploaded file with a URL, not a live connection — **there are no voice or video
calls**, and adding them would mean reintroducing the WebRTC/TURN infrastructure
this decision removed. Its replacement
as the social heart of the product is the AI Advisor.

**Payments are gone** — no Stripe, no checkout, no `/pro` page, no paid tier.
**Velvet is free.** Never reintroduce an upsell, a pricing page or a "Go Pro"
affordance.

`isPro` survives on the user model, but only as a flag set by hand in the
database to lift the advisor's daily cap for the operator or a trusted account.
It is not purchasable and nothing in the UI offers it.

That makes `AI_FREE_DAILY_MESSAGES` (default 25, in
`backend/src/config/env.ts`) load-bearing: with no revenue, it is the only bound
on what the model costs the person running the server. Raising it or exempting
more accounts spends real money. A **voice** question costs two calls, not one —
transcription then the answer — while still consuming one message of the
allowance.

---

# The advisor

**Gemini, behind a provider interface.** `backend/src/lib/ai/` is the only place
that knows a vendor exists:

```
lib/ai/
  provider.ts   AIProvider, the typed errors, retry/backoff, the cost log line
  advisor.ts    the prompt, [[Title]] extraction, follow-up chips — no vendor
  gemini.ts     the live provider
  anthropic.ts  retained behind the flag so the two can be diffed
  index.ts      selection + askAdvisor(); the ONLY module anything imports
```

Nothing outside that directory may import `./gemini` or `./anthropic` directly —
that is what turns a provider swap back into a code change. `AI_PROVIDER`
(`gemini` | `anthropic`, default `gemini`) chooses; anything unrecognised
resolves to Gemini rather than silently falling back to the retired provider.

- **Model is pinned, never a `-latest` alias** (`GEMINI_MODEL`, default
  `gemini-3.6-flash`). An alias moves the model under a running deployment and
  the first sign is changed answers.
- **`thinkingLevel: MINIMAL`.** Reasoning tokens bill at the output rate, and a
  200-word recommendation does not need deliberation. Thinking tokens are still
  added to the output count in the log so the cost line stays honest.
- **Safety thresholds are `OFF` on all four adjustable categories.** Velvet is
  about films and games; the defaults block on horror synopses, violent games
  and the plot of any crime film. `OFF` is one step past `BLOCK_NONE`.
- **A refusal is an outcome, not an error.** `AiBlockedError` → 422 with an
  `AI_BLOCKED:` marker, never a 500. It covers the whole blocking family —
  `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII` — not just
  `SAFETY`, and a prompt rejected before generation counts too.
- **`generateContent`, not the Interactions API.** Conversation history already
  lives in Mongo (`AIChatMessage`, ten turns replayed by the controller), so
  server-side state via `previous_interaction_id` would put history in two
  places.
- **Nothing streams.** `POST /api/ai/chat` is one request/response.
  `AIProvider.stream()` is implemented for both providers but no route uses it.
- **There is no JSON parsed out of prose.** `extractTitles` reads `[[Title]]`
  markers from prose the chat renders inline; it is not fence-stripping and must
  not be "upgraded" to `responseSchema`, which would change the reply into a
  shape the UI cannot render and `linkTitles` cannot rewrite. `ChatOptions.json`
  + `schema` exist for any future caller that genuinely wants structured output.
- **The taste profile carries behaviour, not just declarations.** Alongside the
  onboarding answers the prompt gets what the user actually rated: loved and
  **disliked** titles with their scores, observed genre counts, the split across
  films/series/games, the watchlist, and anything part-way through. The dislikes
  are the half that was missing — without them the model can only argue from
  enthusiasm and will recommend the thing the user already told us they hated.
  Each line is **omitted when empty** rather than printed as "none yet": an
  absent line reads as no data, a present-but-empty one invites the model to
  remark on the absence. `signals()` in `advisor.ts` owns both the data and the
  instructions for using it, because a list of dislikes with no instruction is
  just more titles to recommend.
- **The advisor is told the date, and told to trust it.** `lib/ai/clock.ts`
  writes the weekday, full date and time into the system prompt, resolved in
  the **browser's** IANA zone (sent as `timeZone` on every turn), because the
  server's clock is a deployment detail and a UTC host puts a user in Istanbul
  a day out for most of the evening. Without it every "what's out now" is
  answered against the training cutoff with nothing in the reply to say so. An
  unrecognised zone falls back to UTC rather than throwing.
- **A spoken question becomes text at the edge.** `POST /api/ai/chat` accepts
  `{ kind: 'audio', media }` and transcribes it via `provider.transcribe`, so
  history replay, `[[Title]]` extraction, the follow-up chips and the stored
  turn all see an ordinary text turn. `transcribe` is optional on `AIProvider` —
  Anthropic has no audio input and omits it, and `supportsVoice` is what lets
  the UI hide the microphone instead of offering a button that can only fail.
- **The allowance is taken before any model call, and refunded on failure.**
  It used to be taken *after* transcription, so a clip with no speech cost the
  user nothing — true, and it also meant the quota bounded nothing at all for
  audio: anyone past their daily limit could keep posting clips, each paying
  for a full transcription and *then* getting a 429. With open signup that is
  an unbounded bill. A spend gate that runs after the spend is not a gate.
  The nicety is preserved by refunding instead, and the refund covers **every**
  failure past the point of charging — transcription throwing or timing out,
  Gemini unreachable, a safety refusal, the write failing — not just the silent
  clip, because a Gemini outage must not quietly cost every user a message per
  attempt. `verify:quota` holds that line.
- **The advisor attaches artwork, and never generates it.** A reply carries up
  to three posters on its own `media` array — resolved, not drawn. `linkTitles`
  already searches the catalogue for every `[[Title]]` marker to build the
  links, and `posterUrl` is a field of that same response, so this costs **no
  model call and no extra catalogue call**. A title that does not resolve, or
  resolves to a row with no poster, contributes nothing and the prose stands on
  its own; nothing ever invents a URL. Its own array rather than markers in the
  prose, because the text may stream one day and this cannot — it needs the
  finished reply to know which titles were named. Rendered `unoptimized`: these
  are TMDB CDN URLs, already sized and cached by TMDB, and routing them through
  next/image would bill the transformation and the bandwidth to us for artwork
  somebody else already serves well. Direct-message photos keep the optimiser —
  those are ours, on Cloudinary, at arbitrary camera-roll sizes.
- **KNOWN GAP: games do not resolve in the advisor.** `linkTitles` calls
  `tmdb.search(title, 'all')`, which returns films and series only. A
  `[[Cyberpunk 2077]]` marker therefore gets no link **and no poster** — it
  renders as a bare search link. This predates the artwork work and is not
  caused by it. Fixing it means adding an IGDB lookup to the resolution path and
  deciding how to pick between a TMDB and an IGDB hit for the same string; until
  someone does, the advisor can recommend a game in prose but cannot link or
  illustrate one.
- **`/api/ai/picks` is not a model call** and never should be — it renders on
  every home view. It is TMDB discover filtered by the user's genres.
