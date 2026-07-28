'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { useRipple } from '@/components/ui/Ripple';
import { Bookmark, BookmarkFilled, Share, Sparkle, StarOutline } from '@/components/icons';
import type { CatalogDetail } from '@/lib/contentTypes';
import { getWatchlist, onLibraryChange, toggleWatchlist } from '@/lib/ratings';

/** Add to Watchlist · Rate It · Ask AI, plus a quiet share. */
export function DetailActions({ item }: { item: CatalogDetail }) {
  const router = useRouter();
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

  function rate() {
    // The rate card is further down the same screen.
    document.getElementById('rate')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function askAi() {
    if (!isAuthenticated) {
      toast.bad('Sign in to ask the advisor');
      return;
    }
    // The advisor opens with this title already in the question.
    router.push(`/ai?q=${encodeURIComponent(`Tell me about ${item.title} — would I like it?`)}`);
  }

  async function share() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try {
        await navigator.share({ title: `${item.title} on Velvet`, url });
      } catch {
        /* the user dismissed the sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast.bad('Could not copy the link');
    }
  }

  return (
    <div className="actions">
      <button
        type="button"
        className={`btn-fill ripple-host${saved ? ' on' : ''}`}
        aria-pressed={saved}
        onClick={save}
      >
        {saved ? <BookmarkFilled size={17} /> : <Bookmark />}
        {saved ? 'In Watchlist' : 'Add to Watchlist'}
      </button>

      <button type="button" className="btn-primary ripple-host" onClick={(e) => { ripple(e); rate(); }}>
        <StarOutline />
        Rate It
      </button>

      <button type="button" className="btn-secondary ripple-host" onClick={(e) => { ripple(e); askAi(); }}>
        <Sparkle />
        Ask AI
      </button>

      <button
        type="button"
        className="icon-action"
        aria-label="Share"
        onClick={() => void share()}
      >
        <Share />
      </button>
    </div>
  );
}
