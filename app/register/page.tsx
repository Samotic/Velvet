'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Loading } from '@/components/ui/States';

/**
 * `/register` is folded into the onboarding flow.
 *
 * Account creation is step 2 of six, and a standalone register form would drop
 * the user into the app without a taste profile — the one thing the advisor
 * needs. The route is kept so existing links and bookmarks still land somewhere
 * sensible.
 */
export default function RegisterRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/onboarding');
  }, [router]);

  return <Loading label="Opening sign-up" />;
}
