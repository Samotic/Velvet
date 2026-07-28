'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

import { BottomNav } from './BottomNav';
import { TopNav } from './TopNav';

/** Auth and onboarding render edge-to-edge with no chrome. */
const BARE_ROUTES = ['/login', '/register', '/onboarding'];

/**
 * Routes that manage their own scrolling and want the full viewport width:
 * the AI advisor and the message threads are two-pane apps, not documents in
 * the 1320px reading column.
 */
const FLUSH_ROUTES = ['/ai', '/messages'];

const matches = (routes: string[], pathname: string) =>
  routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));

/**
 * The application shell.
 *
 * - Normal routes: fixed TopNav, content centred in the column, BottomNav on
 *   phones.
 * - Flush routes: TopNav plus a full-width main the page fills itself.
 * - Bare routes: no chrome at all.
 *
 * A client component only because it needs the current pathname; the
 * server-rendered page tree passes straight through as children.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (matches(BARE_ROUTES, pathname)) {
    return <main className="app-main bare">{children}</main>;
  }

  const flush = matches(FLUSH_ROUTES, pathname);

  return (
    <>
      {/* TopNav reads the `filter` query param, so it needs a Suspense boundary. */}
      <Suspense fallback={<div className="topnav" />}>
        <TopNav />
      </Suspense>
      <main className={`app-main${flush ? ' flush' : ''}`}>
        <div className="app-content">{children}</div>
      </main>
      <BottomNav />
    </>
  );
}
