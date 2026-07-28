'use client';

import { useEffect, useMemo, useState } from 'react';

import { RippleButton } from '@/components/ui/Ripple';
import { api } from '@/lib/api';
import { emailValid, passwordStrength, passwordValid, usernameValid } from '@/lib/authValidation';

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Step 2 — create the account.
 *
 * The handle is checked against the server as the user types, debounced at
 * 400ms. A stale-response guard matters here: someone typing quickly will have
 * several checks in flight, and without the guard an earlier "taken" can land
 * after a later "free" and mislabel a perfectly good handle.
 */
export function StepAccount({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  /** The message the API gave for an unavailable handle, if any. */
  const [serverReason, setServerReason] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const strength = useMemo(() => passwordStrength(password), [password]);

  /* --- live handle availability ---------------------------------------- */

  useEffect(() => {
    const handle = username.trim();

    if (!handle) {
      setAvailability('idle');
      return;
    }
    if (!usernameValid(handle)) {
      setAvailability('invalid');
      return;
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
        // Ignore a response whose request has been superseded.
        if (cancelled) return;
        setAvailability(available ? 'free' : 'taken');
        // The API is the single source of truth for the message, so the two
        // ends can't drift on wording.
        setServerReason(reason);
      } catch {
        // Offline or aborted — say nothing rather than blocking the user on a
        // check we can't complete. Registration re-validates server-side.
        if (!cancelled) setAvailability('idle');
      }
    }, 400);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [username]);

  const emailOk = emailValid(email);
  const pwOk = passwordValid(password);
  const nameOk = displayName.trim().length > 0;
  const canSubmit =
    emailOk && pwOk && nameOk && availability === 'free' && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setTouched({ email: true, password: true, username: true, displayName: true });
      return;
    }
    try {
      await onSubmit({
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      });
    } catch {
      /* the flow surfaced it as a toast; stay on this step */
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
            : { cls: 'muted', text: 'This is how people find you' };

  return (
    <div>
      <h1 className="onb-title">
        Create your <em>account</em>
      </h1>
      <p className="onb-sub">One profile for films, series and games.</p>

      <form className="onb-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="onb-email">
            Email
          </label>
          <input
            id="onb-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            placeholder="you@example.com"
          />
          <div className={`field-hint ${touched.email && !emailOk ? 'error' : 'muted'}`}>
            {touched.email && !emailOk ? 'Enter a valid email address' : ''}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="onb-password">
            Password
          </label>
          <div className="input-wrap has-action">
            <input
              id="onb-password"
              className="input"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          {password ? (
            <div className="pw-meter">
              <div className="pw-bars">
                {[1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`pw-bar${i <= strength.filled ? ` on ${strength.level}` : ''}`}
                  />
                ))}
              </div>
              <span className={`pw-label ${strength.level}`}>{strength.level}</span>
            </div>
          ) : (
            <div className="field-hint muted">Minimum 8 characters</div>
          )}
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
            placeholder="What should we call you?"
            maxLength={60}
          />
          <div className={`field-hint ${touched.displayName && !nameOk ? 'error' : 'muted'}`}>
            {touched.displayName && !nameOk ? 'Display name is required' : ''}
          </div>
        </div>

        <RippleButton type="submit" className="btn-fill btn-lg btn-block" disabled={!canSubmit}>
          {busy ? <span className="spinner" /> : 'Continue'}
        </RippleButton>
      </form>
    </div>
  );
}
