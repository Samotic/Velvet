'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { VelvetMark } from '@/components/icons';
import { notificationLine } from '@/components/notifications/line';
import type { Notification } from '@/lib/contentTypes';
import { compactCount, timeAgo } from '@/lib/format';
import { followUser, unfollowUser } from '@/lib/users';
import { RippleButton } from '@/components/ui/Ripple';
import { FollowRequestActions } from './FollowRequestActions';
import { FollowNotificationIcon } from './FollowNotificationIcon';
import styles from './followRequests.module.css';

/**
 * One notification row. Three layouts, one component, because the header —
 * avatar, name, handle, relative time — is identical across all of them and
 * only the trailing action differs.
 *
 * ── Why errors are inline ──
 * Actions settle after the server confirms them. Errors stay on the row so
 * several simultaneous requests cannot leave an ambiguous global message.
 */

type Props = {
  n: Notification;
  /** Lets the parent keep its copy in step after an action resolves. */
  onChange?: (patch: Partial<Notification>) => void;
  compact?: boolean;
};

export function NotificationCard({ n, onChange, compact = false }: Props) {
  const { text, href, system } = notificationLine(n);
  const actor = n.actor ?? n.from;
  const isFollow = n.type === 'follow_request' || n.type === 'follow_accepted';
  const label = isFollow ? actor?.username : actor?.displayName;

  return (
    <article className={`notif-card ${styles.notification}${compact ? ` ${styles.compact}` : ''}${n.read ? '' : ' unread'}`}>
      {/* The whole row is the link; the action buttons stop propagation so a
          tap on Accept doesn't also navigate away from the thing you accepted. */}
      <Link href={href} className="notif-card-main">
        {system ? (
          <span className="notif-mark" aria-hidden="true">
            <VelvetMark />
          </span>
        ) : (
          <span className={styles.avatarWrap}>
            <Avatar src={actor?.profilePhoto ?? null} name={actor?.displayName ?? '?'} size={compact ? 'sm' : 'md'} />
            {isFollow && <span className={styles.badge}><FollowNotificationIcon accepted={n.type === 'follow_accepted'} /></span>}
          </span>
        )}

        <div className="notif-card-body">
          <p className="notif-card-line">
            {label && text.startsWith(label) ? <><strong>{label}</strong>{text.slice(label.length)}</> : text}
          </p>
          {actor && (
            <p className="notif-card-meta">
              @{actor.username}
              {n.actor && n.actor.ratingCount > 0 && (
                <> · {compactCount(n.actor.ratingCount)} rated</>
              )}
              {' · '}
              {timeAgo(n.createdAt)}
            </p>
          )}
          {!actor && <p className="notif-card-meta">{timeAgo(n.createdAt)}</p>}
        </div>
      </Link>

      {(n.type === 'follow_request' || n.type === 'new_follower' || n.type === 'follow') && <div className="notif-card-action" onClick={(e) => e.stopPropagation()}>
        {n.type === 'follow_request' && <FollowRequestActions
          userId={actor?.id}
          requestId={n.followRequestId}
          state={n.actionState ?? 'pending'}
          onResolved={(outcome) => onChange?.({ actionState: outcome, read: true })}
        />}
        {(n.type === 'new_follower' || n.type === 'follow') && (
          <FollowBack n={n} onChange={onChange} />
        )}
      </div>}
    </article>
  );
}

/**
 * Follow back creates a request; a pending request can be cancelled here.
 */
function FollowBack({ n, onChange }: Props) {
  const initial = n.viewerFollowsActor
    ? 'accepted'
    : n.viewerRequestedActor
      ? 'pending'
      : null;

  const [status, setStatus] = useState<'accepted' | 'pending' | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const locked = useRef(false);

  useEffect(() => setStatus(initial), [initial]);

  const actorId = (n.actor ?? n.from)?.id;
  if (!actorId) return null;

  if (status === 'accepted') return <span className="notif-resolved">Following</span>;
  async function follow() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);

    try {
      if (status === 'pending') {
        await unfollowUser(actorId!);
        setStatus(null);
        onChange?.({ viewerFollowsActor: false, viewerRequestedActor: false });
      } else {
        const result = await followUser(actorId!);
        setStatus(result);
        onChange?.({ viewerFollowsActor: result === 'accepted', viewerRequestedActor: result === 'pending' });
      }
    } catch {
      setError(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <RippleButton type="button" className={status === 'pending' ? styles.requested : styles.accept} disabled={busy} onClick={() => void follow()} aria-label={status === 'pending' ? 'Requested. Cancel follow request' : undefined}>
        {busy ? (status === 'pending' ? 'Cancelling…' : 'Requesting…') : status === 'pending' ? 'Requested' : 'Follow back'}
      </RippleButton>
      {error && <p className={styles.error} role="alert">Could not update your request. Please try again.</p>}
    </div>
  );
}
