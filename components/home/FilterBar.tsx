'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MouseEvent } from 'react';

import { Filter } from '@/components/icons';
import { useRipple } from '@/components/ui/Ripple';
import {
  GENRE_FILTERS,
  SORTS,
  TYPE_FILTERS,
  type SortId,
  type TypeFilterId,
} from '@/lib/homeFilters';

/**
 * Type tabs, genre tabs and the sort control.
 *
 * State lives in the URL so the top nav's Movies/Series/Games links and these
 * tabs stay in agreement, and so a filtered view is linkable and survives a
 * refresh.
 */
export function FilterBar({
  filter,
  genre,
  sort,
}: {
  filter: TypeFilterId;
  genre: string | null;
  sort: SortId;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ripple = useRipple();

  function go(next: Partial<{ filter: string; genre: string | null; sort: string }>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      // Defaults stay out of the URL so "/" is the canonical unfiltered view.
      if (!v || v === 'all' || (k === 'sort' && v === 'trending')) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const nextSort = SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length];
  const currentSort = SORTS.find((s) => s.id === sort) ?? SORTS[0];

  const click = (e: MouseEvent<HTMLButtonElement>, fn: () => void) => {
    ripple(e);
    fn();
  };

  return (
    <div className="chipbar">
      <div className="chips">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ripple-host${f.id === filter ? ' active' : ''}`}
            aria-pressed={f.id === filter}
            onClick={(e) => click(e, () => go({ filter: f.id }))}
          >
            {f.label}
          </button>
        ))}

        <span
          aria-hidden
          style={{
            width: 1,
            alignSelf: 'stretch',
            background: 'var(--line-soft)',
            margin: '0 4px',
            flexShrink: 0,
          }}
        />

        {GENRE_FILTERS.map((g) => (
          <button
            key={g}
            type="button"
            className={`chip chip-sm ripple-host${g === genre ? ' active' : ''}`}
            aria-pressed={g === genre}
            // Tapping the active genre clears it, so there's always a way back
            // to "everything" without hunting for an All chip.
            onClick={(e) => click(e, () => go({ genre: g === genre ? null : g }))}
          >
            {g}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="sort-btn"
        onClick={() => go({ sort: nextSort.id })}
        aria-label={`Sorted by ${currentSort.label}. Switch to ${nextSort.label}`}
      >
        <Filter />
        {currentSort.label}
      </button>
    </div>
  );
}
