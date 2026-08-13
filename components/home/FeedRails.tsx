'use client';

import { useCallback, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { Reveal } from '@/components/ui/Reveal';
import { useToast } from '@/components/Toast';
import { dismissItem, type FeedItem, type Rail } from '@/lib/feed';

/**
 * The personalised rails — §13.
 *
 * ── §14 is why there is no author byline here ──
 * "Your taste twin also loved" describes a real account, and this component is
 * given no way to identify them: the API returns items only, so there is
 * nothing to render even by accident. The rail names a relationship, never a
 * person.
 */

export function FeedRails({
  rails,
  onDismissed,
}: {
  rails: Rail[];
  onDismissed?: (item: FeedItem) => void;
}) {
  return (
    <>
      {rails.map((rail, i) => (
        <RailRow key={rail.id} rail={rail} index={i} onDismissed={onDismissed} />
      ))}
    </>
  );
}

function RailRow({
  rail,
  index,
  onDismissed,
}: {
  rail: Rail;
  index: number;
  onDismissed?: (item: FeedItem) => void;
}) {
  const toast = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const keyOf = (i: FeedItem) => `${i.contentType}:${i.contentId}`;

  const dismiss = useCallback(
    async (item: FeedItem) => {
      const k = keyOf(item);
      // Optimistic: the card goes immediately. A dismissal that waits on a
      // round trip feels like the button didn't work, and users press again.
      setHidden((prev) => new Set(prev).add(k));
      try {
        await dismissItem({
          contentId: item.contentId,
          contentType: item.contentType,
          title: item.title,
        });
        onDismissed?.(item);
      } catch {
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
        toast.bad('Could not dismiss that');
      }
    },
    [onDismissed, toast],
  );

  const visible = rail.items.filter((i) => !hidden.has(keyOf(i)));
  if (!visible.length) return null;

  return (
    <Reveal>
      <section className="feed-rail">
        <div className="section-head">
          <span className="section-num">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h2 className="section-title">{rail.title}</h2>
            <p className="feed-rail-reason">{rail.reason}</p>
          </div>
        </div>

        <div className="feed-rail-scroll">
          {visible.map((item) => (
            <div key={keyOf(item)} className="feed-card">
              <PosterCard
                item={{
                  id: item.contentId,
                  type: item.contentType,
                  title: item.title,
                  posterUrl: item.poster,
                  year: '',
                  score: null,
                  overview: '',
                  // The feed carries no catalogue metadata — §9 keeps display
                  // fields out of the similarity math, so enrichment is the
                  // detail page's job, not the rail's.
                  genres: [],
                }}
              />
              <p className="feed-card-reason">{item.reason}</p>
              <button
                type="button"
                className="feed-dismiss"
                onClick={() => void dismiss(item)}
                /* The tooltip is honest about what the button does: §13 says a
                   dismissal feeds the matrix, and a signal that quietly trains
                   a model is not something to be quiet about. */
                title="Not for me — this also teaches Velvet your taste"
                aria-label={`Dismiss ${item.title}`}
              >
                Not for me
              </button>
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
