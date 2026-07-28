'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Toasts: bottom right, dark card, copper dot.
 *
 * A stack rather than a single slot — saving three titles in quick succession
 * should show three confirmations, not one that keeps resetting its timer.
 * Each entry removes itself after its own timeout.
 */

type Tone = 'ok' | 'bad';
type Entry = { id: number; message: string; tone: Tone };

type ToastFn = ((message: string) => void) & {
  ok: (message: string) => void;
  bad: (message: string) => void;
};

// Cast through `unknown`: the callable and its `.ok`/`.bad` properties are
// attached in two steps, so the intermediate value isn't yet a ToastFn.
const noop = (() => {}) as unknown as ToastFn;
noop.ok = () => {};
noop.bad = () => {};

const ToastContext = createContext<ToastFn>(noop);

export const useToast = () => useContext(ToastContext);

const LIFETIME = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Entry[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const push = useCallback((message: string, tone: Tone) => {
    const id = nextId.current++;
    setItems((prev) => {
      const next = [...prev, { id, message, tone }];
      // Cap the stack so a runaway loop can't paper over the screen.
      return next.length > 4 ? next.slice(next.length - 4) : next;
    });

    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(timer);
    }, LIFETIME);
    timers.current.add(timer);
  }, []);

  // Clear any pending timers on unmount so they can't fire into a dead tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const toast = useMemo<ToastFn>(() => {
    const fn = ((message: string) => push(message, 'ok')) as ToastFn;
    fn.ok = (message: string) => push(message, 'ok');
    fn.bad = (message: string) => push(message, 'bad');
    return fn;
  }, [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'bad' ? ' bad' : ''}`}>
            <i />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
