'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Crown, Logout } from '@/components/icons';
import { longDate } from '@/lib/format';

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <Settings />
    </ProtectedRoute>
  );
}

function Settings() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await logout();
    } catch {
      toast.bad('Could not sign out');
      setBusy(false);
    }
  }

  return (
    <div className="screen-narrow" style={{ paddingBottom: 64 }}>
      <div className="screen-head">
        <h1 className="screen-title">
          Account <em>settings</em>
        </h1>
      </div>

      <section style={{ marginTop: 34 }}>
        <div className="filter-label">Account</div>
        <div className="rate-card" style={{ marginTop: 12 }}>
          <Row label="Display name" value={user?.displayName ?? '—'} />
          <Row label="Username" value={`@${user?.username ?? ''}`} />
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Member since" value={longDate(user?.createdAt)} />

          <Link href="/profile/edit" className="btn-primary" style={{ marginTop: 18 }}>
            Edit profile
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 34 }}>
        <div className="filter-label">Subscription</div>
        <div className="rate-card" style={{ marginTop: 12 }}>
          <Row
            label="Plan"
            value={user?.isPro ? 'Velvet Pro' : 'Free'}
          />
          {user?.isPro && user.proExpiresAt && (
            <Row label="Renews" value={longDate(user.proExpiresAt)} />
          )}
          {!user?.isPro && (
            <Row
              label="AI messages"
              value={`${user?.aiMessagesUsedToday ?? 0} used today of 10`}
            />
          )}

          <Link
            href="/pro"
            className={user?.isPro ? 'btn-outline' : 'btn-fill'}
            style={{ marginTop: 18 }}
          >
            <Crown size={15} />
            {user?.isPro ? 'Manage subscription' : 'Upgrade to Pro'}
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 34 }}>
        <div className="filter-label">Session</div>
        <div className="rate-card" style={{ marginTop: 12 }}>
          <p style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 300, lineHeight: 1.6 }}>
            Signing out clears your session on this device only.
          </p>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 16 }}
            disabled={busy}
            onClick={() => void signOut()}
          >
            {busy ? <span className="spinner" /> : <Logout />}
            Log out
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '11px 0',
        borderBottom: '1px solid var(--line-soft)',
        fontSize: 14,
      }}
    >
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--white)', textAlign: 'right', minWidth: 0 }}>{value}</span>
    </div>
  );
}
