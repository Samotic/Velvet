'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';

/**
 * The strip that sits under the nav until an address is confirmed.
 *
 * Deliberately a banner and not a wall: an unverified account can browse, rate
 * and finish onboarding. Only the advisor and messaging are held back, and each
 * says so in its own place — see `<VerifyGate>`.
 *
 * Hidden on the routes that are already about verifying, so the page doesn't
 * nag about the thing it is currently doing.
 */
const SILENT_ROUTES = ['/verify-email', '/signin', '/signup', '/onboarding', '/auth'];

export function VerifyBanner() {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  if (isLoading || !user || user.emailVerified) return null;
  if (SILENT_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return null;

  return (
    <div className="verify-banner" role="status">
      <span className="verify-banner-dot" aria-hidden="true" />
      <span className="verify-banner-text">
        Please verify your email to access all features.
      </span>
      <Link href="/verify-email" className="verify-banner-action">
        Verify now
      </Link>
    </div>
  );
}
