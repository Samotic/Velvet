'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { StepTaste } from '@/components/onboarding/StepTaste';
import { useToast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { saveOnboardingStep } from '@/lib/auth';
import type { Mood } from '@/lib/authTypes';
import { MIN_GENRES } from '@/lib/onboarding';

/**
 * Step 3 — genres and mood. Skippable, and the last one.
 *
 * Saved through `updateProfile` (PUT /api/users/me) rather than the older
 * `complete-onboarding` endpoint, because that one also demands age and gender —
 * fields this three-step flow never asks for. Sending it a partial payload would
 * just 422.
 *
 * Finishing marks step 3, which is what tells the middleware gate this account
 * is done and should be redirected out of the flow from now on.
 */
export default function OnboardingTastePage() {
  const router = useRouter();
  const toast = useToast();
  const { user, isLoading, updateProfile } = useAuth();

  const [genres, setGenres] = useState<string[]>([]);
  const [mood, setMood] = useState<Mood | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed from whatever is already saved, so a returning user sees their picks.
  useEffect(() => {
    if (isLoading || !user) return;
    setGenres((g) => (g.length ? g : (user.favouriteGenres ?? [])));
    setMood((m) => m ?? user.favouriteMood ?? null);
  }, [isLoading, user]);

  async function finish() {
    if (genres.length < MIN_GENRES || !mood) return;
    setBusy(true);
    try {
      await updateProfile({ favouriteGenres: genres, favouriteMood: mood });
      await saveOnboardingStep(3);
      router.replace('/');
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not save your taste profile');
      setBusy(false);
    }
  }

  /** Skipping still completes the flow — an empty taste profile is a valid one. */
  async function skip() {
    setBusy(true);
    try {
      await saveOnboardingStep(3);
    } catch {
      /* the gate re-offers this step at worst */
    }
    router.replace('/');
  }

  return (
    <div>
      <StepTaste
        genres={genres}
        mood={mood}
        busy={busy}
        onGenres={setGenres}
        onMood={setMood}
        onContinue={() => void finish()}
      />

      <p className="onb-alt" style={{ marginTop: 18, textAlign: 'center' }}>
        <Link
          href="/"
          onClick={(e) => {
            e.preventDefault();
            void skip();
          }}
        >
          Skip for now
        </Link>
      </p>
    </div>
  );
}
