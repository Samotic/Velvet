'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

import { VerifyBanner } from './auth/VerifyBanner';
import { BottomNav } from './BottomNav';
import { TopNav } from './TopNav';

/**
 * Routes that manage their own scrolling and drop the page gutter entirely:
 * the AI advisor and the message threads are two-pane apps whose panels run
 * to the glass, not documents that want padding around them.
 */
const FLUSH_ROUTES = ['/ai', '/messages'];

const matches = (routes: string[], pathname: string) =>
  routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));

/**
 * The application shell, for the `(app)` route group only.
 *
 * It no longer decides whether to render chrome — the route groups do that. A
 * screen with no nav belongs in `(auth)`, whose layout renders nothing at all.
 * This used to carry a `BARE_ROUTES` list that had to be kept in step by hand;
 * moving the nav into `(app)/layout.tsx` made the list unnecessary, which is a
 * whole class of "why is the nav showing on sign-in" bug that can no longer
 * happen.
 *
 * A client component only because it needs the current pathname; the
 * server-rendered page tree passes straight through as children.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const flush = matches(FLUSH_ROUTES, pathname);

  return (
    <>
      {/* TopNav reads the `filter` query param, so it needs a Suspense boundary. */}
      <Suspense fallback={<div className="topnav" />}>
        <TopNav />
      </Suspense>
      <main className={`app-main${flush ? ' flush' : ''}`}>
        <VerifyBanner />
        <div className="app-content">{children}</div>
      </main>
      <BottomNav />
    </>
  );
}
