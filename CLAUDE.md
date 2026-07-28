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

# The design system: Obsidian + Copper

`app/globals.css` holds the tokens and the component classes; it is the source
of truth. `tailwind.config.ts` mirrors the same values so utility classes agree.
A colour that only exists in the Tailwind config is a colour outside the system.

## Colour

Everything sits on a warm obsidian base with exactly **one accent hue**: burnt
copper. Never introduce a second accent, never a cold blue-black, and **never a
white background**.

### Surfaces

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#0C0A08` | Page. Warm obsidian. |
| `--bg-raise` | `#14100C` | Raised blocks, menus, modals, auth cards. |
| `--bg-sunk` | `#080604` | Deepest inset. |
| `--bg-input` | `#1A1610` | Every form field, chat composer and AI bubble. |
| `--card` | `rgba(255,255,255,.032)` | Card and chip washes. |
| `--card-hover` | `rgba(255,255,255,.055)` | Their hover state. |

### Copper ramp

| Token | Hex | Use |
| --- | --- | --- |
| `--accent` | `#C8691A` | Brand core: section numbers, active chips, filled buttons, ripples, sent bubbles, stars. |
| `--accent-bright` | `#E08840` | Scores, hovers, section links, stat deltas. |
| `--accent-light` | `#EAA568` | Hero italic, active nav. |
| `--accent-pale` / `--cream` | `#E8C49A` | Body copy on dark, synopsis, received bubbles. |
| `--accent-deep` | `#8F4A12` | Pressed states, gradient ends. |

### Text

| Token | Hex | Use |
| --- | --- | --- |
| `--white` / `--display` | `#F5F0EA` | Headings, stat figures, names. A warm off-white — never `#FFF`. |
| `--ink` | `#E8C49A` | Primary UI labels and body. |
| `--muted` | `#8A7360` | Meta, captions, placeholders. |
| `--muted-2` | `#B09578` | Secondary labels, review body. |

### Lines

`--line` (default borders) · `--line-soft` (hairlines, card borders) ·
`--line-strong` (primary button border) · `--line-accent` (selected chip, focus
ring).

## Type

| Family | Role |
| --- | --- |
| **Inter** (`--font-ui`) | Everything structural: nav, body, meta, chips, buttons. Light 300 is the body default. |
| **DM Serif Display** (`--font-display`) | Editorial display: hero titles, screen titles, taglines. The italic is load-bearing. |
| **Barlow Condensed** (`--font-cond`) | Condensed caps and numerics: wordmark, section titles, stat figures, tabs, rank labels. |

## The signature gesture

A featured title splits in two: **first word upright in `--display`, the
remainder in the copper DM Serif italic.**

```
The
Brutalist     ← italic, --accent-light
```

`splitTitle()` in `lib/format.ts` does this. Used by the home hero, the detail
hero and the editorial lead card. A single-word title goes wholly to the italic
rather than losing the two-tone.

## Motion — the rules that must not be broken

| Rule | Where it lives |
| --- | --- |
| Every button ripples copper on click | `useRipple()` / `<RippleButton>` in `components/ui/Ripple.tsx`; host needs `.ripple-host` |
| Every section animates in on scroll (fade + rise) | `<Reveal>` in `components/ui/Reveal.tsx` |
| Cards lift on hover (−4 to −8px) | `.poster-card:hover`, `.select-card`, `.genre-card` |
| Posters carry a shine sweep | `.poster-shell::after` |
| Transitions run .2s–.35s on `--ease` | `--t-fast` / `--t-mid` / `--t-slow` |
| Inputs show a copper border on focus | `.input:focus` |
| Star ratings are always copper | `.star.filled path` |
| Section numbers (01, 02…) in copper | `.section-num` |
| Toasts: bottom right, dark card, copper dot | `components/Toast.tsx` |
| Loading states are copper shimmer skeletons | `.skeleton`, `components/ui/States.tsx` |
| Empty states: friendly message + copper CTA | `<EmptyState>` |

`@media (prefers-reduced-motion: reduce)` collapses all of it at the end of
`globals.css`. `useRipple` and `Reveal` also check the query in JS, because a
0.01ms animation doesn't reliably fire `animationend`.

## Layout

- Content column `--col: 1320px`, gutter `--gutter: 32px` (18px on phones).
- Fixed top nav, `--nav-h: 76px` (60px on phones). `.app-main` pads for it.
- Corners are **small**: 4–6px on panels, 100px on pills. No 14–20px radii.
- Buttons: `.btn-fill` is the one solid copper CTA; `.btn-primary` /
  `.btn-secondary` / `.btn-outline` are outlined.
- Below 900px the nav links collapse and `BottomNav` takes over.

## Navigation

`components/navItems.tsx` is the single source. `PRIMARY_NAV` is Home, Search,
Movies, Series, Games, AI Advisor (with a `New` badge), Messages. The right side
of the nav carries the search pill, notification bell, messages, the Pro pill
and the avatar menu.

Movies / Series / Games have no routes — they set `?filter=` on the home
screen, the same state the tab row drives, so nav and tabs always agree.

---

# Architecture

```
app/
  layout.tsx            fonts + auth + toast providers + AppShell
  globals.css           the design system — read before styling anything
  page.tsx              home shell → components/home/HomeScreen
  onboarding/           the six-step first-run flow
  movie|series|game/[id]  one DetailScreen, three types
  ai/                   the advisor
  messages/[userId]/    inbox + thread
  profile/[username]/   public profile; profile/edit
  watchlist/ search/ notifications/ settings/ pro/
components/
  AppShell TopNav BottomNav PosterCard Toast icons navItems
  ui/       Ripple Reveal Avatar States
  onboarding/ home/ ai/ messages/ detail/ profile/ search/ notifications/
lib/
  api.ts          fetch client, token, 401 teardown, multipart upload
  socket.ts       the one Socket.io connection (messages + notifications)
  contentTypes.ts the shapes the UI consumes — mirrors backend catalogTypes.ts
  authTypes.ts    AuthUser, PublicProfile, onboarding + profile inputs
  catalog.ts ai.ts messages.ts users.ts ratings.ts
  onboarding.ts   genres, moods, genders (plain data, server-importable)
  homeFilters.ts  filter/sort vocabulary
  format.ts       formatScore, splitTitle, timeAgo, stars, compactCount
```

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
