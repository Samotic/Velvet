'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { browse } from '@/lib/catalog';

/**
 * The ambient wall behind the sign-in panel: real trending posters in two
 * staggered columns, heavily darkened so the form beside them stays the thing
 * you look at.
 *
 * The columns drift on a slow infinite loop, alternating direction. The pace is
 * deliberately near-subliminal — the form beside it is what you came here to
 * use, so the wall may add atmosphere but must never pull the eye while you
 * type. Each column therefore renders its posters twice, so the loop closes
 * without a visible seam, and the motion stops dead under
 * `prefers-reduced-motion`.
 *
 * ── Why it starts empty and fills in ──
 * This is the one screen that must paint for someone with no session, and
 * possibly no working API. So the tiles render immediately as indigo-gradient
 * placeholders and upgrade to posters when the catalogue answers. If the request
 * fails — API down, no TMDB key, offline — the gradients simply stay, and the
 * screen still reads as Velvet. A background that is sometimes a blank rectangle
 * is not acceptable on the front door.
 *
 * `/api/tmdb/trending` is public (see the access-level note in the API's route
 * table), so this works signed out. `auth: false` inside `browse` means no token
 * is attached and no 401 teardown can fire from here.
 */

/**
 * Four columns of five. Two columns made each tile ~420px wide on a desktop
 * panel — at a poster's 2:3 that is 630px tall, so barely one and a half fit and
 * the result read as a few big empty blocks rather than a wall.
 */
const COLUMNS = 4;
const PER_COLUMN = 5;
const TOTAL = COLUMNS * PER_COLUMN;

export function PosterWall() {
  const [posters, setPosters] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const items = await browse({ sort: 'trending', signal: controller.signal });
        const urls = items
          .map((i) => i.posterUrl)
          .filter((u): u is string => Boolean(u))
          .slice(0, TOTAL);
        // A part-filled wall looks like a bug; keep the placeholders instead.
        if (urls.length >= TOTAL) setPosters(urls);
      } catch {
        /* Placeholders are the fallback — nothing to report on a background. */
      }
    })();

    return () => controller.abort();
  }, []);

  return (
    <div className="poster-wall">
      {Array.from({ length: COLUMNS }, (_, col) => (
        <Column
          key={col}
          posters={posters.slice(col * PER_COLUMN, (col + 1) * PER_COLUMN)}
          // Alternate columns hang lower so the tiles don't line up into rows —
          // the stagger is what makes a still wall read as a wall.
          className={`poster-col${col % 2 ? ' poster-col-offset' : ''}`}
        />
      ))}
      <div className="poster-wall-veil" />
    </div>
  );
}

function Column({ posters, className }: { posters: string[]; className: string }) {
  // Placeholder slots so the column occupies its full height before anything
  // loads, rather than the panel visibly filling in from the top.
  const slots = posters.length ? posters : Array.from({ length: PER_COLUMN }, () => null);

  // Rendered twice. The drift shifts a column by exactly one set, so the copy
  // arrives where the original began and the loop has no seam. Without the
  // duplicate the column would run out and snap back once a minute.
  const looped = [...slots, ...slots];

  return (
    <div className={className}>
      {looped.map((src, i) => (
        <div key={i} className="poster-tile">
          {src && (
            <Image
              src={src}
              alt=""
              fill
              sizes="(max-width: 900px) 0px, 30vw"
              className="poster-tile-img"
              /* Eager, not lazy. These tiles fill the visible panel on load, so
                 deferring them leaves the whole left half empty — which is
                 exactly how this looked before. Not `priority` either: that
                 preloads ahead of the form, and the form is what matters. */
              loading="eager"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}
