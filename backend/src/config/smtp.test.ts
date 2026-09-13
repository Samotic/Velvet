import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readSmtp, type RawSmtp } from './smtp';

const full: RawSmtp = {
  host: 'smtp.example.com',
  port: '587',
  secure: 'false',
  user: 'mailer@example.com',
  pass: 'hunter2-very-secret',
  fromName: 'Velvet',
  fromAddress: 'noreply@example.com',
};

/** What .env.example ships: defaults present, nothing a person has filled in. */
const shipped: RawSmtp = { ...full, host: '', user: '', pass: '', fromAddress: '' };

describe('readSmtp', () => {
  it('reads the shipped placeholders as absent, not incomplete', () => {
    assert.deepEqual(readSmtp(shipped), { status: 'absent' });
    assert.deepEqual(readSmtp({ ...shipped, port: '', secure: '', fromName: '' }), { status: 'absent' });
  });

  it('accepts a complete configuration', () => {
    const r = readSmtp(full);
    assert.equal(r.status, 'ready');
    if (r.status !== 'ready') return;
    assert.equal(r.settings.port, 587);
    assert.equal(r.settings.secure, false);
    assert.deepEqual(r.warnings, []);
  });

  it('defaults the port to 587, security to the port, and the name to Velvet', () => {
    const r = readSmtp({ ...full, port: '', secure: '', fromName: '' });
    assert.equal(r.status, 'ready');
    if (r.status !== 'ready') return;
    assert.equal(r.settings.port, 587);
    assert.equal(r.settings.secure, false);
    assert.equal(r.settings.fromName, 'Velvet');

    const implicit = readSmtp({ ...full, port: '465', secure: '' });
    assert.equal(implicit.status === 'ready' && implicit.settings.secure, true);
  });

  it('names every missing variable once something has been filled in', () => {
    const r = readSmtp({ ...shipped, pass: 'hunter2-very-secret' });
    assert.equal(r.status, 'incomplete');
    if (r.status !== 'incomplete') return;
    const all = r.problems.join(' | ');
    for (const name of ['SMTP_HOST', 'SMTP_USER', 'EMAIL_FROM_ADDRESS']) assert.match(all, new RegExp(name));
    assert.doesNotMatch(all, /SMTP_PASS/);
  });

  it('never repeats a value in a problem', () => {
    const r = readSmtp({ ...full, host: 'smtp://hunter2-very-secret@x', port: 'hunter2-very-secret' });
    assert.equal(r.status, 'incomplete');
    if (r.status !== 'incomplete') return;
    assert.doesNotMatch(r.problems.join(' '), /hunter2/);
  });

  it('refuses a malformed port, security flag, host or sender', () => {
    const problems = (raw: Partial<RawSmtp>) => {
      const r = readSmtp({ ...full, ...raw });
      return r.status === 'incomplete' ? r.problems.join(' ') : '';
    };
    assert.match(problems({ port: 'abc' }), /SMTP_PORT/);
    assert.match(problems({ port: '70000' }), /SMTP_PORT/);
    assert.match(problems({ port: '0' }), /SMTP_PORT/);
    assert.match(problems({ secure: 'yes' }), /SMTP_SECURE/);
    assert.match(problems({ host: 'smtp://smtp.example.com' }), /SMTP_HOST/);
    assert.match(problems({ fromAddress: 'Velvet <noreply@example.com>' }), /EMAIL_FROM_ADDRESS/);
    assert.match(problems({ fromAddress: 'a@example.com, b@example.com' }), /EMAIL_FROM_ADDRESS/);
    assert.match(problems({ pass: '   ' }), /SMTP_PASS/);
  });

  it('warns about the two port and security pairings that never connect', () => {
    const a = readSmtp({ ...full, port: '465', secure: 'false' });
    const b = readSmtp({ ...full, port: '587', secure: 'true' });
    assert.equal(a.status === 'ready' && a.warnings.length, 1);
    assert.equal(b.status === 'ready' && b.warnings.length, 1);
  });

  it('strips line breaks from the display name', () => {
    const r = readSmtp({ ...full, fromName: 'Velvet\r\nBcc: someone@example.com' });
    assert.equal(r.status === 'ready' && /[\r\n]/.test(r.settings.fromName), false);
  });
});
