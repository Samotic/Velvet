import { Suspense } from 'react';

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

export const metadata = {
  title: 'Welcome to Velvet',
  description: 'Set up your Velvet taste profile.',
};

/**
 * First-run setup. Shown once: `onboardingCompleted` on the user record gates
 * it, and the AuthProvider redirects a half-set-up account back here, so the
 * flow survives a refresh mid-way without a partial profile reaching the app.
 */
export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="onb" />}>
      <OnboardingFlow />
    </Suspense>
  );
}
