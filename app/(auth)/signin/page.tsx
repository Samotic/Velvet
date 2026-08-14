'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { AuthDivider, GoogleButton } from '@/components/auth/GoogleButton';
import { PosterWall } from '@/components/auth/PosterWall';
import { RippleButton } from '@/components/ui/Ripple';
import { Loading } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { GOOGLE_ERRORS } from '@/lib/auth';

/**
 * Sign in — the app's front door.
 *
 * 55/45 split: an ambient darkened poster wall on the left, the form on the
 * right. Below 900px the left panel is dropped entirely rather than stacked —
 * on a phone it would be decoration pushing the form below the fold.
 *
 * There is no nav here, and that is structural rather than conditional: this
 * route lives in the `(auth)` group, whose layout renders no chrome at all.
 */
function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, isAuthenticated, isLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /** Where the middleware wanted to send them before the gate intervened. */
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  // A failed Google round trip comes back as ?error= — surface it in the same
  // slot a failed password would use, so there is one error area on screen.
  useEffect(() => {
    const code = params.get('error');
    if (code) setError(GOOGLE_ERRORS[code] ?? 'Sign-in did not complete. Please try again.');
  }, [params]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(safeNext ?? '/');
  }, [isLoading, isAuthenticated, router, safeNext]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const user = await login({ email: email.trim(), password });
      // Onboarding wins over `next`: a half-set-up account has no taste profile,
      // and the middleware would bounce them straight back into the flow anyway.
      router.replace(user.onboardingCompleted ? (safeNext ?? '/') : '/onboarding/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-split">
      <aside className="auth-aside" aria-hidden="true">
        <PosterWall />
        <div className="auth-aside-body">
          <div className="auth-aside-brand">
            VEL<span>VET</span>
          </div>
          <p className="auth-aside-tagline">
            Rate what <em>you watch.</em>
          </p>
        </div>
      </aside>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          {/* The wordmark only appears here when the left panel is hidden, so the
              brand is never absent and never doubled. */}
          <div className="auth-brand auth-brand-compact">
            VEL<span>VET</span>
          </div>

          <h1 className="auth-heading">Welcome back</h1>
          <p className="auth-sub">Sign in to pick up where you left off.</p>

          {error && <div className="form-error">{error}</div>}

          <GoogleButton next={safeNext ?? undefined} />
          <AuthDivider />

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="password">
                  Password
                </label>
                <Link className="field-label-link" href="/forgot-password">
                  Forgot?
                </Link>
              </div>
              <div className="input-wrap has-action">
                <input
                  id="password"
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
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
            </div>

            <RippleButton className="btn-fill btn-lg btn-block" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner" /> : 'Sign in'}
            </RippleButton>
          </form>

          <p className="auth-alt">
            New here?{' '}
            <Link href={safeNext ? `/signup?next=${encodeURIComponent(safeNext)}` : '/signup'}>
              Join
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <SignIn />
    </Suspense>
  );
}
