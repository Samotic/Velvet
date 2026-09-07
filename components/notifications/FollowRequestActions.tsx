'use client';

import { useEffect, useRef, useState } from 'react';
import { RippleButton } from '@/components/ui/Ripple';
import { ApiError } from '@/lib/api';
import {
  acceptFollowRequest,
  declineFollowRequest,
  respondToRequest,
  type RequestOutcome,
} from '@/lib/notifications';
import styles from './followRequests.module.css';

export function FollowRequestActions({
  userId,
  requestId,
  state = 'pending',
  variant = 'card',
  onResolved,
}: {
  userId?: string;
  requestId?: string | null;
  state?: 'pending' | RequestOutcome;
  /**
   * Presentation only — the handlers, the loading text and the disabled states
   * are identical either way.
   *
   * `card` is the notification and queue row: bordered, glyph-suffixed,
   * Accept first. `inline` is the profile banner: the shared `.btn-fill` and
   * `.btn-outline` primitives at row height, labels only, and Decline first so
   * the affirmative action sits furthest right.
   */
  variant?: 'card' | 'inline';
  onResolved?: (outcome: RequestOutcome) => void;
}) {
  const [resolved, setResolved] = useState(state);
  const [busy, setBusy] = useState<RequestOutcome | null>(null);
  const [error, setError] = useState('');
  /** The requester withdrew it; there is nothing left to answer. */
  const [gone, setGone] = useState(false);
  const locked = useRef(false);

  useEffect(() => setResolved(state), [state]);

  async function respond(action: RequestOutcome) {
    if (locked.current || (!userId && !requestId)) return;
    locked.current = true;
    setBusy(action);
    setError('');
    try {
      if (userId) {
        await (action === 'accepted' ? acceptFollowRequest(userId) : declineFollowRequest(userId));
      } else {
        await respondToRequest(requestId!, action);
      }
      setResolved(action);
      onResolved?.(action);
    } catch (err) {
      /**
       * 410 means the requester withdrew it while this card sat on screen.
       * Retrying can only fail the same way, so the card settles instead of
       * offering a button that is guaranteed not to work.
       */
      if (err instanceof ApiError && err.status === 410) {
        setGone(true);
        onResolved?.(action);
        return;
      }
      setError(`Could not ${action === 'accepted' ? 'accept' : 'decline'} this request. Please try again.`);
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }

  if (gone) {
    return <span className="notif-resolved" role="status">Withdrawn</span>;
  }
  if (resolved !== 'pending') {
    return <span className="notif-resolved" role="status">{resolved === 'accepted' ? 'Accepted ✓' : 'Declined'}</span>;
  }
  if (!userId && !requestId) return <span className="notif-resolved">Request unavailable</span>;

  if (variant === 'inline') {
    return (
      <div className="fr-inline-wrap">
        <div className="fr-inline" aria-busy={busy !== null}>
          <RippleButton type="button" className="btn-outline fr-btn" disabled={busy !== null} onClick={() => void respond('declined')}>
            {busy === 'declined' ? 'Declining…' : 'Decline'}
          </RippleButton>
          <RippleButton type="button" className="btn-fill fr-btn" disabled={busy !== null} onClick={() => void respond('accepted')}>
            {busy === 'accepted' ? 'Accepting…' : 'Accept'}
          </RippleButton>
        </div>
        {error && <p className="fr-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.actionsWrap}>
      <div className={styles.actions} aria-busy={busy !== null}>
        <RippleButton type="button" className={styles.accept} disabled={busy !== null} onClick={() => void respond('accepted')}>
          {busy === 'accepted' ? 'Accepting…' : 'Accept'} <span aria-hidden="true">✓</span>
        </RippleButton>
        <RippleButton type="button" className={styles.decline} disabled={busy !== null} onClick={() => void respond('declined')}>
          {busy === 'declined' ? 'Declining…' : 'Decline'} <span aria-hidden="true">✕</span>
        </RippleButton>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
