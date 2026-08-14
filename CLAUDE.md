# Velvet

Discover, rate and socially experience **films, series and games**. Next.js 14
App Router + TypeScript on the front, an Express + MongoDB API behind it, a
Claude-powered advisor at its centre.

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

Two, and no others. The **semantic** colours above, and the **Google sign-in
button** (`.btn-google` plus the four `fill` values on the G in
`components/auth/GoogleButton.tsx`) — Google's branding requires their mark on
white, and a recoloured Google button reads as phishing. Both are requirements,
not decoration, so the one-hue rule does not reach them.

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
- Every integration degrades honestly: a missing Anthropic key gives the
  advisor a "not configured" state, not a crash.

## Removed

**Watch Together is gone** — no rooms, no Agora, no playback sync. Socket.io
remains, scoped to text messaging and notification pushes only. Its replacement
as the social heart of the product is the AI Advisor.

**Payments are gone** — no Stripe, no checkout, no `/pro` page, no paid tier.
**Velvet is free.** Never reintroduce an upsell, a pricing page or a "Go Pro"
affordance.

`isPro` survives on the user model, but only as a flag set by hand in the
database to lift the advisor's daily cap for the operator or a trusted account.
It is not purchasable and nothing in the UI offers it.

That makes `AI_FREE_DAILY_MESSAGES` (default 10, in
`backend/src/controllers/aiController.ts`) load-bearing: with no revenue, it is
the only bound on what the model costs the person running the server. Raising it
or exempting more accounts spends real money.
