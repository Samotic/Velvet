'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { Reveal } from '@/components/ui/Reveal';
import { EmptyState, PosterGridSkeleton } from '@/components/ui/States';
import { browse } from '@/lib/catalog';
import type { CatalogSummary } from '@/lib/contentTypes';
import { isGenreFilter, isSort, isTypeFilter, type SortId, type TypeFilterId } from '@/lib/homeFilters';

import { getFeed, type FeedResponse } from '@/lib/feed';

import { AiPicks } from './AiPicks';
import { FeedRails } from './FeedRails';
import { FilterBar } from './FilterBar';
import { TastePicker } from './TastePicker';
import { FriendsActivity } from './FriendsActivity';
import { Hero } from './Hero';
import { TopRated } from './TopRated';
import { WatchStats } from './WatchStats';

/**
 * The discovery feed.
 *
 * Each section fetches independently so a slow or unconfigured one (AI picks
 * without an advisor key, activity with nobody followed) degrades on its own
 * instead of holding up the page.
 */
export function HomeScreen() {
  const params = useSearchParams();

  const filterParam = params.get('filter') ?? 'all';
  const filter: TypeFilterId = isTypeFilter(filterParam) ? filterParam : 'all';
  const genreParam = params.get('genre');
  const genre = genreParam && isGenreFilter(genreParam) ? genreParam : null;
  const sortParam = params.get('sort') ?? 'trending';
  const sort: SortId = isSort(sortParam) ? sortParam : 'trending';

  const [items, setItems] = useState<CatalogSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  /**
   * The personalised feed, loaded alongside the catalogue rather than instead
   * of it — the browse grid is still how you find something specific, and a
   * feed that replaced it would make the filter bar dead weight.
   *
   * A failure here leaves `feed` null and the page renders exactly as it did
   * before the recommender existed. That is the intended degradation: nobody
   * loses the ability to browse because a neighbour job is behind.
   */
  const [feed, setFeed] = useState<FeedResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getFeed({ signal: controller.signal })
      .then(setFeed)
      .catch(() => setFeed(null));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setFailed(false);

    browse({ filter, genre, sort, signal: controller.signal })
      .then(setItems)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setItems([]);
      });

    return () => controller.abort();
  }, [filter, genre, sort]);

  // The hero and the floating cluster come from the front of the current rail,
  // so the featured title always matches what the user is browsing.
  const hero = items?.[0] ?? null;
  const cluster = items?.slice(0, 3) ?? [];

  // Cold start takes the whole screen. Showing a generic grid alongside it
  // would give the user something to scroll instead of the one action that
  // makes every later visit personal.
  if (feed?.needsSeeding) {
    return <TastePicker onSeeded={setFeed} />;
  }

  return (
    <>
      <Hero item={hero} cluster={cluster} loading={items === null} />

      <WatchStats />

      {feed && feed.rails.length > 0 && (
        <FeedRails
          rails={feed.rails}
          // A dismissal invalidates the server's cached feed, so refetch to
          // pick up whatever moved into the freed slot.
          onDismissed={() => void getFeed({ refresh: true }).then(setFeed).catch(() => {})}
        />
      )}

      <FilterBar filter={filter} genre={genre} sort={sort} />

      {items === null ? (
        <PosterGridSkeleton count={12} />
      ) : items.length > 0 ? (
        <div className="rail" style={{ paddingBottom: 8 }}>
          {items.map((item, i) => (
            <PosterCard key={`${item.type}-${item.id}`} item={item} priority={i < 6} />
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon="◎"
          title="Catalogue unavailable"
          text="Velvet can't reach its catalogue right now. Check that the API is running and that a TMDB key is configured."
          action={{ label: 'Try the AI advisor', href: '/ai' }}
        />
      ) : (
        <EmptyState
          icon="◷"
          title="Nothing here yet"
          text={
            filter === 'games'
              ? 'Games arrive with the IGDB source. Add IGDB credentials to the API to switch this on.'
              : 'No titles match this combination — try another tab or genre.'
          }
          action={{ label: 'Browse everything', href: '/' }}
        />
      )}

      <Reveal as="section">
        <TopRated />
      </Reveal>

      <Reveal as="section">
        <AiPicks />
      </Reveal>

      <Reveal as="section">
        <FriendsActivity />
      </Reveal>
    </>
  );
}
