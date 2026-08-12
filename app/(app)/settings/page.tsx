'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Logout } from '@/components/icons';
import { longDate } from '@/lib/format';

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <Settings />
    </ProtectedRoute>
  );
}

function Settings() {
  const { user, logout, updateProfile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [isPrivate, setIsPrivate] = useState(user?.profileVisibility === 'private');
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  /**
   * Optimistic: the switch moves under the finger, then reconciles. A toggle
   * that waits for a round trip feels broken even when it is working.
   */
  async function togglePrivacy() {
    const next = !isPrivate;
    setIsPrivate(next);
    setSavingPrivacy(true);
    try {
      // updateProfile also refreshes the cached user, so the toggle survives
      // a navigation without a second fetch.
      await updateProfile({ profileVisibility: next ? 'private' : 'public' });
    } catch {
      setIsPrivate(!next);
      toast.bad('Could not change that setting');
    } finally {
      setSavingPrivacy(false);
    }
  }

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
        <div className="filter-label">Privacy</div>
        <div className="rate-card" style={{ marginTop: 12 }}>
          <div className="settings-toggle-row">
            <div>
              <div className="settings-toggle-label">Private account</div>
              <p className="settings-toggle-help">
                {isPrivate
                  ? 'New followers have to be approved. People already following you keep access.'
                  : 'Anyone can follow you, and they see your ratings straight away.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              aria-label="Private account"
              className={`settings-switch${isPrivate ? ' on' : ''}`}
              disabled={savingPrivacy}
              onClick={() => void togglePrivacy()}
            >
              <span className="settings-switch-knob" />
            </button>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 34 }}>
        <div className="filter-label">AI advisor</div>
        <div className="rate-card" style={{ marginTop: 12 }}>
          {user?.isPro ? (
            <Row label="Daily messages" value="Unlimited" />
          ) : (
            <Row
              label="Messages today"
              value={`${user?.aiMessagesUsedToday ?? 0} used of 10`}
            />
          )}

          <p
            style={{
              marginTop: 14,
              fontSize: 14,
              color: 'var(--muted)',
              fontWeight: 300,
              lineHeight: 1.6,
            }}
          >
            Velvet is free and always will be. The daily limit is only there to
            keep the advisor&rsquo;s running costs in check — it resets each morning.
          </p>
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
