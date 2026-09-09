'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The chat menu shell: a popover on a pointer device, a bottom sheet on touch.
 *
 * Extracted from `MessageMenu` when the thread header grew a menu of its own.
 * The two menus differ only in what they offer — the surface underneath is the
 * same decision every time: where it sits, how it stays on screen, and what
 * dismisses it. A second copy of that would be a second place for a menu to
 * get stuck.
 */

/** Below this the menu is a sheet, above it a popover. Matches `--bp-chat`. */
const TOUCH_QUERY = '(max-width: 720px), (pointer: coarse)';

export function MenuSurface({
  anchor,
  label,
  onClose,
  children,
}: {
  /**
   * Where the popover should sit, in viewport coordinates. Ignored in sheet
   * mode, where the surface is pinned to the bottom edge regardless.
   */
  anchor: { x: number; y: number } | null;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState<{ x: number; y: number } | null>(anchor);

  /**
   * Keeps the popover on screen.
   *
   * A right-click near the right or bottom edge — which is exactly where an
   * outgoing bubble sits — would otherwise open a menu running off the
   * viewport with no way to reach its items. Measured after mount because the
   * height depends on which items this particular menu offers, and re-measured
   * when `children` change, because a confirm step is taller than the menu
   * that opened it.
   */
  useLayoutEffect(() => {
    if (sheet || !anchor) return;
    const el = rootRef.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setClamped({
      x: Math.max(pad, Math.min(anchor.x, window.innerWidth - width - pad)),
      y: Math.max(pad, Math.min(anchor.y, window.innerHeight - height - pad)),
    });
  }, [anchor, sheet, children]);

  useEffect(() => {
    const mq = window.matchMedia(TOUCH_QUERY);
    const sync = () => setSheet(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Escape closes whichever step is showing, and an outside click does the
  // same — a menu that survives a click elsewhere reads as stuck.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Deferred a frame: the same click that opened this would otherwise close
    // it immediately, since it is still travelling up to the document.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  const body = (
    <div
      ref={rootRef}
      className={sheet ? 'msg-sheet' : 'msg-menu'}
      style={sheet || !clamped ? undefined : { left: `${clamped.x}px`, top: `${clamped.y}px` }}
      role="menu"
      aria-label={label}
    >
      {children}
    </div>
  );

  if (!sheet) return body;

  // The scrim belongs to the sheet only. On a pointer device the popover is
  // small and dismissing by clicking away is enough; dimming the thread there
  // would be a heavier gesture than the action warrants.
  return (
    <div className="msg-sheet-scrim" onClick={onClose} role="presentation">
      <div onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}
