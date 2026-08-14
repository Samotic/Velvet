import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The two states every list screen needs: nothing yet, and still loading.
 *
 * Both live here so the copy and the rhythm stay consistent — an empty
 * watchlist and an empty search should feel like the same product.
 */

/** Friendly message + a indigo CTA, per the design rules. */
export function EmptyState({
  icon,
  art,
  title,
  text,
  action,
}: {
  /** A glyph, for compact empties. */
  icon?: string;
  /** An SVG illustration, for full-screen empties. */
  art?: ReactNode;
  title: string;
  text: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="empty">
      {art ? <div className="empty-art">{art}</div> : icon ? <div className="empty-ic">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      <div className="empty-text">{text}</div>
      {action && (
        <Link href={action.href} className="btn-fill">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/**
 * A grid of shimmering poster placeholders, matching `.rail` so the layout
 * doesn't jump when the real cards land.
 */
export function PosterGridSkeleton({ count = 12, five = false }: { count?: number; five?: boolean }) {
  return (
    <div className={`rail${five ? ' rail-5' : ''}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton sk-poster" />
          <div className="skeleton sk-line" />
          <div className="skeleton sk-line short" />
        </div>
      ))}
    </div>
  );
}

/** Stacked row placeholders — conversations, notifications, reviews. */
export function RowsSkeleton({ count = 6, height = 62 }: { count?: number; height?: number }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

/** A centred spinner for full-panel loads. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="empty" style={{ padding: '72px 24px' }}>
      <div className="auth-gate-spinner" aria-label={label} />
    </div>
  );
}

/**
 * The detail hero, drawn empty.
 *
 * A title page's data is two hops away (our API, then TMDB/IGDB), so a spinner
 * would leave the screen blank for the whole round trip. This paints the real
 * hero — the indigo backdrop wash, the poster well, the title block — at the
 * exact dimensions the loaded page uses, so the design arrives on click and
 * only the text fills in afterwards. Nothing moves when it does.
 */
export function DetailSkeleton() {
  return (
    <section className="detail-hero" aria-busy="true" aria-label="Loading title">
      <div className="detail-backdrop plain" />
      <div className="detail-hero-inner">
        <div className="detail-poster">
          <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="badges">
            <span className="skeleton" style={{ width: 74, height: 24, borderRadius: 100 }} />
            <span className="skeleton" style={{ width: 58, height: 24, borderRadius: 100 }} />
          </div>
          <div className="skeleton" style={{ height: 52, width: '62%', marginTop: 18 }} />
          <div className="skeleton" style={{ height: 52, width: '44%', marginTop: 10 }} />
          <div className="skeleton" style={{ height: 14, width: '32%', marginTop: 22 }} />
          <div className="skeleton" style={{ height: 44, width: 260, marginTop: 26, borderRadius: 6 }} />
        </div>
      </div>
    </section>
  );
}

/**
 * A whole discovery screen, drawn empty: hero band, then a poster rail.
 * Used by the route-level `loading.tsx` files so a navigation paints the
 * page's shape before its client bundle has even run.
 */
export function ScreenSkeleton({ rail = 12 }: { rail?: number }) {
  return (
    <div aria-busy="true">
      <div className="skeleton" style={{ height: 300, borderRadius: 8, marginBottom: 34 }} />
      <PosterGridSkeleton count={rail} />
    </div>
  );
}
