'use client';

import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { ApiError } from '@/lib/api';
import { followUser, unfollowUser } from '@/lib/users';

type Relationship = 'none' | 'pending' | 'accepted';

/** Shared by profiles and people search so both use the same approval flow. */
export function FollowButton({
  userId,
  username,
  isFollowing,
  requested,
  compact = false,
  onChange,
}: {
  userId: string;
  username: string;
  isFollowing: boolean;
  requested: boolean;
  /** Sized for a list row rather than a profile header. */
  compact?: boolean;
  onChange?: (status: Relationship) => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<Relationship>(isFollowing ? 'accepted' : requested ? 'pending' : 'none');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setStatus(isFollowing ? 'accepted' : requested ? 'pending' : 'none');
  }, [isFollowing, requested]);

  async function update() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const previous = status;
    // Sending never briefly grants access or increments a follower count.
    if (previous === 'none') setStatus('pending');
    try {
      const next = previous === 'none' ? await followUser(userId) : (await unfollowUser(userId), 'none');
      setStatus(next);
      onChange?.(next);
      setConfirming(false);
    } catch (err) {
      setStatus(previous);
      toast.bad(err instanceof ApiError ? err.message : 'Could not update follow');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <RippleButton
        type="button"
        className={`follow-button follow-button-${status}${compact ? ' follow-button-sm' : ''}`}
        disabled={busy}
        aria-busy={busy}
        aria-label={status === 'accepted' ? `Following @${username}` : status === 'pending' ? `Cancel follow request to @${username}` : `Follow @${username}`}
        onClick={() => status === 'accepted' ? setConfirming(true) : void update()}
      >
        {status === 'accepted' ? 'Following ✓' : status === 'pending' ? 'Requested' : 'Follow'}
      </RippleButton>
      {confirming && (
        <UnfollowDialog
          username={username}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void update()}
        />
      )}
    </>
  );
}

function UnfollowDialog({ username, busy, onClose, onConfirm }: {
  username: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="follow-confirm"
      aria-labelledby="unfollow-title"
      aria-describedby="unfollow-description"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div className="follow-confirm-body">
        <h2 id="unfollow-title">Unfollow?</h2>
        <p id="unfollow-description">You’ll need approval to follow @{username} again.</p>
        <div className="follow-confirm-actions">
          <button type="button" className="btn-outline" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
          <RippleButton type="button" className="follow-button follow-button-none" disabled={busy} onClick={onConfirm}>
            {busy ? 'Unfollowing…' : 'Unfollow'}
          </RippleButton>
        </div>
      </div>
    </dialog>
  );
}
