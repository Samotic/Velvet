import { Suspense } from 'react';

import { HomeScreen } from '@/components/home/HomeScreen';

/**
 * Home — the discovery feed.
 *
 * A thin server shell around a client screen. The catalogue itself is public,
 * but almost everything on this page is personalised (stats, AI picks, friends'
 * activity, per-card save state) and the session token lives in localStorage,
 * so the data fetching belongs on the client. The Suspense boundary is for
 * `useSearchParams`, which the filter tabs read.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeScreen />
    </Suspense>
  );
}
