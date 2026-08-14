'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { StepPhoto } from '@/components/onboarding/StepPhoto';
import { saveOnboardingStep } from '@/lib/auth';

/**
 * Step 2 — profile picture. Skippable.
 *
 * `StepPhoto` already owns the upload, the circular preview and the client-side
 * size guard, so this route is the navigation around it. Both paths out record
 * step 2: skipping is a decision, and a returning user should resume at taste
 * rather than being asked for a photo they have already declined.
 *
 * Recording progress never blocks the move — if that call fails the user still
 * advances, and the worst outcome is being offered this step again.
 */
export default function OnboardingAvatarPage() {
  const router = useRouter();

  const advance = useCallback(async () => {
    try {
      await saveOnboardingStep(2);
    } catch {
      /* progress is a convenience, not a gate */
    }
    router.push('/onboarding/taste');
  }, [router]);

  return (
    <div>
      <StepPhoto onDone={() => void advance()} />
    </div>
  );
}
