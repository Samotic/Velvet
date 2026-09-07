import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSystemPrompt, type TasteProfile } from './advisor';

/** A new account: onboarding done, nothing rated, nothing saved. */
const BARE: TasteProfile = {
  displayName: 'New',
  favouriteGenres: [],
  watchHistoryCount: 0,
  avgRating: null,
  recentWatches: [],
};

const FULL: TasteProfile = {
  ...BARE,
  displayName: 'Ada',
  favouriteGenres: ['Romance'],
  watchHistoryCount: 142,
  avgRating: 3.8,
  loved: [{ title: 'Hereditary', rating: 5, type: 'movie' }],
  disliked: [{ title: 'Love Actually', rating: 1, type: 'movie' }],
  observedGenres: [{ genre: 'Horror', count: 33 }],
  typeMix: { movie: 118, series: 21, game: 3 },
  watchlist: ['Poor Things'],
  inProgress: [{ title: 'Shogun', percent: 40 }],
};

test('carries the score with the title, not just the title', () => {
  const out = buildSystemPrompt(FULL);
  assert.match(out, /Loved: Hereditary \(5\/5\)/);
  assert.match(out, /Disliked: Love Actually \(1\/5\)/);
});

test('states the observed genres separately from the declared ones', () => {
  const out = buildSystemPrompt(FULL);
  // Declared and observed disagree here on purpose — that is the case the
  // instruction below exists to resolve.
  assert.match(out, /Favourite genres: Romance/);
  assert.match(out, /Genres they actually rate: Horror \(33\)/);
  assert.match(out, /trust what they rate/);
});

test('reports the split across the three catalogues', () => {
  assert.match(buildSystemPrompt(FULL), /118 films, 21 series, 3 games/);
});

test('names the watchlist and what is part-way through', () => {
  const out = buildSystemPrompt(FULL);
  assert.match(out, /Already on their watchlist: Poor Things/);
  assert.match(out, /Shogun \(40% in\)/);
});

/**
 * The important half of the empty case. An absent line reads as "no data"; a
 * line saying "Disliked: none yet" invites the model to remark on the absence,
 * and the instruction block below it would be telling it how to use data that
 * is not there.
 */
test('omits the behavioural block entirely for a new account', () => {
  const out = buildSystemPrompt(BARE);
  assert.doesNotMatch(out, /Loved:/);
  assert.doesNotMatch(out, /Disliked:/);
  assert.doesNotMatch(out, /watchlist/i);
  assert.doesNotMatch(out, /How to use the behavioural data/);
  // The declared half still prints, because onboarding may have filled it in.
  assert.match(out, /Favourite genres: none yet/);
});

test('does not print an average when there are no ratings', () => {
  assert.match(buildSystemPrompt(BARE), /Average rating they give: no ratings yet\n/);
  assert.match(buildSystemPrompt(FULL), /Average rating they give: 3\.8 out of 5/);
});

test('a partly-filled profile prints only the parts it has', () => {
  const out = buildSystemPrompt({ ...BARE, disliked: [{ title: 'Cats', rating: 1, type: 'movie' }] });
  assert.match(out, /Disliked: Cats \(1\/5\)/);
  assert.doesNotMatch(out, /Loved:/);
  assert.doesNotMatch(out, /Split by kind/);
  // The instructions appear because there is now something to instruct about.
  assert.match(out, /steer AWAY/);
});
