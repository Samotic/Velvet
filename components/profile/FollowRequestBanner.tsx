'use client';

import Link from 'next/link';

import { FollowRequestActions } from '@/components/notifications/FollowRequestActions';
import { Avatar } from '@/components/ui/Avatar';

/** Beyond this the list stops being scannable and becomes the queue's job. */
const MAX_VISIBLE = 3;

export interface PendingRequester {
  id: string;
  username: string;
  displayName: string;
  profilePhoto: string | null;
}

/**
 * Pending follow requests, shown below the profile hero.
 *
 * ── Why it is not part of the hero ──
 * It used to be a child of `.profile-head`, which is a flex **row** on desktop.
 * Carrying `width: 100%` there made it a full-bleed bar wedged through the
 * identity block, covering the name, handle and join date, with its buttons
 * landing beside Follow so the row held two competing action clusters. It is a
 * sibling of the hero and the tab row now, so its edges fall on the same grid
 * as the tabs beneath it and it can never obscure who you are looking at.
 *
 * ── Why a list ──
 * One bordered container with dividers rather than a banner per request. A
 * stack of separate cards reads as several unrelated alerts; a divided list
 * reads as one queue with several entries. Past `MAX_VISIBLE` it stops
 * enumerating and points at the screen built for that.
 */
export function FollowRequestBanner({
  requests,
  onResolved,
}: {
  requests: PendingRequester[];
  /** Called after the server confirms, so the page can re-read. */
  onResolved?: () => void;
}) {
  if (!requests.length) return null;

  const visible = requests.slice(0, MAX_VISIBLE);
  const hidden = requests.length - visible.length;

  return (
    <div className="profile-request">
      <ul className="profile-request-list">
        {visible.map((person) => (
          <li key={person.id} className="profile-request-row">
            <Avatar
              src={person.profilePhoto}
              name={person.displayName}
              size="sm"
              className="profile-request-avatar"
            />
            <p className="profile-request-text">
              <strong>{person.username}</strong> wants to follow you
            </p>
            <FollowRequestActions
              variant="inline"
              userId={person.id}
              onResolved={() => onResolved?.()}
            />
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <Link href="/notifications/requests" className="profile-request-more">
          View all {requests.length} requests
        </Link>
      )}
    </div>
  );
}
