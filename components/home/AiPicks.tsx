'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState, PosterGridSkeleton } from '@/components/ui/States';
import { getAiPicks, type AiPick } from '@/lib/catalog';
import { ApiError } from '@/lib/api';

/**
 * Section 03 — AI Picks for You.
 *
 * Each card carries the advisor's one-line reason as its hover tip, so the
 * recommendation explains itself without a second screen.
 *
 * Three states other than "here are your picks": signed out, no taste profile
 * yet, and the advisor not being configured. Each says what to do about it
 * rather than rendering an empty rail.
 */
export function AiPicks() {
  const { isAuthenticated, user } = useAuth();
  const [picks, setPicks] = useState<AiPick[] | null>(null);
  const [problem, setProblem] = useState<'none' | 'unconfigured' | 'failed'>('none');

  useEffect(() => {
    if (!isAuthenticated) {
      setPicks([]);
      return;
    }

    const controller = new AbortController();
    setPicks(null);
    setProblem('none');

    getAiPicks(controller.signal)
      .then(setPicks)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 503 is the backend saying the Anthropic key is missing — a setup
        // problem, not a failure, and worth wording differently.
        setProblem(err instanceof ApiError && err.status === 503 ? 'unconfigured' : 'failed');
        setPicks([]);
      });

    return () => controller.abort();
  }, [isAuthenticated]);

  const header = (
    <div className="section-head">
      <div>
        <h2 className="section-title">
          <span className="section-num">03</span>
          AI Picks for You
        </h2>
        <p className="section-sub">
          Chosen against your taste profile — and each one tells you why.
        </p>
      </div>
      <Link href="/ai" className="section-link">
        Ask the advisor
      </Link>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <>
        {header}
        <EmptyState
          icon="✦"
          title="Picks need a profile"
          text="Create an account and tell Velvet what you love. The advisor takes it from there."
          action={{ label: 'Get started', href: '/onboarding' }}
        />
      </>
    );
  }

  if (picks === null) {
    return (
      <>
        {header}
        <PosterGridSkeleton count={6} />
      </>
    );
  }

  if (picks.length === 0) {
    return (
      <>
        {header}
        {problem === 'unconfigured' ? (
          <EmptyState
            icon="✦"
            title="Advisor not configured"
            text="Add an ANTHROPIC_API_KEY to the API and Velvet's advisor comes online — weekly picks, and a chat that knows your taste."
            action={{ label: 'Open the advisor', href: '/ai' }}
          />
        ) : user && user.favouriteGenres.length === 0 ? (
          <EmptyState
            icon="✦"
            title="Tell us what you like"
            text="Pick a few genres and a mood, and your weekly picks start arriving."
            action={{ label: 'Update my taste', href: '/profile/edit' }}
          />
        ) : (
          <EmptyState
            icon="✦"
            title="No picks yet"
            text="Rate a few titles and the advisor will have something to go on."
            action={{ label: 'Find something', href: '/search' }}
          />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="rail">
        {picks.map((p) => (
          <PosterCard key={`${p.item.type}-${p.item.id}`} item={p.item} tip={p.reason} />
        ))}
      </div>
    </>
  );
}
