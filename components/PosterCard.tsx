'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';

import { useToast } from '@/components/Toast';
import { useRipple } from '@/components/ui/Ripple';
import { useAuth } from '@/components/auth/AuthProvider';
import { prefetchDetail } from '@/lib/catalog';
import { formatScore } from '@/lib/format';
import { hrefFor, TYPE_LABEL, type CatalogSummary } from '@/lib/contentTypes';
import { myRatingOf, onLibraryChange, toggleWatchlist } from '@/lib/ratings';

import { Bookmark, BookmarkFilled, StarFilled } from './icons';

/**
 * The catalogue's poster card.
 *
 * Carries everything the design asks of it: the score badge, the type tag, the
 * hover lift, the shine sweep (CSS), the AI tip that slides up, and a save
 * button that ripples indigo and toggles the watchlist.
 *
 * `savedInitial` lets a parent that already knows the watchlist state (the
 * watchlist screen itself) skip the per-card lookup.
 */
export function PosterCard({
  item,
  tip,
  savedInitial = false,
  showSave = true,
  priority = false,
}: {
  item: CatalogSummary;
  /** The AI's one-line pitch, shown on hover. */
  tip?: string | null;
  savedInitial?: boolean;
  showSave?: boolean;
  priority?: boolean;
}) {
  const toast = useToast();
  const ripple = useRipple();
  const { isAuthenticated } = useAuth();

  const [saved, setSaved] = useState(savedInitial);
  const [mine, setMine] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Reflect the user's own rating on the poster, and keep it live if they rate
  // this title on another screen. `myRatingOf` batches every card in the grid
  // into one request, so a rail of twenty costs one call rather than twenty.
  const sync = useCallback(() => {
    if (!isAuthenticated) {
      setMine(null);
      return;
    }
    void myRatingOf(item.id, item.type)
      .then(setMine)
      .catch(() => setMine(null));
  }, [isAuthenticated, item.id, item.type]);

  useEffect(() => onLibraryChange(sync), [sync]);

  async function save(e: MouseEvent<HTMLButtonElement>) {
    // The card is a link; the save button sits inside it.
    e.preventDefault();
    e.stopPropagation();
    ripple(e);

    if (!isAuthenticated) {
      toast.bad('Sign in to build your watchlist');
      return;
    }
    if (busy) return;

    // Optimistic: the toggle should feel instant. Rolled back if the write fails.
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

  // Start the title's fetch while the cursor is still on its way. Next's Link
  // already prefetches the route's code; this prefetches its data, which is the
  // half that actually costs a round trip to TMDB or IGDB.
  const warm = useCallback(() => prefetchDetail(item.type, item.id), [item.type, item.id]);

  return (
    <Link
      href={hrefFor(item.type, item.id)}
      className="poster-card"
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
    >
      <div className="poster-shell">
        {item.posterUrl ? (
          <Image
            src={item.posterUrl}
            alt={item.title}
            fill
            priority={priority}
            sizes="(min-width:1360px) 200px, (min-width:900px) 22vw, 44vw"
          />
        ) : (
          <div className="poster-fallback">{item.title.charAt(0)}</div>
        )}

        {item.score !== null && (
          <div className="poster-score">
            <StarFilled size={11} />
            {formatScore(item.score)}
          </div>
        )}

        <div className="poster-type">{TYPE_LABEL[item.type]}</div>

        {mine !== null && <div className="poster-mine">★ {mine}</div>}

        {showSave && (
          <button
            type="button"
            className={`poster-save ripple-host${saved ? ' on' : ''}`}
            aria-label={saved ? `Remove ${item.title} from watchlist` : `Save ${item.title}`}
            aria-pressed={saved}
            onClick={save}
          >
            {saved ? <BookmarkFilled size={16} /> : <Bookmark />}
          </button>
        )}

        {tip && <div className="poster-tip">{tip}</div>}
      </div>

      <div className="poster-title">{item.title}</div>
      {item.year && <div className="poster-year">{item.year}</div>}
    </Link>
  );
}
