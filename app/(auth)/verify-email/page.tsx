'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { Loading } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { resendVerification, verifyEmail } from '@/lib/auth';

/**
 * Two screens behind one route.
 *
 * With `?token=…` it is the destination of the emailed link: verify, then send
 * the user home. Without one it is the "check your inbox" holding page the user
 * lands on straight after signing up.
 *
 * One route rather than two because the states are the same conversation, and a
 * failed token needs to offer exactly what the holding page offers — another
 * email.
 */

type Phase = 'verifying' | 'ok' | 'failed';

function VerifyWithToken({ token }: { token: string }) {
  const router = useRouter();
  const toast = useToast();
  const { isAuthenticated, checkAuth } = useAuth();

  const [phase, setPhase] = useState<Phase>('verifying');
  const [error, setError] = useState('');

  // The token is one-time: a second call would fail, so guard StrictMode's
  // double-invoke or the user would see "already used" on a good link.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await verifyEmail(token);
        setPhase('ok');

        if (isAuthenticated) {
          // Refresh the session so the banner and the gates notice immediately.
          await checkAuth();
          toast.ok('Email verified — everything is unlocked.');
          router.replace('/');
        }
        // Signed out (the link was opened in another browser): stay put and
        // offer the sign-in link rather than bouncing to a login wall.
      } catch (err) {
        setPhase('failed');
        setError(
          err instanceof ApiError ? err.message : 'That link could not be checked. Try again.',
        );
      }
    })();
  }, [token, isAuthenticated, checkAuth, router, toast]);

  if (phase === 'verifying') return <Loading label="Verifying your email" />;

  if (phase === 'ok') {
    return (
      <Shell heading="You’re verified" accent="verified">
        <p className="auth-sub">Your address is confirmed and every feature is open.</p>
        <Link href={isAuthenticated ? '/' : '/signin'} className="btn-fill btn-lg btn-block">
          {isAuthenticated ? 'Start discovering' : 'Sign in'}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell heading="Link expired" accent="expired">
      <p className="auth-sub">{error}</p>
      <ResendPanel />
      <p className="auth-alt">
        <Link href="/">Back to Velvet</Link>
      </p>
    </Shell>
  );
}

function CheckYourInbox() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // Already verified? Nothing to wait for.
  useEffect(() => {
    if (!isLoading && user?.emailVerified) router.replace('/');
  }, [isLoading, user, router]);

  if (isLoading) return <Loading label="Loading" />;

  return (
    <Shell heading="Check your email" accent="sent">
      <p className="auth-sub">
        We sent a verification link to{' '}
        <strong style={{ color: 'var(--accent-light)', fontWeight: 400 }}>
          {user?.email ?? 'your address'}
        </strong>
        . Open it and your account is live.
      </p>
      <ResendPanel />
      <p className="auth-alt">
        You can keep browsing while you wait — <Link href="/">have a look around</Link>.
      </p>
    </Shell>
  );
}

/**
 * The resend control, shared by both states.
 *
 * Enforces its own 60-second cooldown on top of the server's hourly limit, so
 * an impatient double-tap doesn't burn one of the five sends the API allows.
 */
function ResendPanel() {
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = useCallback(async () => {
    setBusy(true);
    try {
      const { alreadyVerified } = await resendVerification();
      if (alreadyVerified) {
        toast.ok('That address is already verified.');
      } else {
        toast.ok('Sent — check your inbox.');
        setCooldown(60);
      }
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not send that email.');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  // Resending needs a session to know whose address to send to.
  if (!isAuthenticated) {
    return (
      <Link href="/signin" className="btn-fill btn-lg btn-block">
        Sign in to resend
      </Link>
    );
  }

  return (
    <>
      <RippleButton
        className="btn-fill btn-lg btn-block"
        onClick={() => void resend()}
        disabled={busy || cooldown > 0}
      >
        {busy ? (
          <span className="spinner" />
        ) : cooldown > 0 ? (
          `Resend in ${cooldown}s`
        ) : (
          'Resend email'
        )}
      </RippleButton>
      <p className="field-hint muted" style={{ textAlign: 'center', marginTop: 10 }}>
        Check your spam folder before resending.
      </p>
    </>
  );
}

/* --------------------------------- shell ---------------------------------- */

function Shell({
  heading,
  accent,
  children,
}: {
  heading: string;
  accent: 'sent' | 'verified' | 'expired';
  children: React.ReactNode;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          VEL<span>VET</span>
        </div>
        <div className={`verify-mark ${accent}`} aria-hidden="true">
          {accent === 'verified' ? '✓' : accent === 'expired' ? '!' : '✉'}
        </div>
        <h1 className="auth-heading">{heading}</h1>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- route ---------------------------------- */

function VerifyEmail() {
  const token = useSearchParams().get('token');
  return token ? <VerifyWithToken token={token} /> : <CheckYourInbox />;
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <VerifyEmail />
    </Suspense>
  );
}
