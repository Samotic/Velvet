'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';

/**
 * Scroll reveal — every page section fades and rises as it enters the viewport.
 *
 * One IntersectionObserver per instance, disconnected once the element has
 * revealed: these are one-shot entrances, and leaving observers attached to a
 * long feed is a steady cost for no behaviour.
 *
 * The element starts at `.reveal` (hidden) and gains `.in`. If JS is disabled
 * the CSS transition never runs and content would stay invisible, so the
 * observer is skipped entirely when it isn't supported — the element is
 * revealed immediately instead.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  /** The rendered element. `section` for page sections, `div` for cards. */
  as?: ElementType;
  className?: string;
  /** Stagger, in ms, for sibling reveals. */
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer support, or reduced motion — show it and move on.
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      el.classList.add('in');
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        if (delay) {
          el.style.transitionDelay = `${delay}ms`;
        }
        el.classList.add('in');
        observer.disconnect();
      },
      // Fire slightly before the element is fully on screen so the motion is
      // finishing as the user arrives, not starting.
      { threshold: 0.08, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <Tag ref={ref} className={`reveal ${className}`.trim()}>
      {children}
    </Tag>
  );
}
