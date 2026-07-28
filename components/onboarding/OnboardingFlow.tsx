'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { ArrowLeft } from '@/components/icons';
import { ApiError } from '@/lib/api';
import type { Gender, Mood } from '@/lib/authTypes';
import { MIN_GENRES, TOTAL_STEPS } from '@/lib/onboarding';

import { StepAccount } from './StepAccount';
import { StepAbout } from './StepAbout';
import { StepPhoto } from './StepPhoto';
import { StepReady } from './StepReady';
import { StepTaste } from './StepTaste';
import { StepWelcome } from './StepWelcome';

/**
 * The six-step first-run flow.
 *
 * State lives here and the steps are presentational, so Back never loses what
 * was already typed — the account step in particular would be miserable to
 * re-enter.
 *
 * Two server writes, not six: the account is created at the end of step 2
 * (we need an authenticated session before anything can be saved against a
 * user), and the taste profile is committed at the end of step 4. Steps 5 and
 * 6 are the photo upload and the celebration, which each own their own call.
 */
export function OnboardingFlow() {
  const router = useRouter();
  const toast = useToast();
  const { user, isLoading, register, completeOnboarding } = useAuth();

  const [step, setStep] = useState(1);
  /** Direction of travel, so the slide animates the way the user moved. */
  const [dir, setDir] = useState<1 | -1>(1);
  const [submitting, setSubmitting] = useState(false);

  // step 3
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  // step 4
  const [genres, setGenres] = useState<string[]>([]);
  const [mood, setMood] = useState<Mood | null>(null);

  /**
   * Someone who is already signed in shouldn't see the welcome or account
   * steps. Land them on the first step that still has something to collect.
   */
  useEffect(() => {
    if (isLoading || !user) return;
    if (user.onboardingCompleted) {
      router.replace('/');
      return;
    }
    setStep((s) => (s < 3 ? 3 : s));
  }, [isLoading, user, router]);

  const go = useCallback((next: number, direction: 1 | -1) => {
    setDir(direction);
    setStep(next);
  }, []);

  const next = useCallback(() => go(Math.min(step + 1, TOTAL_STEPS), 1), [go, step]);
  const back = useCallback(() => go(Math.max(step - 1, 1), -1), [go, step]);

  /** Creates the account, then advances. Errors stay on the step. */
  async function submitAccount(input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) {
    setSubmitting(true);
    try {
      await register(input);
      next();
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not create your account');
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  /** Commits steps 3 and 4 together, then advances to the photo step. */
  async function submitTaste() {
    if (!gender || !mood || genres.length < MIN_GENRES) return;
    setSubmitting(true);
    try {
      await completeOnboarding({
        age: Number(age),
        gender,
        favouriteGenres: genres,
        favouriteMood: mood,
      });
      next();
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not save your taste profile');
    } finally {
      setSubmitting(false);
    }
  }

  const progress = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  return (
    <div className="onb">
      <div className="onb-progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="onb-bar">
        {/* Back is offered on steps 2-6, per the design. */}
        {step > 1 ? (
          <button type="button" className="onb-back" onClick={back} disabled={submitting}>
            <ArrowLeft />
            Back
          </button>
        ) : (
          <span />
        )}
        <span className="onb-step-label">
          Step {step} of {TOTAL_STEPS}
        </span>
      </div>

      <div className="onb-viewport">
        {/* `--from` drives the translateX direction of the entrance. */}
        <div
          key={step}
          className={`onb-step${step === 4 ? ' wide' : ''}`}
          style={{ ['--from' as string]: dir === 1 ? '46px' : '-46px' }}
        >
          {step === 1 && <StepWelcome onStart={next} />}

          {step === 2 && <StepAccount busy={submitting} onSubmit={submitAccount} />}

          {step === 3 && (
            <StepAbout
              age={age}
              gender={gender}
              onAge={setAge}
              onGender={setGender}
              onContinue={next}
            />
          )}

          {step === 4 && (
            <StepTaste
              genres={genres}
              mood={mood}
              busy={submitting}
              onGenres={setGenres}
              onMood={setMood}
              onContinue={() => void submitTaste()}
            />
          )}

          {step === 5 && <StepPhoto onDone={next} />}

          {step === 6 && <StepReady displayName={user?.displayName ?? 'friend'} />}
        </div>
      </div>
    </div>
  );
}
