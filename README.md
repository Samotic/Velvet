# Velvet

A movie rating app. Discover films, rate them out of five, write reviews, and
build a watchlist — in the Velvet design language: warm amber on near-black,
Inter + DM Serif Display + Barlow Condensed, editorial hero type.

The look is taken from `velvet-animated.pdf`. Colours and font families were
sampled out of that file's PDF content stream rather than eyeballed, so the
palette below is exact. The full spec — every token, what it's for, and the
rules for extending it — lives in [CLAUDE.md](CLAUDE.md).

| | |
| --- | --- |
| Accent | `#FF8621` core, ramping to `#FFD092` |
| Surface | `#0C0A08` |
| Display text | `#A19E9A` (a soft warm grey — nothing is pure white) |
| Type | Inter · DM Serif Display · Barlow Condensed |

## Getting started

```bash
npm install
```

Add a TMDB credential to `.env` (or `.env.local`) in the project root:

```
TMDB_READ_TOKEN=your_v4_read_access_token
```

Get one free at [themoviedb.org](https://www.themoviedb.org/settings/api) →
**Settings → API → API Read Access Token**. A v3 `TMDB_API_KEY=` works too; if
both are set the read token wins.

Neither variable is prefixed `NEXT_PUBLIC_`, so the credential stays server-side
and never ships to the browser.

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run typecheck
```

Without a key the app still runs — every screen shows setup instructions
instead of crashing.

## Screens

| Route         | What it does                                                       |
| ------------- | ------------------------------------------------------------------ |
| `/`           | Home — featured hero, poster carousel, your watch stats, filter chips, poster grid |
| `/search`     | Debounced TMDB search                                              |
| `/movie/[id]` | Detail: hero, rating, review, community reviews                    |
| `/profile`    | Your ratings, average score, watchlist                             |
| `/ai`         | AI recommendations placeholder                                     |
| `/rooms`      | Watch Together placeholder (roadmap Month 2)                       |

Filters live in the URL (`/?filter=drama&sort=popular`), so the top nav's
Movies/Series/Games links and the chip row drive the same state. Series and
Games have no catalogue behind them yet and say so.

## How it's put together

```
app/
  layout.tsx          fonts + auth/toast providers + app shell
  globals.css         the design system — read before styling anything
  page.tsx            the home screen
  movie/[id]/page.tsx the detail screen
components/
  TopNav / BottomNav  the two nav chromes
  home/               carousel, filter bar, hero actions, watch stats
  detail/             rate card, review list, chrome
lib/
  tmdb.ts             server-only TMDB client + mapping to UI types
  types.ts            the shapes the UI consumes
  ratings.ts          local persistence + derived watch stats
  format.ts           formatScore, splitTitle
  homeFilters.ts      filter/sort vocabulary (shared server + client)
```

Three deliberate seams:

- **`lib/tmdb.ts` maps TMDB payloads into `lib/types.ts` shapes.** Nothing in
  the UI touches a raw TMDB field, so adding IGDB (per the roadmap) or swapping
  providers only touches the mapping functions.
- **`lib/ratings.ts` is the only module that touches `localStorage`.** When the
  Week 4 rating/review endpoints land, replace those function bodies with fetch
  calls and no component changes.
- **`lib/homeFilters.ts` holds the filter constants, not `FilterBar.tsx`** — the
  server page needs them, and importing data out of a `'use client'` module
  hands it a client reference proxy instead of the array.

Ratings currently live in the browser, so they're per-device and clear with site
data. That's the intended stand-in until the backend exists. The home screen's
stat strip is computed from them — it shows `0`, not the mockup's demo figures,
until you've rated something.

## Not built yet

The AI recommendation chat, real Watch Together sync (Socket.io + Agora), and
server-side persistence — Month 1 Week 5+ / Month 2 on the roadmap.
