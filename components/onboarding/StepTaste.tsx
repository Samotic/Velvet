'use client';

import { RippleButton, useRipple } from '@/components/ui/Ripple';
import type { Mood } from '@/lib/authTypes';
import { GENRES, MIN_GENRES, MOODS } from '@/lib/onboarding';

/**
 * Step 4 — the taste profile. The most important screen in the flow: it is
 * what the AI advisor reasons over on every later request.
 *
 * Continue stays disabled until three genres and a mood are chosen, and the
 * counter below the grid says how many are still needed rather than leaving
 * the user to work out why the button is dead.
 */
export function StepTaste({
  genres,
  mood,
  busy,
  onGenres,
  onMood,
  onContinue,
}: {
  genres: string[];
  mood: Mood | null;
  busy: boolean;
  onGenres: (v: string[]) => void;
  onMood: (v: Mood) => void;
  onContinue: () => void;
}) {
  const ripple = useRipple();

  const toggle = (id: string) =>
    onGenres(genres.includes(id) ? genres.filter((g) => g !== id) : [...genres, id]);

  const remaining = Math.max(0, MIN_GENRES - genres.length);
  const canContinue = genres.length >= MIN_GENRES && mood !== null && !busy;

  return (
    <div>
      <h1 className="onb-title">
        What do you <em>love watching?</em>
      </h1>
      <p className="onb-sub">Pick at least three. You can change these any time.</p>

      <div className="genre-grid" role="group" aria-label="Favourite genres">
        {GENRES.map((g) => {
          const on = genres.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              className={`genre-card ripple-host${on ? ' on' : ''}`}
              onClick={(e) => {
                ripple(e);
                toggle(g.id);
              }}
            >
              <span className="genre-icon" aria-hidden>
                {g.icon}
              </span>
              {g.label}
            </button>
          );
        })}
      </div>

      <p className="genre-count" aria-live="polite">
        {remaining > 0 ? (
          <>
            Choose <b>{remaining}</b> more
          </>
        ) : (
          <>
            <b>{genres.length}</b> selected
          </>
        )}
      </p>

      <div style={{ marginTop: 34 }}>
        <span className="field-label" style={{ justifyContent: 'center' }}>
          Favourite mood?
        </span>
        <div className="select-grid cols-3" role="radiogroup" aria-label="Favourite mood">
          {MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mood === m.id}
              className={`select-card ripple-host${mood === m.id ? ' on' : ''}`}
              onClick={(e) => {
                ripple(e);
                onMood(m.id);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="onb-actions">
        <RippleButton
          className="btn-fill btn-lg btn-block"
          disabled={!canContinue}
          onClick={onContinue}
        >
          {busy ? <span className="spinner" /> : 'Continue'}
        </RippleButton>
      </div>
    </div>
  );
}
