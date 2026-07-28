'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { Reveal } from '@/components/ui/Reveal';
import { EmptyState, PosterGridSkeleton } from '@/components/ui/States';
import { browse } from '@/lib/catalog';
import type { CatalogSummary } from '@/lib/contentTypes';
import { isGenreFilter, isSort, isTypeFilter, type SortId, type TypeFilterId } from '@/lib/homeFilters';

import { AiPicks } from './AiPicks';
import { FilterBar } from './FilterBar';
import { FriendsActivity } from './FriendsActivity';
import { Hero } from './Hero';
import { TopRated } from './TopRated';
import { WatchStats } from './WatchStats';

/**
 * The discovery feed.
 *
 * Each section fetches independently so a slow or unconfigured one (AI picks
 * without an Anthropic key, activity with nobody followed) degrades on its own
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

  return (
    <>
      <Hero item={hero} cluster={cluster} loading={items === null} />

      <WatchStats />

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
