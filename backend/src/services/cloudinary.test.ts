import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  derivePublicId,
  isDestroyableMessageMedia,
  isValidAudioDataUrl,
  stripMimeParams,
} from './cloudinary';

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

/* ------------------------- destroy-target parsing ------------------------- */

/**
 * The real shape Velvet emits, taken from a live voice note. `video` is the
 * resource type an audio file lives under — asserting it explicitly because a
 * derived `image` would make every voice-note delete a silent no-op.
 */
test('derives a voice note id, as resource_type video', () => {
  const url =
    'https://res.cloudinary.com/nhpamky7/video/upload/v1788706602/velvet/messages/audio/zudvoihmquukriqlqlzi.webm';
  assert.deepEqual(derivePublicId(url), {
    publicId: 'velvet/messages/audio/zudvoihmquukriqlqlzi',
    resourceType: 'video',
  });
});

test('derives an image id through a transformation segment', () => {
  const url =
    'https://res.cloudinary.com/demo/image/upload/w_1600,h_1600,c_limit/q_auto,f_auto/v1712345678/velvet/messages/images/abc123.jpg';
  assert.deepEqual(derivePublicId(url), {
    publicId: 'velvet/messages/images/abc123',
    resourceType: 'image',
  });
});

/**
 * The guard that matters. An avatar URL parses perfectly well — the refusal
 * has to be a deliberate prefix check, not a parse failure, which is why this
 * asserts null rather than merely "not an avatar id".
 */
test('refuses an avatar URL, which parses but must never be destroyed', () => {
  const url =
    'https://res.cloudinary.com/nhpamky7/image/upload/v1788701442/velvet/avatars/6a9d6aefdec2759dcfc802a9.jpg';
  assert.equal(derivePublicId(url), null);
});

test('refuses a TMDB-style host and any non-Cloudinary junk', () => {
  assert.equal(derivePublicId('https://image.tmdb.org/t/p/w500/poster.jpg'), null);
  assert.equal(derivePublicId('not a url'), null);
  assert.equal(derivePublicId(''), null);
});

test('isDestroyableMessageMedia gates on the messages prefix', () => {
  assert.equal(isDestroyableMessageMedia('velvet/messages/audio/x'), true);
  assert.equal(isDestroyableMessageMedia('velvet/messages/images/x'), true);
  assert.equal(isDestroyableMessageMedia('velvet/avatars/someuser'), false);
  assert.equal(isDestroyableMessageMedia('velvet/messages/../avatars/x'), false);
  assert.equal(isDestroyableMessageMedia(''), false);
});
