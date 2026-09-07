'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { RowsSkeleton } from '@/components/ui/States';
import { Search as SearchIcon } from '@/components/icons';
import { timeAgo } from '@/lib/format';
import { applyPreview, sortConversations } from '@/lib/messageEvents';
import { getConversations } from '@/lib/messages';
import type { Conversation } from '@/lib/contentTypes';
import { onSocket } from '@/lib/socket';

/**
 * The conversations column.
 *
 * Refreshes on every incoming message so previews, ordering and unread dots
 * stay correct while the user is looking at another thread.
 */
export function Inbox({ activeUserId }: { activeUserId?: string }) {
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback((signal?: AbortSignal) => {
    getConversations(signal)
      .then(setItems)
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

  useEffect(() => onSocket('message:new', () => load()), [load]);

  /**
   * Edits and deletes patch the affected row in place rather than refetching.
   *
   * The three events already carry this viewer's own preview — computed
   * server-side, because once a message can be hidden for one participant the
   * row has two different correct answers. Applying the payload is therefore
   * both cheaper than a reload *and* the only way to get "You: " right: after
   * a delete the row may belong to a different message by a different person,
   * which nothing on this client can work out for itself.
   *
   * Re-sorted after every patch because `previewAt` can move **backwards** —
   * hiding a message uncovers an older one — so the existing order is not
   * safe to assume.
   */
  useEffect(() => {
    const patch = (p: Parameters<typeof applyPreview>[1]) =>
      setItems((prev) => (prev ? sortConversations(applyPreview(prev, p)) : prev));

    const offEdited = onSocket('message:edited', patch);
    const offDeleted = onSocket('message:deleted', patch);
    const offForMe = onSocket('message:deletedForMe', patch);

    return () => {
      offEdited();
      offDeleted();
      offForMe();
    };
  }, []);

  const filtered = (items ?? []).filter((c) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return (
      c.user.displayName.toLowerCase().includes(term) ||
      c.user.username.toLowerCase().includes(term)
    );
  });

  return (
    <div className="msg-list">
      <div className="msg-list-head">
        {/* `--search-top` nudges the icon to match this field's shorter height. */}
        <div
          className="search-wrap"
          style={{ paddingBottom: 0, ['--search-top' as string]: '21px' }}
        >
          <SearchIcon className="search-icon" />
          <input
            className="search-field"
            style={{ padding: '12px 16px 12px 44px', fontSize: 14 }}
            placeholder="Search people…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search conversations"
          />
        </div>
      </div>

      <div className="msg-list-scroll">
        {items === null ? (
          <div style={{ padding: 16 }}>
            <RowsSkeleton count={6} height={58} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="menu-empty" style={{ padding: '38px 18px' }}>
            {q ? 'No matches.' : 'No conversations yet.'}
          </div>
        ) : (
          filtered.map((c) => (
            <Link
              key={c.id}
              href={`/messages/${c.user.id}`}
              className={`conv${c.user.id === activeUserId ? ' active' : ''}${
                c.unread > 0 ? ' unread' : ''
              }`}
            >
              <Avatar src={c.user.profilePhoto} name={c.user.displayName} />
              <div className="conv-body">
                <div className="conv-top">
                  <span className="conv-name">{c.user.displayName}</span>
                  <span className="conv-time">{timeAgo(c.lastMessageAt)}</span>
                </div>
                <div className="conv-preview">
                  {c.lastFromMe && 'You: '}
                  {c.lastMessage || 'Say hello'}
                </div>
              </div>
              {c.unread > 0 && <span className="conv-dot" aria-label={`${c.unread} unread`} />}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
