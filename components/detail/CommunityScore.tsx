'use client';

import { useEffect, useState } from 'react';

import { compactCount } from '@/lib/format';
import type { ContentType, RatingSummary } from '@/lib/contentTypes';
import { getRatingSummary } from '@/lib/ratings';

/**
 * Velvet's own community score: the large average, the 1–5 distribution, and
 * the total.
 *
 * This is distinct from the source score in the hero (TMDB/IGDB) — it's what
 * Velvet's own users gave it, which is the number the product is actually
 * about.
 */
export function CommunityScore({
  contentId,
  contentType,
  refreshKey,
}: {
  contentId: string;
  contentType: ContentType;
  /** Bumped by the rate card so a fresh rating shows up immediately. */
  refreshKey: number;
}) {
  const [summary, setSummary] = useState<RatingSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRatingSummary(contentId, contentType)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setSummary({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
      });
    return () => {
      cancelled = true;
    };
  }, [contentId, contentType, refreshKey]);

  if (!summary) {
    return <div className="skeleton" style={{ height: 168, borderRadius: 6 }} />;
  }

  if (summary.count === 0) {
    return (
      <div className="community">
        <div className="community-score">
          <div className="community-figure">—</div>
          <div className="community-of">Velvet score</div>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 14, fontWeight: 300, lineHeight: 1.6 }}>
          Nobody here has rated this yet. Yours would be the first — scroll down and give it a
          star.
        </p>
      </div>
    );
  }

  const max = Math.max(...summary.distribution, 1);

  return (
    <div className="community">
      <div className="community-score">
        <div className="community-figure">
          {summary.average !== null ? summary.average.toFixed(1) : '—'}
        </div>
        <div className="community-of">Velvet score</div>
        <div className="community-count">
          {compactCount(summary.count)} {summary.count === 1 ? 'rating' : 'ratings'}
        </div>
      </div>

      <div className="dist">
        {/* Highest stars first, the way a rating breakdown is normally read. */}
        {[5, 4, 3, 2, 1].map((star) => {
          const n = summary.distribution[star - 1] ?? 0;
          return (
            <div className="dist-row" key={star}>
              <span className="dist-star">{star} ★</span>
              <span className="dist-track">
                <i style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="dist-n">{compactCount(n)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
