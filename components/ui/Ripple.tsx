'use client';

import { useCallback, type MouseEvent } from 'react';

/**
 * The copper ripple every button in the design carries.
 *
 * Implemented as a hook rather than a wrapper component so it can be attached
 * to whatever element already exists — a `.btn-fill`, a `.chip`, a poster's
 * save button — without adding a DOM layer that would break the existing
 * flex/grid layouts.
 *
 * The span is appended imperatively and removes itself when its animation
 * ends. That keeps ripples out of React state: they're pure decoration, and a
 * state update per click would re-render the button mid-press.
 *
 *   const ripple = useRipple();
 *   <button className="btn-fill ripple-host" onClick={ripple}>…</button>
 *
 * The host element needs `.ripple-host` for the overflow clip and stacking
 * context.
 */
export function useRipple() {
  return useCallback((event: MouseEvent<HTMLElement>) => {
    const host = event.currentTarget;
    if (!host) return;

    // Honour the OS setting rather than the media query alone — the CSS would
    // collapse the animation to 0.01ms, leaving an element that never fires
    // `animationend` reliably.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const rect = host.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.left = `${event.clientX - rect.left}px`;
    span.style.top = `${event.clientY - rect.top}px`;
    // Scale the ripple to the element's diagonal so it always covers the
    // corner furthest from the click.
    span.style.width = span.style.height = `${Math.hypot(rect.width, rect.height)}px`;
    span.style.margin = `${-Math.hypot(rect.width, rect.height) / 2}px 0 0 ${
      -Math.hypot(rect.width, rect.height) / 2
    }px`;

    span.addEventListener('animationend', () => span.remove(), { once: true });
    host.appendChild(span);
  }, []);
}

/**
 * A button that ripples. Use where the element is a plain button; where it
 * already has bespoke markup, reach for `useRipple()` directly.
 */
export function RippleButton({
  className = 'btn-fill',
  onClick,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ripple = useRipple();

  return (
    <button
      {...rest}
      className={`${className} ripple-host`}
      onClick={(e) => {
        ripple(e);
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
