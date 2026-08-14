'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { api, ApiError, setToken } from '@/lib/api';
import { saveOnboardingProfile } from '@/lib/auth';
import { usernameValid } from '@/lib/authValidation';

/**
 * Step 1 — name and handle. The only required step.
 *
 * Succeeding here flips `onboardingCompleted`, which is what opens the
 * middleware gate. Until then the account exists but cannot reach the app, so
 * nobody browses Velvet under the placeholder handle signup derived for them.
 *
 * The handle is checked against the server as it is typed, debounced at 400ms,
 * with a stale-response guard: someone typing quickly has several checks in
 * flight, and without the guard an earlier "taken" can land after a later "free"
 * and mislabel a perfectly good handle.
 */
type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid' | 'unknown';

export default function OnboardingProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const { user, isLoading, setUser } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [serverReason, setServerReason] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  /**
   * Seed from the account only when it has been named already — a returning user
   * editing step 1 should see their real handle. The placeholder signup derived
   * is deliberately *not* seeded: presenting a machine-generated handle as a
   * suggestion invites people to keep it.
   */
  useEffect(() => {
    if (isLoading || !user) return;
    if (user.onboardingStep >= 1) {
      setDisplayName((v) => v || user.displayName);
      setUsername((v) => v || user.username);
    }
  }, [isLoading, user]);

  /* --- live handle availability ---------------------------------------- */

  useEffect(() => {
    const handle = username.trim();

    if (!handle) return setAvailability('idle');
    if (!usernameValid(handle)) return setAvailability('invalid');
    // Their own current handle is not "taken" by someone else.
    if (user && handle.toLowerCase() === user.username.toLowerCase() && user.onboardingStep >= 1) {
      return setAvailability('free');
    }

    setAvailability('checking');
    let cancelled = false;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const { available, reason } = await api.get<{ available: boolean; reason: string | null }>(
          `/api/auth/check-username?username=${encodeURIComponent(handle)}`,
          { auth: false, signal: controller.signal },
        );
        if (cancelled) return;
        setAvailability(available ? 'free' : 'taken');
        setServerReason(reason);
      } catch {
        // Offline or aborted — don't block on a check we can't complete. The
        // server re-validates on submit, so the worst case is an error there.
        if (!cancelled) setAvailability('unknown');
      }
    }, 400);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [username, user]);

  const nameOk = displayName.trim().length > 0;
  const handleOk =
    availability === 'free' || (availability === 'unknown' && usernameValid(username.trim()));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameOk || !handleOk) {
      setTouched({ displayName: true, username: true });
      return;
    }

    setBusy(true);
    try {
      const { token, user: updated } = await saveOnboardingProfile({
        displayName: displayName.trim(),
        username: username.trim(),
      });
      // The handle is a JWT claim, so the server reissues one — store it before
      // anything else fires a request with the old token.
      setToken(token);
      setUser(updated);
      router.push('/onboarding/avatar');
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not save your profile');
      setBusy(false);
    }
  }

  const handleHint =
    availability === 'invalid'
      ? { cls: 'error', text: '3–20 characters: letters, numbers or underscores' }
      : availability === 'taken'
        ? { cls: 'error', text: serverReason ?? 'That handle is taken' }
        : availability === 'free'
          ? { cls: 'ok', text: 'Available' }
          : availability === 'checking'
            ? { cls: 'muted', text: 'Checking…' }
            : availability === 'unknown'
              ? { cls: 'muted', text: "Couldn't check that handle — we'll confirm it when you continue" }
              : touched.username
                ? { cls: 'error', text: 'Choose a handle' }
                : { cls: 'muted', text: 'This is how people find you' };

  return (
    <div>
      <h1 className="onb-title">
        What should we <em>call you?</em>
      </h1>
      <p className="onb-sub">Your name and handle. Both can be changed later.</p>

      <form className="onb-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="onb-name">
            Display name
          </label>
          <input
            id="onb-name"
            className="input"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, displayName: true }))}
            placeholder="Your name"
            maxLength={60}
            autoFocus
          />
          <div className={`field-hint ${touched.displayName && !nameOk ? 'error' : 'muted'}`}>
            {touched.displayName && !nameOk ? 'Display name is required' : ''}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="onb-username">
            Username
          </label>
          <div className="input-wrap has-prefix">
            <span className="input-prefix">@</span>
            <input
              id="onb-username"
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
              onBlur={() => setTouched((t) => ({ ...t, username: true }))}
              placeholder="handle"
              maxLength={20}
            />
            {availability === 'free' && <span className="field-status ok">✓</span>}
            {(availability === 'taken' || availability === 'invalid') && (
              <span className="field-status bad">✕</span>
            )}
          </div>
          <div className={`field-hint ${handleHint.cls}`}>{handleHint.text}</div>
        </div>

        <RippleButton type="submit" className="btn-fill btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Continue'}
        </RippleButton>
      </form>
    </div>
  );
}
