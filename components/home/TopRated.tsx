'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { StarFilled } from '@/components/icons';
import { formatScore, splitTitle } from '@/lib/format';
import { getTopRated } from '@/lib/catalog';
import { hrefFor, type CatalogSummary } from '@/lib/contentTypes';

/**
 * Section 02 — Top Rated All Time, in the editorial two-column layout: one
 * large lead poster, then a numbered list beside it.
 */
export function TopRated() {
  const [items, setItems] = useState<CatalogSummary[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getTopRated(controller.signal)
      .then(setItems)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setItems([]);
      });
    return () => controller.abort();
  }, []);

  // A one-item list has no "rest" to sit beside the lead, so the section would
  // render as a lone poster with an empty column — skip it entirely.
  if (items !== null && items.length < 2) return null;

  const [lead, ...rest] = items ?? [];
  const list = rest.slice(0, 6);

  return (
    <>
      <div className="section-head">
        <div>
          <h2 className="section-title">
            <span className="section-num">02</span>
            Top Rated All Time
          </h2>
          <p className="section-sub">The ones that hold up, ranked by everyone who watched.</p>
        </div>
        <Link href="/?sort=top" className="section-link">
          See the full list
        </Link>
      </div>

      {items === null ? (
        <div className="editorial">
          <div className="skeleton" style={{ aspectRatio: '3 / 4', borderRadius: 6 }} />
          <div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton" style={{ height: 58, marginBottom: 10 }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="editorial">
          <Link href={hrefFor(lead.type, lead.id)} className="editorial-lead">
            {lead.posterUrl && (
              <Image
                src={lead.posterUrl}
                alt=""
                fill
                sizes="(min-width:1024px) 520px, 100vw"
              />
            )}
            <div className="editorial-lead-body">
              <div className="editorial-rank">01 · Highest rated</div>
              <div className="editorial-title">
                {(() => {
                  const { lead: word, accent } = splitTitle(lead.title);
                  return (
                    <>
                      {word && `${word} `}
                      <em>{accent}</em>
                    </>
                  );
                })()}
              </div>
            </div>
          </Link>

          <div className="editorial-list">
            {list.map((item, i) => (
              <Link
                key={`${item.type}-${item.id}`}
                href={hrefFor(item.type, item.id)}
                className="editorial-row"
              >
                <span className="rank">{String(i + 2).padStart(2, '0')}</span>
                <span className="body">
                  <span className="name">{item.title}</span>
                  <span className="meta">
                    {[item.year, item.genres[0]].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {item.score !== null && (
                  <span className="score">
                    <StarFilled size={13} />
                    {formatScore(item.score)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
