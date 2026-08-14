'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Loading } from '@/components/ui/States';
import { setToken } from '@/lib/api';

/**
 * Where `/api/auth/google/callback` lands the browser after a successful sign-in.
 *
 * The API cannot write this app's session for it — the token lives in
 * localStorage, which only JavaScript on this origin can touch — so it hands the
 * JWT over in the query string and this page stores it and gets out of the way.
 *
 * The token is therefore briefly in the URL. `router.replace` (not `push`)
 * keeps it out of the back stack, and the page is transient by design. The
 * alternative — an httpOnly cookie set by the API — would mean a cross-site
 * cookie between :4000 and :3000 and a second session mechanism alongside the
 * bearer token every other call already uses.
 */
function GoogleCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const { checkAuth } = useAuth();

  // Effects can run twice in dev StrictMode; the redirect must only be armed once.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = params.get('token');
    if (!token) {
      router.replace('/signin?error=google_failed');
      return;
    }

    setToken(token);

    const next = params.get('next');
    const needsOnboarding = params.get('onboarding') === '1';
    // Only in-app paths, so a crafted `next` can't bounce someone off-site.
    const destination = needsOnboarding ? '/onboarding' : next?.startsWith('/') ? next : '/';

    // Load the user before routing, so the destination renders signed in rather
    // than flashing its logged-out state for a beat.
    void checkAuth().finally(() => router.replace(destination));
  }, [params, router, checkAuth]);

  return <Loading label="Signing you in" />;
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={<Loading label="Signing you in" />}>
      <GoogleCallback />
    </Suspense>
  );
}
