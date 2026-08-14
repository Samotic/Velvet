'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { AuthDivider, GoogleButton } from '@/components/auth/GoogleButton';
import { PosterWall } from '@/components/auth/PosterWall';
import { RippleButton } from '@/components/ui/Ripple';
import { Loading } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { emailValid, passwordStrength, passwordValid } from '@/lib/authValidation';

/**
 * Create an account.
 *
 * Email and password only. The handle and display name are step 1 of onboarding
 * — asking for four fields before anyone has seen the product is how sign-up
 * forms get abandoned, and the handle in particular deserves its own screen with
 * the live availability check.
 *
 * The account therefore exists with a derived placeholder handle for about
 * thirty seconds. `onboardingCompleted` stays false in that window, so the
 * middleware gate keeps them in the flow until they have named themselves.
 */
function SignUp() {
  const router = useRouter();
  const params = useSearchParams();
  const { register, isAuthenticated, isLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  const strength = useMemo(() => passwordStrength(password), [password]);
  const emailOk = emailValid(email.trim());
  const pwOk = passwordValid(password);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace('/onboarding/profile');
  }, [isLoading, isAuthenticated, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setTouched(true);

    if (!emailOk) return setError('Enter a valid email address.');
    if (!pwOk) return setError('Password must be at least 8 characters.');

    setSubmitting(true);
    try {
      await register({ email: email.trim(), password });
      // Always into the flow — a brand new account has nothing but credentials.
      router.replace('/onboarding/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account.');
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
            Films, series, <em>games.</em>
          </p>
        </div>
      </aside>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-brand auth-brand-compact">
            VEL<span>VET</span>
          </div>

          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-sub">One profile for everything you watch and play.</p>

          {error && <div className="form-error">{error}</div>}

          <GoogleButton label="Sign up with Google" next={safeNext ?? undefined} />
          <AuthDivider label="or with email" />

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="su-email">
                Email
              </label>
              <input
                id="su-email"
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={submitting}
              />
              <div className={`field-hint ${touched && !emailOk ? 'error' : 'muted'}`}>
                {touched && !emailOk ? 'Enter a valid email address' : ''}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="su-password">
                Password
              </label>
              <div className="input-wrap has-action">
                <input
                  id="su-password"
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
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

            <RippleButton className="btn-fill btn-lg btn-block" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner" /> : 'Create account'}
            </RippleButton>
          </form>

          <p className="auth-alt">
            Already have an account? <Link href="/signin">Sign in</Link>
          </p>
        </div>
      </section>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <SignUp />
    </Suspense>
  );
}
