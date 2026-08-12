'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/components/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, RowsSkeleton } from '@/components/ui/States';
import { VelvetMark } from '@/components/icons';
import { notificationLine } from '@/components/notifications/line';
import { api } from '@/lib/api';
import type { Notification } from '@/lib/contentTypes';
import { timeAgo } from '@/lib/format';
import { onSocket } from '@/lib/socket';

export default function NotificationsPage() {
  return (
    <ProtectedRoute>
      <Notifications />
    </ProtectedRoute>
  );
}

function Notifications() {
  const router = useRouter();
  const toast = useToast();

  const [items, setItems] = useState<Notification[] | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    api
      .get<{ notifications: Notification[] }>('/api/notifications', { signal })
      .then((r) => setItems(r.notifications))
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

  async function markAll() {
    const snapshot = items;
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    try {
      await api.put('/api/notifications/read-all');
    } catch {
      setItems(snapshot ?? null);
      toast.bad('Could not mark those as read');
    }
  }

  async function open(n: Notification) {
    const { href } = notificationLine(n);
    if (!n.read) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? prev);
      // Fire and forget: navigating matters more than the read receipt.
      void api.put(`/api/notifications/${n.id}/read`).catch(() => {});
    }
    router.push(href);
  }

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
            title="Nothing yet"
            text="Follows, likes, replies and your weekly AI picks all land here."
            action={{ label: 'Find people', href: '/search?mode=people' }}
          />
        ) : (
          items.map((n) => {
            const line = notificationLine(n);
            return (
              <button
                key={n.id}
                type="button"
                className={`notif${n.read ? '' : ' unread'}`}
                style={{ width: '100%', textAlign: 'left', background: 'none' }}
                onClick={() => void open(n)}
              >
                {line.system ? (
                  <span className="notif-mark" aria-hidden>
                    <VelvetMark size={19} />
                  </span>
                ) : (
                  <Avatar src={n.from?.profilePhoto} name={n.from?.displayName} />
                )}

                <span className="notif-body">
                  <span className="notif-text">{line.text}</span>
                  <span className="notif-time">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
