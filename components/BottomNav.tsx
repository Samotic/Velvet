'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from './auth/AuthProvider';
import { isActive, MOBILE_NAV } from './navItems';

/** Full-bleed screens where a floating bar would break the illusion. */
const HIDDEN_ON = ['/signin', '/signup', '/onboarding'];

/**
 * Mobile navigation. Fixed to the bottom below the `md` breakpoint; hidden by
 * CSS above it, where the TopNav takes over.
 *
 * The Profile entry resolves to the signed-in user's own handle so the link is
 * the same public profile everyone else sees, rather than a private variant.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <nav className="nav">
      {MOBILE_NAV.map(({ href, label, Icon }) => {
        const target = href === '/profile' && user ? `/profile/${user.username}` : href;
        return (
          <Link
            key={href}
            href={target}
            className={`nav-item${isActive(href, pathname) ? ' active' : ''}`}
          >
            {Icon && <Icon />}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
