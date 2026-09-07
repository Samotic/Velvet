'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, RowsSkeleton } from '@/components/ui/States';
import { compactCount } from '@/lib/format';
import { getFollowRequests, type FollowRequest } from '@/lib/notifications';
import { onSocket } from '@/lib/socket';

import { FollowRequestActions } from './FollowRequestActions';
import styles from './followRequests.module.css';

/** Matches the .24s on `.card` in followRequests.module.css. */
const LEAVE_MS = 240;
/** Faces on the collapsed row. Three is enough to read as "several people". */
const FACES = 3;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The pending queue.
 *
 * It lives on **its own screen**, reached from a single collapsed row at the
 * top of /notifications. A request is the one notification that is a task: it
 * stays until answered, and a queue of twelve inlined above the feed buries
 * everything else on the page rather than surfacing itself.
 *
 * One hook serves both, so the row's count and the screen's list can never
 * disagree about how many are waiting.
 */
function useFollowRequestQueue(limit?: number) {
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Ids mid-animation: resolved on the server, still on screen. */
  const [leaving, setLeaving] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = useCallback(
    (signal?: AbortSignal) => {
      getFollowRequests({ limit, signal })
        .then((page) => {
          setRequests(page.requests);
          setCursor(page.nextCursor);
          setTotal(page.total);
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // A queue that cannot load renders as no queue rather than as an
          // error banner over someone's notifications.
          setRequests([]);
          setCursor(null);
          setTotal(0);
          setLoading(false);
        });
    },
    [limit],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Clear pending removal timers if this unmounts mid-animation.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** A request arriving while the page is open drops straight into the queue. */
  useEffect(
    () =>
      onSocket('notification:new', (raw) => {
        if ((raw as { type?: string })?.type === 'follow_request') load();
      }),
    [load],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getFollowRequests({ cursor, limit });
      // Guard against a row that arrived at the top since the first page.
      setRequests((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.requests.filter((r) => !seen.has(r.id))];
      });
      setCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      setCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, limit, loadingMore]);

  /**
   * Both outcomes animate the card out. The count drops immediately rather
   * than when the animation ends, so the heading agrees with the button the
   * user just pressed instead of trailing it by a quarter of a second.
   */
  const resolve = useCallback((id: string) => {
    setLeaving((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setTotal((n) => Math.max(0, n - 1));

    const remove = () => {
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setLeaving((prev) => prev.filter((x) => x !== id));
    };

    if (reducedMotion()) {
      remove();
      return;
    }
    timers.current.push(setTimeout(remove, LEAVE_MS));
  }, []);

  return { requests, total, cursor, loading, loadingMore, leaving, loadMore, resolve };
}

/**
 * The collapsed row at the top of /notifications: faces, a count, a chevron.
 *
 * Renders nothing while loading and nothing when the queue is empty. A row that
 * flashes "Follow Requests 0" and vanishes is worse than no row, so there is no
 * skeleton here.
 */
export function FollowRequestsSummary() {
  const { requests, total, loading } = useFollowRequestQueue(FACES);

  if (loading || total === 0) return null;

  const faces = requests.slice(0, FACES);
  const names = faces.map((r) => r.from.displayName);
  const lead = names[0] ?? 'Someone';
  const others = total - 1;

  return (
    <Link href="/notifications/requests" className={styles.summary}>
      <span className={styles.faces} aria-hidden="true">
        {faces.map((r) => (
          <span
            key={r.id}
            className={styles.face}
            style={r.from.profilePhoto ? { backgroundImage: `url(${r.from.profilePhoto})` } : undefined}
          >
            {!r.from.profilePhoto && (r.from.displayName[0] ?? '?')}
          </span>
        ))}
      </span>

      <span className={styles.summaryText}>
        <span className={styles.summaryTitle}>Follow Requests</span>
        <span className={styles.summarySub}>
          {others > 0 ? `${lead} and ${compactCount(others)} other${others === 1 ? '' : 's'}` : lead}
          {' · approve or decline'}
        </span>
      </span>

      <span className={styles.count}>{compactCount(total)}</span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

/**
 * The full queue, on its own screen.
 *
 * Owns its loading and empty states rather than handing them back to the page,
 * because the page cannot render either one correctly without duplicating the
 * hook that knows whether the fetch has landed.
 */
export function FollowRequestsList() {
  const { requests, total, cursor, loading, loadingMore, leaving, loadMore, resolve } =
    useFollowRequestQueue();

  if (loading) return <RowsSkeleton count={4} height={82} />;

  if (total === 0 && requests.length === 0) {
    return (
      <EmptyState
        icon="◔"
        title="No follow requests"
        text="When someone asks to follow you, they'll wait here for your answer."
        action={{ label: 'Back to notifications', href: '/notifications' }}
      />
    );
  }

  return (
    <>
      <ul className={styles.list}>
        {requests.map((request) => (
          <li
            key={request.id}
            className={`${styles.card}${leaving.includes(request.id) ? ` ${styles.leaving}` : ''}`}
          >
            <div className={styles.cardInner}>
              <div className={styles.cardContent}>
                <Link
                  href={`/profile/${encodeURIComponent(request.from.username)}`}
                  className={styles.identity}
                >
                  <Avatar
                    src={request.from.profilePhoto}
                    name={request.from.displayName}
                    className={styles.avatar}
                  />
                  <span className={styles.details}>
                    <span className={styles.name}>{request.from.displayName}</span>
                    <span className={styles.handle}>@{request.from.username}</span>
                    <span className={styles.meta}>
                      {compactCount(request.from.followerCount)}{' '}
                      {request.from.followerCount === 1 ? 'follower' : 'followers'}
                    </span>
                  </span>
                </Link>

                <FollowRequestActions
                  userId={request.from.id}
                  requestId={request.id}
                  onResolved={() => resolve(request.id)}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          className={`btn-outline ${styles.more}`}
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? 'Loading…' : 'Show more requests'}
        </button>
      )}
    </>
  );
}
