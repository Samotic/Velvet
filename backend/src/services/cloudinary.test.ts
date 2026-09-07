import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isValidAudioDataUrl, stripMimeParams } from './cloudinary';

/**
 * Guards the one bug that got all the way to a user: Cloudinary answers
 * `400 Unsupported source URL` for a data URL whose MIME type carries any
 * parameter, and every browser recording carries `;codecs=opus`.
 */

test('strips the codec parameter browsers attach to recordings', () => {
  assert.equal(
    stripMimeParams('data:audio/webm;codecs=opus;base64,AAAA'),
    'data:audio/webm;base64,AAAA',
  );
});

test('strips parameters regardless of how many there are', () => {
  assert.equal(
    stripMimeParams('data:audio/ogg;codecs=opus;rate=48000;base64,AAAA'),
    'data:audio/ogg;base64,AAAA',
  );
});

test('leaves a parameterless data URL untouched', () => {
  const plain = 'data:audio/wav;base64,AAAA';
  assert.equal(stripMimeParams(plain), plain);
});

test('handles image types too', () => {
  assert.equal(
    stripMimeParams('data:image/png;charset=utf-8;base64,AAAA'),
    'data:image/png;base64,AAAA',
  );
});

test('does not touch the base64 payload, which may contain + / =', () => {
  const payload = 'ab+/cd==';
  assert.equal(
    stripMimeParams(`data:audio/webm;codecs=opus;base64,${payload}`),
    `data:audio/webm;base64,${payload}`,
  );
});

/**
 * Validation must keep *accepting* the parameter — rejecting it would mean
 * refusing exactly what MediaRecorder produces. Normalising happens later, at
 * the boundary with the vendor that cannot read it.
 */
test('validation accepts the codec parameter rather than rejecting it', () => {
  assert.equal(isValidAudioDataUrl('data:audio/webm;codecs=opus;base64,AAAA'), true);
  assert.equal(isValidAudioDataUrl('data:audio/mp4;base64,AAAA'), true);
});

test('validation still rejects a non-audio payload', () => {
  assert.equal(isValidAudioDataUrl('data:text/html;base64,AAAA'), false);
  assert.equal(isValidAudioDataUrl('not-a-data-url'), false);
});

/** The normalised output must still be something the validator recognises. */
test('a stripped recording is still a valid audio data URL', () => {
  const stripped = stripMimeParams('data:audio/webm;codecs=opus;base64,AAAA');
  assert.equal(isValidAudioDataUrl(stripped), true);
});
