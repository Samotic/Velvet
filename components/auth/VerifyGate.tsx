'use client';

import Link from 'next/link';

import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/States';

/**
 * Stands in front of the two features that need a confirmed address: the
 * advisor and messaging.
 *
 * The check is client-side for the *experience* only — `requireVerified` on the
 * API is what actually enforces it. This exists so an unverified user meets a
 * sentence explaining the situation rather than a 403 rendered as a red error
 * card, and so the screen never fires a request it knows will be refused.
 *
 * Renders children untouched once verified, so wrapping a screen costs nothing
 * for the people who have already been through it.
 */
export function VerifyGate({
  feature,
  children,
}: {
  /** Named in the copy: "…to use the advisor". */
  feature: string;
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();

  // While loading, or signed out, defer to the screen's own handling — the
  // route guards already deal with anonymous visitors.
  if (isLoading || !user || user.emailVerified) return <>{children}</>;

  return (
    <div className="app-content">
      <EmptyState
        icon="✉"
        title="Verify your email"
        text={`Confirm your address to use ${feature}. We sent a link to ${user.email} when you signed up.`}
        action={{ label: 'Verify now', href: '/verify-email' }}
      />
      <p className="auth-alt" style={{ marginTop: 4 }}>
        Wrong address? <Link href="/settings">Check your account</Link>
      </p>
    </div>
  );
}
