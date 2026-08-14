'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { RippleButton } from '@/components/ui/Ripple';
import { ApiError } from '@/lib/api';
import { forgotPassword } from '@/lib/auth';
import { emailValid } from '@/lib/authValidation';

/**
 * "I've forgotten my password".
 *
 * The success state never confirms whether the address has an account — the API
 * refuses to say, so that this page can't be used to enumerate who is
 * registered. The copy is written to be true either way.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const address = email.trim();
    if (!emailValid(address)) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      await forgotPassword(address);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            VEL<span>VET</span>
          </div>
          <div className="verify-mark sent" aria-hidden="true">
            ✉
          </div>
          <h1 className="auth-heading">Check your email</h1>
          <p className="auth-sub">
            If an account exists for{' '}
            <strong style={{ color: 'var(--accent-light)', fontWeight: 400 }}>
              {email.trim()}
            </strong>
            , a reset link is on its way. It expires in an hour.
          </p>
          <Link href="/signin" className="btn-fill btn-lg btn-block">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          VEL<span>VET</span>
        </div>
        <h1 className="auth-heading">Reset your password</h1>
        <p className="auth-sub">Tell us your address and we&rsquo;ll send a link.</p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="field-label" htmlFor="fp-email">
              Email
            </label>
            <input
              id="fp-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>

          <RippleButton className="btn-fill btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Send reset link'}
          </RippleButton>
        </form>

        <p className="auth-alt">
          Remembered it? <Link href="/signin">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
