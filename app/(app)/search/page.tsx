import { Suspense } from 'react';

import { SearchScreen } from '@/components/search/SearchScreen';

export const metadata = {
  title: 'Search — Velvet',
  description: 'Search films, series, games and people on Velvet.',
};

/** Suspense wraps the screen because it reads `?q=` and `?mode=`. */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchScreen />
    </Suspense>
  );
}
