import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loginAlert,
  newFollower,
  newMessage,
  passwordChanged,
  resetPassword,
  securityAlert,
  testEmail,
  verifyEmail,
  welcome,
} from './templates';

const at = new Date('2026-09-13T01:56:00Z');
const device = { browser: 'Chrome', os: 'Windows' };
const hostile = '<img src=x onerror=alert(1)>';

const rendered = {
  welcome: welcome({ displayName: hostile, favouriteGenres: ['Drama'], favouriteMood: 'feel_good' }),
  verifyEmail: verifyEmail({ displayName: hostile, token: 'a'.repeat(64) }),
  resetPassword: resetPassword({ displayName: hostile, token: 'b'.repeat(64) }),
  passwordChanged: passwordChanged({ displayName: hostile, at, device, ip: '203.0.113.7', sessionsEnded: true }),
  securityAlert: securityAlert({ displayName: hostile, headline: 'Your email changed', summary: 'It was changed.', at }),
  loginAlert: loginAlert({ displayName: hostile, at, timeZone: 'Europe/Istanbul', device, ip: '203.0.113.7', method: 'password' }),
  newMessage: newMessage({ fromName: hostile, fromUsername: 'eve', preview: hostile }),
  newFollower: newFollower({ followerName: hostile, followerUsername: 'eve' }),
  testEmail: testEmail({ displayName: hostile, at }),
};

describe('every template', () => {
  for (const [name, email] of Object.entries(rendered)) {
    it(`${name}: subject, HTML and a plain-text part`, () => {
      assert.ok(email.subject.length > 0);
      assert.ok(email.text.length > 0);
      // The hostile name may appear verbatim here — text/plain is never parsed
      // as HTML — so it is removed before looking for markup of our own.
      assert.doesNotMatch(email.text.split(hostile).join(''), /<[a-z][^>]*>/i, 'text part carries no markup');
    });

    it(`${name}: responsive shell`, () => {
      assert.match(email.html, /<meta name="viewport"/);
      assert.match(email.html, /@media only screen and \(max-width: 600px\)/);
    });

    it(`${name}: escapes user-controlled values`, () => {
      assert.ok(!email.html.includes(hostile));
    });
  }
});

describe('loginAlert', () => {
  const { subject, text, html } = rendered.loginAlert;

  it('says what the brief asks for', () => {
    assert.equal(subject, 'New login to your Velvet account');
    assert.ok(text.includes('If this was you, no action is required.'));
    assert.ok(text.includes("If this wasn't you, change your password immediately."));
    assert.ok(html.includes('no action is required'));
  });

  it('states when, on what and from where', () => {
    assert.match(text, /When: Sunday, 13 September 2026, 04:56 \(Europe\/Istanbul\)/);
    assert.match(text, /Device: Chrome on Windows/);
    assert.match(text, /IP address: 203\.0\.113\.7/);
    assert.match(text, /\/forgot-password/);
  });

  it('falls back to UTC for a zone Intl does not know', () => {
    const r = loginAlert({ displayName: 'Ada', at, timeZone: 'Mars/Olympus', device, ip: null, method: 'password' });
    assert.match(r.text, /01:56 \(UTC\)/);
    assert.doesNotMatch(r.text, /IP address/);
  });

  it('sends a Google sign-in to Google, not to a reset Velvet cannot do', () => {
    const r = loginAlert({ displayName: 'Ada', at, device, method: 'google' });
    assert.match(r.text, /with Google/);
    assert.match(r.text, /myaccount\.google\.com/);
    assert.doesNotMatch(r.text, /forgot-password/);
  });
});

describe('token emails', () => {
  it('link the raw token and state the lifetime the server keeps', () => {
    assert.match(rendered.verifyEmail.text, /\/verify-email\?token=a{64}/);
    assert.match(rendered.verifyEmail.text, /expires in 24 hours/);
    assert.match(rendered.resetPassword.text, /\/reset-password\?token=b{64}/);
    assert.match(rendered.resetPassword.text, /expires in 1 hour/);
  });
});

describe('securityAlert', () => {
  it('refuses an action that leaves the app', () => {
    for (const path of ['https://evil.test', '//evil.test', '/\\evil.test']) {
      const r = securityAlert({ displayName: 'Ada', headline: 'x', summary: 'y', at, action: { label: 'Go', path } });
      assert.ok(!r.html.includes('evil.test'), path);
    }
  });

  it('keeps a line break out of the subject', () => {
    const r = securityAlert({ displayName: 'Ada', headline: 'x\r\nBcc: eve@example.com', summary: 'y', at });
    assert.doesNotMatch(r.subject, /[\r\n]/);
  });
});
