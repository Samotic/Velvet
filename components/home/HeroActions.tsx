'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';

import { Bookmark, BookmarkFilled, StarOutline } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRipple } from '@/components/ui/Ripple';
import { hrefFor, type CatalogSummary } from '@/lib/contentTypes';
import { getWatchlist, onLibraryChange, toggleWatchlist } from '@/lib/ratings';

/** The hero's two buttons: Add to Watchlist · Rate It. */
export function HeroActions({ item }: { item: CatalogSummary }) {
  const toast = useToast();
  const ripple = useRipple();
  const { isAuthenticated } = useAuth();

  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const sync = useCallback(() => {
    if (!isAuthenticated) {
      setSaved(false);
      return;
    }
    void getWatchlist()
      .then((list) =>
        setSaved(list.some((w) => w.contentId === item.id && w.contentType === item.type)),
      )
      .catch(() => setSaved(false));
  }, [isAuthenticated, item.id, item.type]);

  useEffect(() => onLibraryChange(sync), [sync]);

  async function save(e: MouseEvent<HTMLButtonElement>) {
    ripple(e);
    if (!isAuthenticated) {
      toast.bad('Sign in to build your watchlist');
      return;
    }
    if (busy) return;

    const next = !saved;
    setSaved(next);
    setBusy(true);
    try {
      const confirmed = await toggleWatchlist({
        contentId: item.id,
        contentType: item.type,
        contentTitle: item.title,
        poster: item.posterUrl,
        year: item.year,
      });
      setSaved(confirmed);
      toast(confirmed ? 'Added to watchlist' : 'Removed from watchlist');
    } catch {
      setSaved(!next);
      toast.bad('Could not update your watchlist');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hero-actions">
      <button
        type="button"
        className={`btn-fill ripple-host${saved ? ' on' : ''}`}
        aria-pressed={saved}
        onClick={save}
      >
        {saved ? <BookmarkFilled size={17} /> : <Bookmark />}
        {saved ? 'In Watchlist' : 'Add to Watchlist'}
      </button>

      {/* Rating lives on the detail screen's rate card — this is the way in. */}
      <Link href={`${hrefFor(item.type, item.id)}#rate`} className="btn-secondary">
        <StarOutline />
        Rate It
      </Link>
    </div>
  );
}
