'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/components/Toast';
import { useRipple } from '@/components/ui/Ripple';
import { EmptyState, PosterGridSkeleton } from '@/components/ui/States';
import { Check, Close, Filter, StarFilled } from '@/components/icons';
import {
  hrefFor,
  TYPE_LABEL,
  WATCH_STATUS_LABEL,
  type ContentType,
  type WatchlistItem,
  type WatchStatus,
} from '@/lib/contentTypes';
import { getWatchlist, onLibraryChange, removeFromWatchlist, updateWatchlistItem } from '@/lib/ratings';

type SortKey = 'added' | 'title' | 'rating' | 'year';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'added', label: 'Date Added' },
  { id: 'title', label: 'Title' },
  { id: 'rating', label: 'Rating' },
  { id: 'year', label: 'Year' },
];

export default function WatchlistPage() {
  return (
    <ProtectedRoute>
      <Watchlist />
    </ProtectedRoute>
  );
}

function Watchlist() {
  const toast = useToast();
  const ripple = useRipple();

  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [tab, setTab] = useState<WatchStatus>('want');
  const [typeFilter, setTypeFilter] = useState<ContentType | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('added');

  const load = useCallback(() => {
    getWatchlist()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => onLibraryChange(load), [load]);

  const counts = useMemo(() => {
    const c: Record<WatchStatus, number> = { want: 0, watching: 0, finished: 0 };
    for (const i of items ?? []) c[i.status] += 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    let list = (items ?? []).filter((i) => i.status === tab);
    if (typeFilter !== 'all') list = list.filter((i) => i.contentType === typeFilter);

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'title':
          return a.contentTitle.localeCompare(b.contentTitle);
        case 'rating':
          return (b.myRating ?? 0) - (a.myRating ?? 0);
        case 'year':
          return (b.year ?? '').localeCompare(a.year ?? '');
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return sorted;
  }, [items, tab, typeFilter, sort]);

  async function remove(item: WatchlistItem) {
    const snapshot = items;
    setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? prev);
    try {
      await removeFromWatchlist(item.id);
      toast('Removed from watchlist');
    } catch {
      setItems(snapshot ?? null);
      toast.bad('Could not remove that');
    }
  }

  async function markWatched(item: WatchlistItem) {
    const snapshot = items;
    setItems(
      (prev) =>
        prev?.map((i) =>
          i.id === item.id ? { ...i, status: 'finished' as WatchStatus, progressPercent: 100 } : i,
        ) ?? prev,
    );
    try {
      await updateWatchlistItem(item.id, { status: 'finished', progressPercent: 100 });
      toast('Marked as watched');
    } catch {
      setItems(snapshot ?? null);
      toast.bad('Could not update that');
    }
  }

  const nextSort = SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length];

  return (
    <div style={{ paddingBottom: 60 }}>
      <div className="screen-head">
        <h1 className="screen-title">
          Your <em>watchlist</em>
        </h1>
        <p className="screen-sub">Everything you meant to get to, in one place.</p>
      </div>

      <div className="tabs" style={{ marginTop: 28 }}>
        {(['want', 'watching', 'finished'] as WatchStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`tab${tab === s ? ' active' : ''}`}
            onClick={() => setTab(s)}
          >
            {WATCH_STATUS_LABEL[s]}
            <span className="tab-count">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="chipbar" style={{ borderBottom: 'none', paddingBottom: 18 }}>
        <div className="chips">
          <button
            type="button"
            className={`chip chip-sm${typeFilter === 'all' ? ' active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            All
          </button>
          {(['movie', 'series', 'game'] as ContentType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`chip chip-sm${typeFilter === t ? ' active' : ''}`}
              onClick={() => setTypeFilter(t)}
            >
              {TYPE_LABEL[t]}s only
            </button>
          ))}
        </div>

        <button
          type="button"
          className="sort-btn"
          onClick={() => setSort(nextSort.id)}
          aria-label={`Sorted by ${SORTS.find((s) => s.id === sort)?.label}. Switch to ${nextSort.label}`}
        >
          <Filter />
          {SORTS.find((s) => s.id === sort)?.label}
        </button>
      </div>

      {items === null ? (
        <PosterGridSkeleton count={10} five />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={tab === 'want' ? '⌾' : tab === 'watching' ? '▶' : '✓'}
          title={
            tab === 'want'
              ? 'Nothing saved yet'
              : tab === 'watching'
                ? 'Nothing in progress'
                : 'Nothing finished yet'
          }
          text={
            tab === 'want'
              ? 'Save something from anywhere in Velvet and it lands here.'
              : tab === 'watching'
                ? 'Start something from your list and track how far you are.'
                : 'Mark something as watched and it moves here.'
          }
          action={{ label: 'Discover something', href: '/' }}
        />
      ) : (
        <div className="rail rail-5">
          {visible.map((item) => (
            <div key={item.id} className="poster-card" style={{ position: 'relative' }}>
              <Link href={hrefFor(item.contentType, item.contentId)} className="poster-shell">
                {item.poster ? (
                  <Image
                    src={item.poster}
                    alt={item.contentTitle}
                    fill
                    sizes="(min-width:1180px) 220px, 44vw"
                  />
                ) : (
                  <div className="poster-fallback">{item.contentTitle.charAt(0)}</div>
                )}

                <div className="poster-type">{TYPE_LABEL[item.contentType]}</div>

                {item.myRating != null && (
                  <div className="poster-score">
                    <StarFilled size={11} />
                    {item.myRating}
                  </div>
                )}
              </Link>

              <button
                type="button"
                className="poster-remove"
                aria-label={`Remove ${item.contentTitle}`}
                onClick={() => void remove(item)}
              >
                <Close />
              </button>

              <div className="poster-title">{item.contentTitle}</div>
              {item.year && <div className="poster-year">{item.year}</div>}

              {item.status === 'watching' && (
                <div
                  className="poster-progress"
                  role="progressbar"
                  aria-valuenow={item.progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <i style={{ width: `${item.progressPercent}%` }} />
                </div>
              )}

              {item.status === 'want' && (
                <button
                  type="button"
                  className="btn-outline ripple-host"
                  style={{ width: '100%', marginTop: 10, fontSize: 12.5, padding: '8px 12px' }}
                  onClick={(e) => {
                    ripple(e);
                    void markWatched(item);
                  }}
                >
                  <Check />
                  Mark as watched
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
