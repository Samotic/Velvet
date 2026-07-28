'use client';

import { useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { RowsSkeleton } from '@/components/ui/States';
import { Close } from '@/components/icons';
import type { PublicProfile } from '@/lib/authTypes';
import { compactCount } from '@/lib/format';
import { getFollowers, getFollowing } from '@/lib/users';

/** The follower / following list, shown over the profile. */
export function FollowModal({
  userId,
  mode,
  onClose,
}: {
  userId: string;
  mode: 'followers' | 'following';
  onClose: () => void;
}) {
  const [users, setUsers] = useState<PublicProfile[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = mode === 'followers' ? getFollowers : getFollowing;
    load(userId, controller.signal)
      .then(setUsers)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setUsers([]);
      });
    return () => controller.abort();
  }, [userId, mode]);

  // Escape closes, and the page behind shouldn't scroll while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="modal-veil"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'followers' ? 'Followers' : 'Following'}
      // Only a click on the veil itself closes — not one that bubbled up from
      // inside the panel.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <span className="modal-title">{mode === 'followers' ? 'Followers' : 'Following'}</span>
          <button type="button" className="icon-action" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </div>

        <div className="modal-body">
          {users === null ? (
            <div style={{ padding: 16 }}>
              <RowsSkeleton count={5} height={50} />
            </div>
          ) : users.length === 0 ? (
            <div className="menu-empty">
              {mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
            </div>
          ) : (
            users.map((u) => (
              <a key={u.id} href={`/profile/${u.username}`} className="user-row">
                <Avatar src={u.profilePhoto} name={u.displayName} size="sm" />
                <div className="user-row-body">
                  <div className="user-row-name">{u.displayName}</div>
                  <div className="user-row-handle">
                    @{u.username} · {compactCount(u.followerCount)} followers
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
