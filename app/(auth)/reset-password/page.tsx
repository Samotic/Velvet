'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { Loading } from '@/components/ui/States';
import { ApiError, setToken } from '@/lib/api';
import { resetPassword } from '@/lib/auth';
import { passwordStrength, passwordValid } from '@/lib/authValidation';

/**
 * Where the reset email lands.
 *
 * A successful reset returns a session, so this signs the user straight in
 * rather than handing them back to the login form to retype the password they
 * chose four seconds ago.
 */
function ResetPassword() {
  const router = useRouter();
  const toast = useToast();
  const { checkAuth } = useAuth();
  const token = useSearchParams().get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  if (!token) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            VEL<span>VET</span>
          </div>
          <div className="verify-mark expired" aria-hidden="true">
            !
          </div>
          <h1 className="auth-heading">Link incomplete</h1>
          <p className="auth-sub">
            That reset link is missing its token. Ask for a fresh one and try again.
          </p>
          <Link href="/forgot-password" className="btn-fill btn-lg btn-block">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!passwordValid(password)) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.');
      return;
    }

    setBusy(true);
    try {
      const { token: session } = await resetPassword(token!, password);
      setToken(session);
      await checkAuth();
      toast.ok('Password changed — you’re signed in.');
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          VEL<span>VET</span>
        </div>
        <h1 className="auth-heading">Choose a new password</h1>
        <p className="auth-sub">Make it one you haven&rsquo;t used elsewhere.</p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="field-label" htmlFor="rp-password">
              New password
            </label>
            <div className="input-wrap has-action">
              <input
                id="rp-password"
                className="input"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
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
            <label className="field-label" htmlFor="rp-confirm">
              Confirm password
            </label>
            <input
              id="rp-confirm"
              className="input"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
            <div className={`field-hint ${confirm && confirm !== password ? 'error' : 'muted'}`}>
              {confirm && confirm !== password ? 'Those don’t match' : ''}
            </div>
          </div>

          <RippleButton className="btn-fill btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Set new password'}
          </RippleButton>
        </form>

        <p className="auth-alt">
          <Link href="/signin">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <ResetPassword />
    </Suspense>
  );
}
