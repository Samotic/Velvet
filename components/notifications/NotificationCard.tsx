'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { VelvetMark } from '@/components/icons';
import { notificationLine } from '@/components/notifications/line';
import type { Notification } from '@/lib/contentTypes';
import { compactCount, timeAgo } from '@/lib/format';
import { respondToRequest } from '@/lib/notifications';
import { followUser } from '@/lib/users';

/**
 * One notification row. Three layouts, one component, because the header —
 * avatar, name, handle, relative time — is identical across all of them and
 * only the trailing action differs.
 *
 * ── Why errors are inline ──
 * Every action here is optimistic: local state moves first, the response
 * reconciles. On failure the row reverts and says so **on itself**, not in a
 * toast. With several rows on screen a global "Couldn't accept" tells you that
 * something failed but not which one, which is the part you need.
 */

type Props = {
  n: Notification;
  /** Lets the parent keep its copy in step after an action resolves. */
  onChange?: (patch: Partial<Notification>) => void;
};

export function NotificationCard({ n, onChange }: Props) {
  const { text, href, system } = notificationLine(n);
  const actor = n.actor ?? n.from;

  return (
    <article className={`notif-card${n.read ? '' : ' unread'}`}>
      {/* The whole row is the link; the action buttons stop propagation so a
          tap on Accept doesn't also navigate away from the thing you accepted. */}
      <Link href={href} className="notif-card-main">
        {system ? (
          <span className="notif-mark" aria-hidden="true">
            <VelvetMark />
          </span>
        ) : (
          <Avatar src={actor?.profilePhoto ?? null} name={actor?.displayName ?? '?'} />
        )}

        <div className="notif-card-body">
          <p className="notif-card-line">
            {actor ? <strong>{actor.displayName}</strong> : null}
            {actor ? text.replace(actor.displayName, '') : text}
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

      <div className="notif-card-action" onClick={(e) => e.stopPropagation()}>
        {n.type === 'follow_request' && <RequestActions n={n} onChange={onChange} />}
        {(n.type === 'new_follower' || n.type === 'follow') && (
          <FollowBack n={n} onChange={onChange} />
        )}
      </div>
    </article>
  );
}

/** Accept / Decline, replaced in place by the resolved state. */
function RequestActions({ n, onChange }: Props) {
  const [state, setState] = useState(n.actionState ?? 'pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'accepted' | 'declined' | null>(null);

  // Resolved rows keep their place in the list showing what happened — a row
  // vanishing under the user's finger is disorienting.
  if (state === 'accepted') return <span className="notif-resolved">Accepted</span>;
  if (state === 'declined') return <span className="notif-resolved">Declined</span>;

  async function respond(action: 'accepted' | 'declined') {
    if (!n.followRequestId || busy) return;

    setBusy(true);
    setError(null);
    setState(action); // optimistic

    try {
      await respondToRequest(n.followRequestId, action);
      onChange?.({ actionState: action, read: true });
    } catch {
      setState('pending'); // revert
      setError(action);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <button type="button" className="notif-retry" onClick={() => void respond(error)}>
        Couldn&apos;t {error === 'accepted' ? 'accept' : 'decline'}. Tap to retry.
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-fill notif-btn"
        disabled={busy}
        onClick={() => void respond('accepted')}
      >
        Accept
      </button>
      <button
        type="button"
        className="btn-outline notif-btn"
        disabled={busy}
        onClick={() => void respond('declined')}
      >
        Decline
      </button>
    </>
  );
}

/**
 * Follow back — shown only when the viewer doesn't already follow the actor.
 * Resolves to "Following" or "Requested" depending on what the server says,
 * because a private account turns the same press into a request.
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

  const actorId = (n.actor ?? n.from)?.id;
  if (!actorId) return null;

  if (status === 'accepted') return <span className="notif-resolved">Following</span>;
  if (status === 'pending') return <span className="notif-resolved">Requested</span>;

  async function follow() {
    if (busy) return;
    setBusy(true);
    setError(false);
    // Optimistic, but 'accepted' is a guess: a private target answers
    // 'pending'. The response overwrites it either way.
    setStatus('accepted');

    try {
      const result = await followUser(actorId!);
      setStatus(result);
      onChange?.({ viewerFollowsActor: result === 'accepted', viewerRequestedActor: result === 'pending' });
    } catch {
      setStatus(null);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <button type="button" className="notif-retry" onClick={() => void follow()}>
        Couldn&apos;t follow. Tap to retry.
      </button>
    );
  }

  return (
    <button type="button" className="btn-fill notif-btn" disabled={busy} onClick={() => void follow()}>
      Follow back
    </button>
  );
}
