'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { RippleButton } from '@/components/ui/Ripple';
import { Check, Crown } from '@/components/icons';
import { ApiError, api } from '@/lib/api';

const FREE = [
  '10 AI advisor messages a day',
  'Unlimited ratings and reviews',
  'Full watchlist across films, series and games',
  'Follow people and message them',
];

const PRO = [
  'Unlimited AI advisor messages',
  'Weekly AI picks tuned to your taste',
  'Deeper taste analysis on your profile',
  'Early access to new Velvet features',
  'Everything in Free',
];

export default function ProPage() {
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function upgrade() {
    if (!isAuthenticated) {
      toast.bad('Sign in to upgrade');
      return;
    }
    setBusy(true);
    try {
      // The server creates the Stripe Checkout session and hands back its URL;
      // the card details never touch Velvet.
      const { url } = await api.post<{ url: string }>('/api/pro/checkout');
      window.location.href = url;
    } catch (err) {
      toast.bad(
        err instanceof ApiError && err.status === 503
          ? 'Payments are not configured on this server yet'
          : 'Could not start checkout',
      );
      setBusy(false);
    }
  }

  return (
    <div className="screen-narrow" style={{ paddingBottom: 70 }}>
      <div className="screen-head" style={{ textAlign: 'center' }}>
        <span className="eyebrow">Velvet Pro</span>
        <h1 className="screen-title" style={{ marginTop: 18 }}>
          An advisor with <em>no limits</em>
        </h1>
        <p className="screen-sub" style={{ margin: '12px auto 0' }}>
          The free tier gives you ten questions a day. Pro takes the cap off — and adds weekly picks
          chosen against everything you&rsquo;ve rated.
        </p>
      </div>

      <div className="plans">
        <div className="plan">
          <div className="plan-name">Free</div>
          <div className="plan-price">
            £0 <small>/ forever</small>
          </div>
          <ul className="plan-list">
            {FREE.map((f) => (
              <li key={f}>
                <Check />
                {f}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-outline btn-block" disabled>
            {user && !user.isPro ? 'Your current plan' : 'Free'}
          </button>
        </div>

        <div className="plan featured">
          <div className="plan-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Crown size={17} />
            Pro
          </div>
          <div className="plan-price">
            £4.99 <small>/ month</small>
          </div>
          <ul className="plan-list">
            {PRO.map((f) => (
              <li key={f}>
                <Check />
                {f}
              </li>
            ))}
          </ul>

          {user?.isPro ? (
            <Link href="/settings" className="btn-outline btn-block on">
              Manage subscription
            </Link>
          ) : (
            <RippleButton
              className="btn-fill btn-block btn-lg"
              disabled={busy}
              onClick={() => void upgrade()}
            >
              {busy ? <span className="spinner" /> : 'Upgrade to Pro'}
            </RippleButton>
          )}
        </div>
      </div>

      <p
        style={{
          textAlign: 'center',
          marginTop: 28,
          fontSize: 12.5,
          color: 'var(--muted)',
        }}
      >
        Cancel any time. Billing is handled by Stripe — Velvet never sees your card.
      </p>
    </div>
  );
}
