'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState, RowsSkeleton } from '@/components/ui/States';
import { getActivityFeed } from '@/lib/catalog';
import { hrefFor, type ActivityItem } from '@/lib/contentTypes';
import { stars, timeAgo } from '@/lib/format';

/** The emotion reactions the feed offers. Local-only for now — the backend has
 *  no reaction endpoint yet, so these are a per-session flourish. */
const REACTIONS = ['🔥', '😭', '🤯', '❤️'];

function verb(item: ActivityItem): string {
  switch (item.action) {
    case 'rated':
      return 'rated';
    case 'reviewed':
      return 'reviewed';
    case 'watchlisted':
      return 'added to their watchlist';
    case 'finished':
      return 'finished';
    default:
      return 'watched';
  }
}

/** Section 04 — a live feed of what the people you follow are watching. */
export function FriendsActivity() {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [reacted, setReacted] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    getActivityFeed(controller.signal)
      .then(setItems)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setItems([]);
      });
    return () => controller.abort();
  }, [isAuthenticated]);

  const header = (
    <div className="section-head">
      <div>
        <h2 className="section-title">
          <span className="section-num">04</span>
          Friends Activity
        </h2>
        <p className="section-sub">What the people you follow have been watching.</p>
      </div>
      <Link href="/search?mode=people" className="section-link">
        Find people
      </Link>
    </div>
  );

  if (items === null) {
    return (
      <>
        {header}
        <RowsSkeleton count={4} height={74} />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon="◈"
          title={isAuthenticated ? 'Quiet in here' : 'Follow some people'}
          text={
            isAuthenticated
              ? 'Follow a few people and their ratings will show up here as they watch.'
              : 'Sign in and follow people whose taste you trust — their activity lands here.'
          }
          action={
            isAuthenticated
              ? { label: 'Find people', href: '/search?mode=people' }
              : { label: 'Sign in', href: '/login' }
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="activity-list" style={{ paddingBottom: 40 }}>
        {items.map((item) => (
          <div key={item.id} className="activity-row">
            <Avatar
              src={item.user.profilePhoto}
              name={item.user.displayName}
              href={`/profile/${item.user.username}`}
            />

            <Link
              href={hrefFor(item.contentType, item.contentId)}
              className="activity-thumb"
              aria-label={item.contentTitle}
            >
              {item.poster && <Image src={item.poster} alt="" fill sizes="42px" />}
            </Link>

            <div className="activity-body">
              <div className="activity-text">
                <b>{item.user.displayName}</b> {verb(item)}{' '}
                <Link href={hrefFor(item.contentType, item.contentId)} className="title">
                  {item.contentTitle}
                </Link>
              </div>
              <div className="activity-meta">
                {item.rating != null && (
                  <span style={{ color: 'var(--accent)' }}>{stars(item.rating)}</span>
                )}
                <span>{timeAgo(item.createdAt)}</span>
              </div>
            </div>

            <div className="reactions">
              {REACTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`reaction${reacted[item.id] === r ? ' on' : ''}`}
                  aria-label={`React ${r}`}
                  aria-pressed={reacted[item.id] === r}
                  onClick={() =>
                    setReacted((prev) => {
                      const next = { ...prev };
                      if (next[item.id] === r) delete next[item.id];
                      else next[item.id] = r;
                      return next;
                    })
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
