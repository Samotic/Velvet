import type { ComponentType } from 'react';

import { Home, MessageIcon, Profile, Search, Sparkle } from './icons';

export type NavItem = {
  href: string;
  label: string;
  /** Present only where the design shows one. */
  Icon?: ComponentType<{ className?: string }>;
  /** A small chip trailing the label, e.g. AI Advisor's "New". */
  badge?: string;
};

/**
 * The desktop top nav, in the spec's order and wording.
 *
 * Movies / Series / Games have no routes of their own — they set the home
 * screen's filter, which is the same state the tab row below the hero drives,
 * so the nav and the tabs can never disagree.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/search', label: 'Search', Icon: Search },
  { href: '/?filter=movies', label: 'Movies' },
  { href: '/?filter=series', label: 'Series' },
  { href: '/?filter=games', label: 'Games' },
  { href: '/ai', label: 'AI Advisor', Icon: Sparkle, badge: 'New' },
  { href: '/messages', label: 'Messages', Icon: MessageIcon },
];

/** The mobile bar. Fewer, wider targets, and it carries Profile — which the
 *  desktop nav reaches through the avatar menu instead. */
export const MOBILE_NAV: NavItem[] = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/search', label: 'Search', Icon: Search },
  { href: '/ai', label: 'AI', Icon: Sparkle },
  { href: '/messages', label: 'Chats', Icon: MessageIcon },
  { href: '/profile', label: 'You', Icon: Profile },
];

/**
 * '/' must match exactly; everything else matches by prefix so nested routes
 * (e.g. /movie/123) don't light up Home.
 *
 * Query-only entries (`/?filter=movies`) compare against the live filter so the
 * nav and the tab row agree on what's selected.
 */
export function isActive(href: string, pathname: string, filter?: string | null): boolean {
  const [path, query] = href.split('?');
  const want = query ? new URLSearchParams(query).get('filter') : null;

  if (path === '/') {
    if (pathname !== '/') return false;
    // "Home" is active only when no filter is applied; the filter links own it
    // otherwise.
    return want ? want === filter : !filter || filter === 'all';
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}
