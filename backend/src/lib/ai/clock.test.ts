import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentMoment, isValidTimeZone } from './clock';

/** A fixed instant, so these assert formatting rather than the wall clock. */
const AT = new Date('2026-09-07T21:30:00Z');

test('states the weekday, full date and time in the given zone', () => {
  // 21:30 UTC is already 00:30 the next day in Istanbul (UTC+3), which is the
  // whole reason the zone is carried: the weekday here is Tuesday, not Monday.
  const out = currentMoment('Europe/Istanbul', AT);
  assert.match(out, /Tuesday/);
  assert.match(out, /8 September 2026/);
  assert.match(out, /00:30/);
  assert.match(out, /\(Europe\/Istanbul\)/);
});

/**
 * The reason the zone comes from the browser at all: at 21:30 UTC it is
 * already the 8th in Istanbul, so a server formatting in its own zone would
 * tell a user in Turkey the wrong day for a good part of every evening.
 */
test('resolves the date in the user zone, not the server one', () => {
  const istanbul = currentMoment('Europe/Istanbul', AT);
  const utc = currentMoment('UTC', AT);

  assert.match(istanbul, /Tuesday, 8 September 2026/);
  assert.match(utc, /Monday, 7 September 2026/);
});

test('falls back to UTC rather than throwing on a bad zone', () => {
  for (const bad of ['Mars/Olympus', '', 'not a zone', 'x'.repeat(200)]) {
    const out = currentMoment(bad, AT);
    assert.match(out, /\(UTC\)/, `expected UTC fallback for ${JSON.stringify(bad)}`);
  }
});

test('falls back to UTC when no zone is sent at all', () => {
  assert.match(currentMoment(undefined, AT), /\(UTC\)/);
  assert.match(currentMoment(null, AT), /\(UTC\)/);
});

test('isValidTimeZone accepts real zones and rejects the rest', () => {
  assert.equal(isValidTimeZone('Europe/Istanbul'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
  // Length-capped before Intl sees it: the value reaches a prompt, and an
  // unbounded string from a client has no business being interpolated there.
  assert.equal(isValidTimeZone('x'.repeat(200)), false);
});
