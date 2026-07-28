/**
 * The onboarding vocabulary: genres, moods and gender options.
 *
 * Plain data in its own module because both server components and the
 * `'use client'` step components need it — importing an array out of a client
 * module hands the server a client reference proxy instead of the array, and
 * that throws at request time rather than build time.
 *
 * Slugs are what get persisted; labels are display-only. Never store the label.
 */

import type { Gender, Mood } from './authTypes';

/* -------------------------------- genres --------------------------------- */

/** Step 4's multi-select grid, in the spec's order. */
export const GENRES = [
  { id: 'Action', label: 'Action', icon: '⚔' },
  { id: 'Drama', label: 'Drama', icon: '◈' },
  { id: 'Comedy', label: 'Comedy', icon: '☺' },
  { id: 'Thriller', label: 'Thriller', icon: '⧗' },
  { id: 'Sci-Fi', label: 'Sci-Fi', icon: '◉' },
  { id: 'Horror', label: 'Horror', icon: '☾' },
  { id: 'Romance', label: 'Romance', icon: '♡' },
  { id: 'Documentary', label: 'Documentary', icon: '▤' },
  { id: 'Animation', label: 'Animation', icon: '✦' },
  { id: 'World Cinema', label: 'World Cinema', icon: '❖' },
  { id: 'Crime', label: 'Crime', icon: '⌖' },
  { id: 'Fantasy', label: 'Fantasy', icon: '✧' },
  { id: 'Mystery', label: 'Mystery', icon: '?' },
  { id: 'History', label: 'History', icon: '⌛' },
  { id: 'Biography', label: 'Biography', icon: '☗' },
] as const;

/** Step 4 can't be completed below this — the Continue button stays disabled. */
export const MIN_GENRES = 3;

export const isGenre = (v: string): boolean => GENRES.some((g) => g.id === v);

/* --------------------------------- moods --------------------------------- */

export const MOODS: { id: Mood; label: string }[] = [
  { id: 'dark_intense', label: 'Dark & Intense' },
  { id: 'feel_good', label: 'Feel-Good' },
  { id: 'mind_bending', label: 'Mind-Bending' },
  { id: 'epic_grand', label: 'Epic & Grand' },
  { id: 'funny_light', label: 'Funny & Light' },
  { id: 'romantic', label: 'Romantic' },
];

export const moodLabel = (mood: Mood | undefined | null): string | null =>
  MOODS.find((m) => m.id === mood)?.label ?? null;

/* -------------------------------- gender --------------------------------- */

export const GENDERS: { id: Gender; label: string }[] = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const genderLabel = (gender: Gender | undefined | null): string | null =>
  GENDERS.find((g) => g.id === gender)?.label ?? null;

/* --------------------------------- steps --------------------------------- */

/** Total steps in the flow, for the progress bar. */
export const TOTAL_STEPS = 6;

/** The minimum age the form accepts, mirrored by the User schema. */
export const MIN_AGE = 13;
