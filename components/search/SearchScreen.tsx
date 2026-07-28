'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, PosterGridSkeleton, RowsSkeleton } from '@/components/ui/States';
import { Search as SearchIcon } from '@/components/icons';
import type { PublicProfile } from '@/lib/authTypes';
import { searchContent, searchPeople } from '@/lib/catalog';
import { CONTENT_TYPES, TYPE_LABEL, type CatalogSummary, type ContentType } from '@/lib/contentTypes';
import { compactCount } from '@/lib/format';
import { GENRE_FILTERS } from '@/lib/homeFilters';
import { followUser, unfollowUser } from '@/lib/users';

type Mode = 'content' | 'people';

const DEBOUNCE = 300;
const THIS_YEAR = new Date().getFullYear();

export function SearchScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const initialQ = params.get('q') ?? '';
  const initialMode: Mode = params.get('mode') === 'people' ? 'people' : 'content';

  const [q, setQ] = useState(initialQ);
  const [mode, setMode] = useState<Mode>(initialMode);

  const [content, setContent] = useState<CatalogSummary[] | null>(null);
  const [people, setPeople] = useState<PublicProfile[] | null>(null);

  // filters (content mode only)
  const [type, setType] = useState<ContentType | 'all'>('all');
  const [genre, setGenre] = useState<string | null>(null);
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [minRating, setMinRating] = useState(0);

  /* --- debounced query -------------------------------------------------- */

  useEffect(() => {
    const term = q.trim();

    // Keep the URL in step so a search is shareable and survives a refresh.
    const next = new URLSearchParams();
    if (term) next.set('q', term);
    if (mode === 'people') next.set('mode', 'people');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

    if (!term) {
      setContent([]);
      setPeople([]);
      return;
    }

    setContent(null);
    setPeople(null);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (mode === 'people') {
        searchPeople(term, controller.signal)
          .then(setPeople)
          .catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setPeople([]);
          });
      } else {
        searchContent(term, {
          type: type === 'all' ? null : type,
          signal: controller.signal,
        })
          .then(setContent)
          .catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setContent([]);
          });
      }
    }, DEBOUNCE);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q, mode, type, router, pathname]);

  /* --- client-side refinement ------------------------------------------- */

  // Genre, year range and minimum rating are applied here rather than sent to
  // the API: the sources don't offer a combined filter across all three, so
  // narrowing the returned page keeps the behaviour consistent between TMDB
  // and IGDB results.
  const refined = useMemo(() => {
    let list = content ?? [];
    if (genre) list = list.filter((i) => i.genres.includes(genre));
    if (fromYear) list = list.filter((i) => !i.year || Number(i.year) >= Number(fromYear));
    if (toYear) list = list.filter((i) => !i.year || Number(i.year) <= Number(toYear));
    if (minRating > 0) list = list.filter((i) => (i.score ?? 0) >= minRating);
    return list;
  }, [content, genre, fromYear, toYear, minRating]);

  const term = q.trim();

  return (
    <div style={{ paddingBottom: 60 }}>
      <div className="screen-head">
        <h1 className="screen-title">
          Search <em>Velvet</em>
        </h1>
      </div>

      <div className="tabs" style={{ marginTop: 22 }}>
        <button
          type="button"
          className={`tab${mode === 'content' ? ' active' : ''}`}
          onClick={() => setMode('content')}
        >
          Films &amp; Series &amp; Games
        </button>
        <button
          type="button"
          className={`tab${mode === 'people' ? ' active' : ''}`}
          onClick={() => setMode('people')}
        >
          People
        </button>
      </div>

      <div className="search-wrap">
        <SearchIcon className="search-icon" />
        <input
          className="search-field"
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={mode === 'people' ? 'Search people…' : 'Search films, series and games…'}
          aria-label={mode === 'people' ? 'Search people' : 'Search content'}
        />
      </div>

      {mode === 'people' ? (
        <PeopleResults term={term} people={people} />
      ) : (
        <div className="search-layout with-filters" style={{ marginTop: 26 }}>
          <aside className="filter-side">
            <div className="filter-block">
              <div className="filter-label">Type</div>
              <div className="filter-opts">
                <button
                  type="button"
                  className={`chip chip-sm${type === 'all' ? ' active' : ''}`}
                  onClick={() => setType('all')}
                >
                  All
                </button>
                {CONTENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip chip-sm${type === t ? ' active' : ''}`}
                    onClick={() => setType(t)}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-label">Genre</div>
              <div className="filter-opts">
                {GENRE_FILTERS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`chip chip-sm${genre === g ? ' active' : ''}`}
                    onClick={() => setGenre(genre === g ? null : g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-label">Year</div>
              <div className="range-row">
                <input
                  className="input"
                  type="number"
                  placeholder="From"
                  min={1900}
                  max={THIS_YEAR}
                  value={fromYear}
                  onChange={(e) => setFromYear(e.target.value)}
                  aria-label="From year"
                />
                <span style={{ color: 'var(--muted)' }}>–</span>
                <input
                  className="input"
                  type="number"
                  placeholder="To"
                  min={1900}
                  max={THIS_YEAR}
                  value={toYear}
                  onChange={(e) => setToYear(e.target.value)}
                  aria-label="To year"
                />
              </div>
            </div>

            <div className="filter-block" style={{ borderBottom: 'none' }}>
              <div className="filter-label">
                Min rating
                <span style={{ color: 'var(--accent-bright)', marginLeft: 8 }}>
                  {minRating > 0 ? minRating.toFixed(1) : 'Any'}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                aria-label="Minimum rating"
              />
            </div>
          </aside>

          <div>
            {!term ? (
              <EmptyState
                icon="🔍"
                title="Find something"
                text="Search by title — then rate it, review it, or save it for later."
              />
            ) : content === null ? (
              <PosterGridSkeleton count={12} />
            ) : refined.length === 0 ? (
              <EmptyState
                icon="🎞"
                title="No matches"
                text={
                  content.length > 0
                    ? 'Nothing survived your filters — try loosening the genre, year or rating.'
                    : `Nothing came back for “${term}”. Try a different spelling.`
                }
              />
            ) : (
              <div className="rail">
                {refined.map((item) => (
                  <PosterCard key={`${item.type}-${item.id}`} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- people --------------------------------- */

function PeopleResults({ term, people }: { term: string; people: PublicProfile[] | null }) {
  const toast = useToast();
  const { isAuthenticated, user: me } = useAuth();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  // Seed the local follow map whenever a fresh result set lands.
  useEffect(() => {
    if (!people) return;
    setFollowed(Object.fromEntries(people.map((p) => [p.id, p.isFollowing])));
  }, [people]);

  const toggle = useCallback(
    async (u: PublicProfile) => {
      if (!isAuthenticated) {
        toast.bad('Sign in to follow people');
        return;
      }
      const next = !followed[u.id];
      setFollowed((f) => ({ ...f, [u.id]: next }));
      setPending((p) => ({ ...p, [u.id]: true }));
      try {
        if (next) await followUser(u.id);
        else await unfollowUser(u.id);
      } catch {
        setFollowed((f) => ({ ...f, [u.id]: !next }));
        toast.bad('Could not update follow');
      } finally {
        setPending((p) => ({ ...p, [u.id]: false }));
      }
    },
    [followed, isAuthenticated, toast],
  );

  if (!term) {
    return (
      <EmptyState
        icon="◈"
        title="Find people"
        text="Search by name or handle, then follow the ones whose taste you trust."
      />
    );
  }

  if (people === null) {
    return (
      <div style={{ marginTop: 26 }}>
        <RowsSkeleton count={6} height={58} />
      </div>
    );
  }

  if (people.length === 0) {
    return <EmptyState icon="◈" title="Nobody found" text={`No Velvet user matches “${term}”.`} />;
  }

  return (
    <div style={{ marginTop: 18 }}>
      {people.map((u) => (
        <div key={u.id} className="user-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <Avatar
            src={u.profilePhoto}
            name={u.displayName}
            href={`/profile/${u.username}`}
          />
          <a href={`/profile/${u.username}`} className="user-row-body" style={{ textDecoration: 'none' }}>
            <div className="user-row-name">{u.displayName}</div>
            <div className="user-row-handle">
              @{u.username} · {compactCount(u.followerCount)} followers
            </div>
          </a>
          {u.id !== me?.id && (
            <button
              type="button"
              className={followed[u.id] ? 'btn-outline on' : 'btn-fill'}
              style={{ padding: '9px 18px', fontSize: 13.5 }}
              disabled={pending[u.id]}
              onClick={() => void toggle(u)}
            >
              {followed[u.id] ? 'Following ✓' : 'Follow'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
