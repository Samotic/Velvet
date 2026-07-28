'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from './AuthProvider';

/**
 * Gates its children behind authentication. While the session is being
 * restored it shows a Velvet-styled loading state; once resolved, unauthenticated
 * visitors are redirected to /login.
 *
 * Wrap any protected page's content in this:
 *   export default function Page() { return <ProtectedRoute><Body/></ProtectedRoute>; }
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-brand">
          VEL<span>VET</span>
        </div>
        <div className="auth-gate-spinner" aria-label="Loading" />
      </div>
    );
  }

  // Redirecting — render nothing rather than a flash of protected content.
  if (!isAuthenticated) return null;

  return <>{children}</>;
}
