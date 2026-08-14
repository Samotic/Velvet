'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { RippleButton } from '@/components/ui/Ripple';
import { VelvetMark } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { parseAiContent, sendAiMessage } from '@/lib/ai';
import type { CatalogDetail } from '@/lib/contentTypes';

/**
 * "What does Velvet AI think for you specifically?"
 *
 * Deliberately on-demand rather than auto-loading: every detail page would
 * otherwise fire a model call the user never asked for, burning their daily
 * quota just by browsing.
 */
export function AiOpinion({ item }: { item: CatalogDetail }) {
  const { isAuthenticated } = useAuth();

  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await sendAiMessage(
        `Would I like ${item.title}? Be specific about why, given my taste.`,
        { contentId: item.id, contentType: item.type, contentTitle: item.title },
      );
      setAnswer(res.message.content);
    } catch (err) {
      // A 429 is the daily cap; the server's own message explains it.
      if (err instanceof ApiError && err.status === 503) {
        setError('The advisor is not configured on this server yet.');
      } else {
        setError(err instanceof ApiError ? err.message : 'The advisor could not answer.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-card">
      <div className="ai-card-head">
        <span className="ai-mark" aria-hidden>
          <VelvetMark size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4>What does Velvet AI think — for you specifically?</h4>
          <p>Weighed against your genres, your mood and what you&rsquo;ve rated.</p>
        </div>

        {isAuthenticated ? (
          !answer && (
            <RippleButton className="btn-fill" disabled={busy} onClick={() => void ask()}>
              {busy ? <span className="spinner" /> : 'Ask'}
            </RippleButton>
          )
        ) : (
          <Link href="/signin" className="btn-secondary">
            Sign in
          </Link>
        )}
      </div>

      {error && (
        <div className="ai-answer" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}

      {answer && (
        <div className="ai-answer">
          {parseAiContent(answer).map((seg, i) =>
            seg.href ? (
              <Link key={i} href={seg.href} style={{ color: 'var(--accent-bright)' }}>
                {seg.text}
              </Link>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
