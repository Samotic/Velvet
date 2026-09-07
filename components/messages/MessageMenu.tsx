'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Copy, Pencil, Trash } from '@/components/icons';
import { canDeleteForEveryone, canEdit, type DeleteScope } from '@/lib/messages';
import type { ThreadMessage } from '@/lib/messageGroups';

/**
 * The per-message action menu, and the confirm step behind Delete.
 *
 * Two surfaces, one component, because they are one decision the user is
 * making. On a pointer device the menu is a small popover anchored to the
 * bubble; on touch it is a bottom sheet, which is where a thumb already is and
 * where the platform convention puts a long-press result.
 *
 * Delete always opens a second step. It is the only destructive action here
 * and the only one whose two outcomes differ in who they affect, so it is
 * never a single tap away — that is the Telegram/WhatsApp pattern, and the
 * reason is that "delete for everyone" cannot be undone by the person who
 * regrets it.
 */

/** Below this the menu is a sheet, above it a popover. Matches `--bp-chat`. */
const TOUCH_QUERY = '(max-width: 720px), (pointer: coarse)';

type Stage = 'closed' | 'menu' | 'confirm';

export function MessageMenu({
  message,
  myId,
  anchor,
  onEdit,
  onDelete,
  onClose,
}: {
  message: ThreadMessage;
  myId: string | null;
  /** Where the popover should sit. Ignored in sheet mode. */
  anchor: { x: number; y: number } | null;
  onEdit: () => void;
  onDelete: (scope: DeleteScope) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>('menu');
  const [sheet, setSheet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState<{ x: number; y: number } | null>(anchor);

  /**
   * Keeps the popover on screen.
   *
   * A right-click near the right or bottom edge — which is exactly where an
   * outgoing bubble sits — would otherwise open a menu running off the
   * viewport with no way to reach its items. Measured after mount because the
   * height depends on which items this particular message offers.
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
  }, [anchor, sheet, stage]);

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

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(message.text).catch(() => {});
    onClose();
  }, [message.text, onClose]);

  const mayEdit = canEdit(message, myId);
  const mayDeleteAll = canDeleteForEveryone(message, myId);

  /**
   * A tombstone has nothing to act on: no text to copy, no body to edit, and
   * it is already deleted for everyone. Hiding it for yourself is still
   * legitimate, which is why the menu opens straight on the confirm step
   * rather than not opening at all.
   */
  const gone = message.deletedForEveryone;

  const body = (
    <div
      ref={rootRef}
      className={sheet ? 'msg-sheet' : 'msg-menu'}
      style={
        sheet || !clamped ? undefined : { left: `${clamped.x}px`, top: `${clamped.y}px` }
      }
      role="menu"
      aria-label="Message actions"
    >
      {stage === 'menu' && !gone && (
        <>
          {mayEdit && (
            <button type="button" role="menuitem" onClick={onEdit}>
              <Pencil /> Edit
            </button>
          )}
          <button type="button" role="menuitem" onClick={copy}>
            <Copy /> Copy
          </button>
          <button type="button" role="menuitem" onClick={() => setStage('confirm')}>
            <Trash /> Delete
          </button>
        </>
      )}

      {(stage === 'confirm' || gone) && (
        <>
          <p className="msg-sheet-title">Delete message?</p>
          <button type="button" role="menuitem" onClick={() => onDelete('me')}>
            Delete for me
          </button>
          {/*
            Shown only when it is actually available. A disabled ghost button
            here would advertise a capability the viewer does not have and
            leave them wondering why — the window having closed is not
            something a greyed-out control can explain.
          */}
          {mayDeleteAll && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => onDelete('everyone')}
            >
              Delete for everyone
            </button>
          )}
          <button type="button" role="menuitem" className="msg-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
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

/**
 * Long-press detection for touch.
 *
 * 450ms, and cancelled by movement over a small threshold — without that, the
 * start of a scroll registers as a press and the sheet opens under a thumb
 * that was on its way somewhere else. `pointer` events rather than `touch`
 * so a stylus behaves the same.
 */
export function useLongPress(onLongPress: (at: { x: number; y: number }) => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const at = { x: e.clientX, y: e.clientY };
      origin.current = at;
      timer.current = window.setTimeout(() => onLongPress(at), 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current;
      if (!o) return;
      if (Math.abs(e.clientX - o.x) > 8 || Math.abs(e.clientY - o.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}
