'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { StarOutline } from '@/components/icons';
import { ApiError } from '@/lib/api';
import type { CatalogDetail } from '@/lib/contentTypes';
import { getMyRating, saveRating } from '@/lib/ratings';

/** Labels are indexed by star value. */
const LABELS = ['', 'Skip it', 'It was ok', 'Good', 'Loved it', 'Masterpiece'];

/**
 * Star selector plus review box. A rating and a review are one record, so this
 * card writes both in a single call — and rehydrates from a previous visit so
 * the button reads "Update review" rather than silently overwriting.
 */
export function RateCard({ item, onSaved }: { item: CatalogDetail; onSaved: () => void }) {
  const toast = useToast();
  const { isAuthenticated } = useAuth();

  const [current, setCurrent] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState('');
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void getMyRating(item.id, item.type)
      .then((mine) => {
        if (cancelled || !mine) return;
        setCurrent(mine.rating);
        setText(mine.review);
        setExisting(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, item.id, item.type]);

  async function post() {
    if (!isAuthenticated) {
      toast.bad('Sign in to rate this');
      return;
    }
    if (!current) {
      toast.bad('Pick a rating first');
      return;
    }

    setBusy(true);
    try {
      await saveRating({
        contentId: item.id,
        contentType: item.type,
        contentTitle: item.title,
        poster: item.posterUrl,
        rating: current,
        review: text.trim(),
        runtimeMinutes: item.runtimeMinutes,
        genres: item.genres,
      });
      setExisting(true);
      onSaved();
      toast(existing ? 'Review updated' : 'Review posted');
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not save your rating');
    } finally {
      setBusy(false);
    }
  }

  // Hovering previews the value without committing it.
  const shown = hover || current;

  return (
    <div className="rate-card">
      <div className="rate-label">Tap to rate</div>

      <div
        className="stars"
        role="radiogroup"
        aria-label={`Rate ${item.title}`}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={current === v}
            aria-label={`${v} star${v > 1 ? 's' : ''} — ${LABELS[v]}`}
            className={`star${v <= shown ? ' filled' : ''}`}
            onMouseEnter={() => setHover(v)}
            onFocus={() => setHover(v)}
            onBlur={() => setHover(0)}
            onClick={() => setCurrent(v)}
          >
            <StarOutline />
          </button>
        ))}
      </div>

      <div className="your-score">{shown ? `${LABELS[shown]}  ·  ${shown}/5` : ''}</div>

      <textarea
        className="input"
        style={{ marginTop: 16 }}
        placeholder="Write your review… what did this make you feel?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={5000}
      />

      <RippleButton
        className="btn-fill btn-block"
        style={{ marginTop: 12 }}
        disabled={busy}
        onClick={() => void post()}
      >
        {busy ? <span className="spinner" /> : existing ? 'Update review' : 'Post review'}
      </RippleButton>
    </div>
  );
}
