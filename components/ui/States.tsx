import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The two states every list screen needs: nothing yet, and still loading.
 *
 * Both live here so the copy and the rhythm stay consistent — an empty
 * watchlist and an empty search should feel like the same product.
 */

/** Friendly message + a copper CTA, per the design rules. */
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
