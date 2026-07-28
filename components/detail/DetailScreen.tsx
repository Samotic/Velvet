'use client';

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { Reveal } from '@/components/ui/Reveal';
import { Loading } from '@/components/ui/States';
import { StarFilled } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { getDetail } from '@/lib/catalog';
import type { CatalogDetail, ContentType } from '@/lib/contentTypes';
import { formatScore, initial, splitTitle } from '@/lib/format';

import { AiOpinion } from './AiOpinion';
import { CommunityScore } from './CommunityScore';
import { DetailActions } from './DetailActions';
import { RateCard } from './RateCard';
import { ReviewList } from './ReviewList';

/**
 * One title, whatever its kind. Films, series and games share this screen —
 * the backend maps all three into `CatalogDetail`, so the only differences are
 * which fields happen to be null.
 */
export function DetailScreen({ type, id }: { type: ContentType; id: string }) {
  const [item, setItem] = useState<CatalogDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setItem(null);
    setMissing(false);

    getDetail(type, id, controller.signal)
      .then(setItem)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setMissing(true);
      });

    return () => controller.abort();
  }, [type, id]);

  // A rating write anywhere on this screen should refresh the community panel.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpCommunity = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (missing) notFound();
  if (!item) return <Loading />;

  const { lead, accent } = splitTitle(item.title);
  const overviewLong = item.overview.length > 340;

  return (
    <>
      <section className="detail-hero">
        <div className={`detail-backdrop${item.backdropUrl ? '' : ' plain'}`}>
          {item.backdropUrl && (
            <Image src={item.backdropUrl} alt="" fill priority sizes="100vw" />
          )}
        </div>

        <div className="detail-hero-inner">
          <div className="detail-poster">
            {item.posterUrl ? (
              <Image
                src={item.posterUrl}
                alt={item.title}
                fill
                priority
                sizes="(min-width:900px) 260px, 172px"
              />
            ) : (
              <div className="poster-fallback">{initial(item.title)}</div>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="badges">
              {item.genres.slice(0, 3).map((g, i) => (
                <span key={g} className={i === 0 ? 'badge' : 'badge alt'}>
                  {g}
                </span>
              ))}
              {item.certification && <span className="badge alt">{item.certification}</span>}
            </div>

            <h1 className="detail-title">
              {lead && `${lead} `}
              <em>{accent}</em>
            </h1>

            {item.tagline && <p className="detail-tagline">{item.tagline}</p>}

            <div className="meta-row">
              {item.score !== null && (
                <span className="score">
                  <StarFilled />
                  {formatScore(item.score)}
                </span>
              )}
              {item.year && (
                <>
                  <span className="dot" />
                  <span>{item.year}</span>
                </>
              )}
              {item.runtime && (
                <>
                  <span className="dot" />
                  <span>{item.runtime}</span>
                </>
              )}
            </div>

            <DetailActions item={item} />
          </div>
        </div>
      </section>

      <div className="detail-body">
        {item.overview && (
          <Reveal>
            <p className="overview">
              {overviewLong && !expanded
                ? `${item.overview.slice(0, 340).trimEnd()}… `
                : `${item.overview} `}
              {overviewLong && !expanded && (
                <button type="button" className="read-more" onClick={() => setExpanded(true)}>
                  more
                </button>
              )}
            </p>
          </Reveal>
        )}

        {item.cast.length > 0 && (
          <Reveal as="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-num">01</span>
                Cast
              </h2>
            </div>
            <div className="scroller">
              {item.cast.map((c) => (
                <div key={c.id} className="cast-card">
                  <div className="cast-photo">
                    {c.photoUrl ? (
                      <Image src={c.photoUrl} alt="" fill sizes="116px" />
                    ) : (
                      initial(c.name)
                    )}
                  </div>
                  <div className="cast-name">{c.name}</div>
                  {c.role && <div className="cast-role">{c.role}</div>}
                </div>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal as="section">
          <div className="section-head">
            <h2 className="section-title">
              <span className="section-num">02</span>
              Community
            </h2>
          </div>
          <CommunityScore contentId={item.id} contentType={item.type} refreshKey={refreshKey} />
        </Reveal>

        <Reveal as="section">
          <div className="section-head" id="rate">
            <h2 className="section-title">
              <span className="section-num">03</span>
              Rate It
            </h2>
          </div>
          <RateCard item={item} onSaved={bumpCommunity} />
        </Reveal>

        <Reveal as="section">
          <AiOpinion item={item} />
        </Reveal>

        <Reveal as="section">
          <ReviewList contentId={item.id} contentType={item.type} refreshKey={refreshKey} />
        </Reveal>

        {item.similar.length > 0 && (
          <Reveal as="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-num">05</span>
                More like this
              </h2>
              <Link href={`/search?q=${encodeURIComponent(item.genres[0] ?? item.title)}`} className="section-link">
                Explore
              </Link>
            </div>
            <div className="rail">
              {item.similar.slice(0, 6).map((s) => (
                <PosterCard key={`${s.type}-${s.id}`} item={s} />
              ))}
            </div>
          </Reveal>
        )}
      </div>
    </>
  );
}
