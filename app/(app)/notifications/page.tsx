'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/components/Toast';
import { EmptyState, RowsSkeleton } from '@/components/ui/States';
import { NotificationCard } from '@/components/notifications/NotificationCard';
import { groupLabel, groupNotifications } from '@/components/notifications/aggregate';
import type { Notification } from '@/lib/contentTypes';
import {
  getNotifications,
  markNotificationsRead,
} from '@/lib/notifications';
import { onSocket } from '@/lib/socket';

export default function NotificationsPage() {
  return (
    <ProtectedRoute>
      <Notifications />
    </ProtectedRoute>
  );
}

function Notifications() {
  const toast = useToast();

  const [items, setItems] = useState<Notification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    getNotifications({ signal })
      .then((r) => {
        setItems(r.notifications);
        setCursor(r.nextCursor);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setItems([]);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // New arrivals prepend without a refetch.
  useEffect(
    () =>
      onSocket('notification:new', (raw) =>
        setItems((prev) => [raw as Notification, ...(prev ?? [])]),
      ),
    [],
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await getNotifications({ cursor });
      setItems((prev) => [...(prev ?? []), ...r.notifications]);
      setCursor(r.nextCursor);
    } catch {
      toast.bad('Could not load more');
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAll() {
    const snapshot = items;
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    try {
      await markNotificationsRead();
    } catch {
      setItems(snapshot ?? null);
      toast.bad('Could not mark those as read');
    }
  }

  /** Keeps the list's copy in step when a card resolves its own action. */
  const patch = useCallback((id: string, next: Partial<Notification>) => {
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, ...next } : n)) ?? prev);
  }, []);

  const groups = useMemo(() => groupNotifications(items ?? []), [items]);
  const unread = (items ?? []).filter((n) => !n.read).length;

  return (
    <div className="screen-narrow" style={{ paddingBottom: 60 }}>
      <div className="screen-head">
        <h1 className="screen-title">
          Notifications{unread > 0 && <em> · {unread}</em>}
        </h1>
      </div>

      {unread > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '18px 0 6px' }}>
          <button type="button" className="btn-outline" onClick={() => void markAll()}>
            Mark all as read
          </button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {items === null ? (
          <RowsSkeleton count={6} height={66} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="◔"
            title="No notifications yet"
            text="When someone follows you, it'll show up here."
            action={{ label: 'Find people', href: '/search?mode=people' }}
          />
        ) : (
          <>
            {groups.map((g) =>
              g.kind === 'single' ? (
                <NotificationCard
                  key={g.key}
                  n={g.item}
                  onChange={(next) => patch(g.item.id, next)}
                />
              ) : (
                <FollowerGroup key={g.key} items={g.items} onPatch={patch} />
              ),
            )}

            {cursor && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A collapsed run of follows. Expands into the individual rows, each keeping
 * its own Follow-back button — the summary is a shortcut past the noise, not a
 * replacement for the actions underneath it.
 */
function FollowerGroup({
  items,
  onPatch,
}: {
  items: Notification[];
  onPatch: (id: string, next: Partial<Notification>) => void;
}) {
  const [open, setOpen] = useState(false);
  const anyUnread = items.some((n) => !n.read);

  return (
    <div className="notif-group">
      <button
        type="button"
        className={`notif-group-head${anyUnread ? ' unread' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="notif-group-avatars" aria-hidden="true">
          {items.slice(0, 3).map((n) => {
            const a = n.actor ?? n.from;
            return (
              <span
                key={n.id}
                className="notif-group-av"
                style={
                  a?.profilePhoto
                    ? { backgroundImage: `url(${a.profilePhoto})` }
                    : undefined
                }
              >
                {!a?.profilePhoto && (a?.displayName?.[0] ?? '?')}
              </span>
            );
          })}
        </span>
        <span className="notif-group-text">{groupLabel(items)}</span>
        <span className="notif-group-chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="notif-group-items">
          {items.map((n) => (
            <NotificationCard key={n.id} n={n} onChange={(next) => onPatch(n.id, next)} />
          ))}
        </div>
      )}
    </div>
  );
}
