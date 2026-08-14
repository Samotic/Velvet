'use client';

import Image from 'next/image';
import Link from 'next/link';

import { StarFilled } from '@/components/icons';
import { formatScore, splitTitle } from '@/lib/format';
import { hrefFor, type CatalogSummary } from '@/lib/contentTypes';

import { HeroActions } from './HeroActions';

/**
 * The featured title, with the floating three-poster cluster beside it.
 *
 * The title splits two-tone — first word upright in the off-white, the rest in
 * the indigo DM Serif italic. That gesture is the brand's signature; it also
 * appears on every detail hero.
 */
export function Hero({
  item,
  cluster,
  loading,
}: {
  item: CatalogSummary | null;
  cluster: CatalogSummary[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="home-hero" aria-hidden>
        <div className="hero-copy">
          <div className="skeleton" style={{ width: 220, height: 30, borderRadius: 100 }} />
          <div className="skeleton" style={{ height: 78, marginTop: 22 }} />
          <div className="skeleton" style={{ height: 78, width: '70%', marginTop: 10 }} />
          <div className="skeleton" style={{ height: 15, width: '46%', marginTop: 26 }} />
          <div className="skeleton" style={{ height: 60, marginTop: 22 }} />
        </div>
        <div className="poster-cluster">
          {[0, 1, 2].map((i) => (
            <div key={i} className="cluster-card skeleton" />
          ))}
        </div>
      </section>
    );
  }

  if (!item) return null;

  const { lead, accent } = splitTitle(item.title);

  return (
    <section className="home-hero">
      <div className="hero-copy">
        <div className="hero-tags">
          <span className="eyebrow">Featured Tonight</span>
          <span className="rank-label">#1 This Week</span>
        </div>

        <h1 className="hero-title">
          {lead}
          <em>{accent}</em>
        </h1>

        <div className="hero-meta">
          {item.score !== null && (
            <span className="hero-score">
              <StarFilled size={15} />
              {formatScore(item.score)}
            </span>
          )}
          {item.genres.length > 0 && <span>{item.genres.slice(0, 2).join(' · ')}</span>}
          {item.year && <span>{item.year}</span>}
        </div>

        {item.overview && <p className="hero-desc">{item.overview}</p>}

        <HeroActions item={item} />
      </div>

      <div className="poster-cluster">
        {cluster.map((c) => (
          <Link
            key={`${c.type}-${c.id}`}
            href={hrefFor(c.type, c.id)}
            className="cluster-card"
            aria-label={c.title}
          >
            {c.posterUrl ? (
              <Image
                src={c.posterUrl}
                alt=""
                fill
                sizes="(min-width:1024px) 260px, 190px"
                priority={c.id === item.id}
              />
            ) : (
              <span className="cluster-letter">{c.title.charAt(0)}</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
