import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeFailure,
  formatSender,
  htmlToText,
  maskAddress,
  normaliseRecipient,
  oneLine,
  redact,
  secretForms,
} from './emailMessage';

describe('formatSender', () => {
  it('combines the display name with the address', () => {
    assert.equal(formatSender('Velvet', 'no-reply@mail.velvetapp.app'), 'Velvet <no-reply@mail.velvetapp.app>');
  });

  it('sends the bare address when there is no name', () => {
    assert.equal(formatSender('', 'no-reply@mail.velvetapp.app'), 'no-reply@mail.velvetapp.app');
    assert.equal(formatSender('   ', 'no-reply@mail.velvetapp.app'), 'no-reply@mail.velvetapp.app');
  });

  it('quotes a name that would otherwise break the header', () => {
    assert.equal(formatSender('Velvet, Ltd.', 'a@b.co'), '"Velvet, Ltd." <a@b.co>');
    assert.equal(formatSender('He said "hi"', 'a@b.co'), '"He said \\"hi\\"" <a@b.co>');
  });

  it('keeps a line break out of the header', () => {
    const out = formatSender('Velvet\r\nBcc: eve@example.com', 'a@b.co');
    assert.doesNotMatch(String(out), /[\r\n]/);
  });

  it('refuses an address that is not a bare address', () => {
    for (const bad of ['Velvet <a@b.co>', 'a@b.co, c@d.co', 'not-an-address', '', '  ']) {
      assert.equal(formatSender('Velvet', bad), null, bad);
    }
  });
});

describe('normaliseRecipient', () => {
  it('accepts one address and trims it', () => {
    assert.equal(normaliseRecipient('  ada@example.com '), 'ada@example.com');
  });

  it('refuses anything that could reach a second inbox', () => {
    for (const bad of [
      'ada@example.com, eve@example.com',
      'ada@example.com;eve@example.com',
      'ada@example.com\r\nBcc: eve@example.com',
      'Ada <ada@example.com>',
      '',
      'not-an-address',
      42,
      null,
    ]) {
      assert.equal(normaliseRecipient(bad), null, String(bad));
    }
  });
});

describe('message shaping', () => {
  it('collapses a subject to one line', () => {
    assert.equal(oneLine('Hello\r\nBcc: eve@example.com'), 'Hello Bcc: eve@example.com');
  });

  it('derives readable text from HTML', () => {
    const text = htmlToText(
      '<head><title>x</title></head><div style="display:none;">pre</div><p>Hi &amp; welcome</p><a href="https://v.test/a">Open</a><br>Bye',
    );
    assert.equal(text, 'Hi & welcome\nOpen (https://v.test/a)\nBye');
  });

  it('masks an address for logs', () => {
    assert.equal(maskAddress('ada@example.com'), 'a***@example.com');
    assert.equal(maskAddress('nonsense'), '***');
  });
});

describe('credential redaction', () => {
  const user = 'mailer@example.com';
  const pass = 'hunter2-very-secret';
  const forms = secretForms(user, pass);
  const plainBlob = Buffer.from(`\x00${user}\x00${pass}`).toString('base64');

  it('covers the password and its AUTH PLAIN and AUTH LOGIN encodings', () => {
    assert.ok(forms.includes(pass));
    assert.ok(forms.includes(Buffer.from(pass).toString('base64')));
    assert.ok(forms.includes(plainBlob));
    assert.deepEqual(secretForms(user, ''), []);
  });

  it('removes every form from free text', () => {
    const out = redact(`535 bad ${pass} / ${plainBlob}`, forms);
    assert.doesNotMatch(out, /hunter2/);
    assert.ok(!out.includes(plainBlob));
  });

  it('reduces a transport error to a code, a verb and a redacted message', () => {
    const err = Object.assign(new Error(`Invalid login: 535 ${pass}`), {
      code: 'EAUTH',
      responseCode: 535,
      command: `AUTH PLAIN ${plainBlob}`,
    });
    const failure = describeFailure(err, forms);
    assert.equal(failure.code, 'EAUTH');
    assert.equal(failure.responseCode, 535);
    assert.equal(failure.command, 'AUTH PLAIN');
    assert.doesNotMatch(JSON.stringify(failure), /hunter2/);
    assert.ok(!JSON.stringify(failure).includes(plainBlob));
  });

  it('drops a code that is not a transport code', () => {
    assert.equal(describeFailure({ code: `EAUTH ${pass}` }, forms).code, null);
    assert.equal(describeFailure('boom', forms).message, 'boom');
  });
});
