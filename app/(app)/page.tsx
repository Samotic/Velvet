import { Suspense } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { HomeScreen } from '@/components/home/HomeScreen';

/**
 * Home — the discovery feed, and the app's front door.
 *
 * A thin server shell around a client screen. Almost everything on this page is
 * personalised (stats, AI picks, friends' activity, per-card save state) and the
 * session token lives in localStorage, so the data fetching belongs on the
 * client. The Suspense boundary is for `useSearchParams`, which the filter tabs
 * read.
 *
 * `ProtectedRoute` makes this the gate for the whole app: an anonymous visitor
 * hitting `/` is sent to /login rather than shown a feed they cannot personalise
 * — every rail here is about *their* taste, and there is no useful signed-out
 * version of it. Once signed in the token persists, so every later visit lands
 * straight on this screen.
 */
export default function HomePage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <HomeScreen />
      </Suspense>
    </ProtectedRoute>
  );
}
