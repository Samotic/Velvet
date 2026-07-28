'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { RippleButton } from '@/components/ui/Ripple';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Don't show the login form — go to the app.
  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace('/');
  }, [isLoading, isAuthenticated, router]);

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
      // An account that never finished setup resumes the flow rather than
      // landing on a home screen with no taste profile behind it.
      router.replace(user.onboardingCompleted ? '/' : '/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          VEL<span>VET</span>
        </div>
        <h1 className="auth-heading">Welcome back</h1>
        <p className="auth-sub">Sign in to pick up where you left off.</p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error && <div className="form-error">{error}</div>}

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
            <label className="field-label" htmlFor="password">
              Password
            </label>
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
          Don&rsquo;t have an account? <Link href="/onboarding">Create one</Link>
        </p>
      </div>
    </div>
  );
}
