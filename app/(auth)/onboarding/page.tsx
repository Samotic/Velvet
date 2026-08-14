'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Loading } from '@/components/ui/States';

/**
 * `/onboarding` — the resolver, not a step.
 *
 * Splitting the flow into three routes left the bare path with no page, so
 * everything that linked to `/onboarding` 404'd: the Google callback for a new
 * account, the half-set-up redirect in AuthProvider, the home screen's "Get
 * started" and the nav button.
 *
 * Rather than teach four call sites which step is next — and re-teach them every
 * time the flow changes — they all point here and this decides. That also gives
 * the "closed the tab, came back" case its proper answer: you resume where you
 * stopped instead of restarting.
 */
const STEP_ROUTES = [
  '/onboarding/profile', // step 0 done → nothing yet, start at the top
  '/onboarding/avatar', // step 1 done → photo next
  '/onboarding/taste', // step 2 done → taste next
] as const;

export default function OnboardingIndexPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    // No session: the middleware gate normally prevents this, but a client-side
    // navigation can land here first. Send them to sign in.
    if (!user) {
      router.replace('/signin');
      return;
    }

    const step = user.onboardingStep || (user.onboardingCompleted ? STEP_ROUTES.length : 0);
    router.replace(step >= STEP_ROUTES.length ? '/' : STEP_ROUTES[step]);
  }, [isLoading, user, router]);

  return <Loading label="Opening setup" />;
}
