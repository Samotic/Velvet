'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import type { WatchStats as Stats } from '@/lib/contentTypes';
import { getWatchStats, onLibraryChange } from '@/lib/ratings';

/**
 * The four-cell stat strip: Films Watched · Hours Watched · Top Genre · Avg Rating.
 *
 * These are the user's real figures, derived server-side from their ratings.
 * A count of zero is a real figure and renders as "0"; the em-dash is only for
 * values that genuinely don't exist yet, such as an average with nothing rated.
 * The mockup's demo numbers are never substituted.
 */
export function WatchStats() {
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(() => {
    if (!isAuthenticated) {
      setStats(null);
      return;
    }
    void getWatchStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [isAuthenticated]);

  useEffect(() => onLibraryChange(load), [load]);

  const dash = <div className="stat-figure blank">—</div>;

  return (
    <div className="statbar">
      <div className="stat-cell">
        <div className="stat-cap">Films watched</div>
        {stats ? <div className="stat-figure">{stats.films}</div> : dash}
        <div className="stat-note">
          {stats?.filmsThisYear ? (
            <>
              <b>+{stats.filmsThisYear}</b> this year
            </>
          ) : isAuthenticated ? (
            'Rate something to start counting'
          ) : (
            'Sign in to track what you watch'
          )}
        </div>
      </div>

      <div className="stat-cell">
        <div className="stat-cap">Hours watched</div>
        {stats ? <div className="stat-figure">{stats.hours}</div> : dash}
        <div className="stat-note">
          {stats && stats.streak > 1 ? (
            <>
              <b>{stats.streak}-day</b> streak
            </>
          ) : (
            'From the runtimes you rate'
          )}
        </div>
      </div>

      <div className="stat-cell">
        <div className="stat-cap">Top genre</div>
        {stats?.topGenre ? <div className="stat-figure word">{stats.topGenre}</div> : dash}
        <div className="stat-note">
          {stats?.topGenre && stats.genreBreakdown.length > 0 ? (
            <>
              <b>{stats.genreBreakdown[0].count}</b> titles
            </>
          ) : (
            'Emerges once you rate a few'
          )}
        </div>
      </div>

      <div className="stat-cell">
        <div className="stat-cap">Avg rating given</div>
        {stats?.averageRating != null ? (
          <div className="stat-figure">{stats.averageRating.toFixed(1)}</div>
        ) : (
          dash
        )}
        <div className="stat-note">
          {stats?.averageRating != null ? (
            stats.averageRating >= 4 ? (
              <>
                You rate <b>generously</b>
              </>
            ) : stats.averageRating >= 3 ? (
              <>
                You rate <b>tough but fair</b>
              </>
            ) : (
              <>
                You rate <b>hard to please</b>
              </>
            )
          ) : (
            'No ratings yet'
          )}
        </div>
      </div>
    </div>
  );
}
