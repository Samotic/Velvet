'use client';

import Link from 'next/link';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { FollowRequestsList } from '@/components/notifications/FollowRequests';

/**
 * The follow request queue, on its own screen.
 *
 * Nested under /notifications rather than sitting at the root, because that is
 * where it is reached from and the URL should say so. The back link is explicit
 * rather than relying on browser history: the screen is also linked from your
 * own profile, and "back" from there would leave the app.
 */
export default function FollowRequestsPage() {
  return (
    <ProtectedRoute>
      <div className="screen-narrow" style={{ paddingBottom: 60 }}>
        <div className="screen-head">
          <Link href="/notifications" className="back-link">
            <span aria-hidden="true">‹</span> Notifications
          </Link>
          <h1 className="screen-title">Follow Requests</h1>
        </div>

        <div style={{ marginTop: 20 }}>
          <FollowRequestsList />
        </div>
      </div>
    </ProtectedRoute>
  );
}
