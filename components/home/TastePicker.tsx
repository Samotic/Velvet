'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { PosterGridSkeleton } from '@/components/ui/States';
import { StarFilled, StarOutline } from '@/components/icons';
import {
  getSeedGrid,
  submitSeedRatings,
  type FeedResponse,
  type SeedItem,
} from '@/lib/feed';

/**
 * The cold-start taste picker — §12.
 *
 * ── Why this is infrastructure, not a nicety ──
 * Collaborative filtering's cold start is total. With an empty row vector,
 * similarity to every other user is undefined — not weak, undefined. There is
 * no clever fallback that fixes it, only ratings. So this screen is the only
 * thing standing between a new account and a permanently generic feed.
 *
 * ── Why it asks for stars, not taps ──
 * A binary "seen it" gives no variance, and Pearson correlation on a constant
 * vector is undefined — the picker would collect twenty data points that
 * cannot produce a single similarity. Rating 1–5 is what makes the row usable.
 */

const REQUIRED = 5;

export function TastePicker({ onSeeded }: { onSeeded: (feed: FeedResponse) => void }) {
  const toast = useToast();

  const [items, setItems] = useState<SeedItem[] | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getSeedGrid(controller.signal)
      .then((r) => setItems(r.items))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setItems([]);
      });
    return () => controller.abort();
  }, []);

  const key = (i: SeedItem) => `${i.contentType}:${i.contentId}`;
  const count = Object.keys(ratings).length;
  const enough = count >= REQUIRED;

  const rate = useCallback((k: string, value: number) => {
    setRatings((prev) => {
      // Tapping the same star again clears it — the only way back out of a
      // misclick, since there is no separate remove control.
      if (prev[k] === value) {
        const next = { ...prev };
        delete next[k];
        return next;
      }
      return { ...prev, [k]: value };
    });
  }, []);

  async function submit() {
    if (!enough || !items) return;
    setSubmitting(true);
    try {
      const payload = items
        .filter((i) => ratings[key(i)])
        .map((i) => ({
          contentId: i.contentId,
          contentType: i.contentType,
          value: ratings[key(i)],
          title: i.title,
          poster: i.poster,
        }));

      // Returns the built feed in the same response, so there is no empty
      // screen between rating and seeing something back.
      onSeeded(await submitSeedRatings(payload));
    } catch {
      toast.bad('Could not save those ratings');
      setSubmitting(false);
    }
  }

  return (
    <div className="taste-picker">
      <div className="screen-head">
        <h1 className="screen-title">
          Rate a few, and <em>Velvet learns you.</em>
        </h1>
        <p className="taste-picker-sub">
          Pick at least {REQUIRED} you&apos;ve seen or played and rate them honestly — a low score
          tells us as much as a high one. Films, series and games all count toward the same taste.
        </p>
      </div>

      {items === null ? (
        <PosterGridSkeleton count={20} />
      ) : items.length === 0 ? (
        <p className="taste-picker-sub">
          The catalogue isn&apos;t reachable right now. Rate anything from search and your feed will
          start building.
        </p>
      ) : (
        <div className="taste-grid">
          {items.map((i) => {
            const k = key(i);
            const value = ratings[k] ?? 0;
            return (
              <div key={k} className={`taste-cell${value ? ' rated' : ''}`}>
                <div className="taste-poster">
                  {i.poster ? (
                    <Image src={i.poster} alt="" fill sizes="20vw" className="taste-poster-img" />
                  ) : (
                    <span className="taste-poster-fallback">{i.title.slice(0, 18)}</span>
                  )}
                </div>
                <div className="taste-title" title={i.title}>
                  {i.title}
                </div>
                <div
                  className="taste-stars"
                  role="radiogroup"
                  aria-label={`Rate ${i.title}`}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={value === n}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      className={`taste-star${n <= value ? ' on' : ''}`}
                      onClick={() => rate(k, n)}
                    >
                      {n <= value ? <StarFilled size={17} /> : <StarOutline />}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="taste-bar">
        <span className="taste-count">
          {count} of {REQUIRED} rated
          {count > REQUIRED ? ' — more is better' : ''}
        </span>
        <RippleButton
          className="btn-fill btn-lg"
          disabled={!enough || submitting}
          onClick={() => void submit()}
        >
          {submitting ? <span className="spinner" /> : 'Build my feed'}
        </RippleButton>
      </div>
    </div>
  );
}
