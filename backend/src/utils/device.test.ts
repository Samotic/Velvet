import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeDevice, deviceLabel, displayIp } from './device';

const label = (ua: string) => deviceLabel(describeDevice(ua));

describe('describeDevice', () => {
  it('names the common browsers, most specific first', () => {
    assert.equal(
      label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'),
      'Chrome on Windows',
    );
    assert.equal(
      label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'),
      'Microsoft Edge on Windows',
    );
    assert.equal(
      label('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
      'Safari on iPhone',
    );
    assert.equal(
      label('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'),
      'Chrome on Android',
    );
    assert.equal(label('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'Firefox on Linux');
    assert.equal(
      label('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'),
      'Safari on macOS',
    );
  });

  it('never echoes the header, only fixed labels', () => {
    const d = describeDevice('<script>alert(1)</script>');
    assert.deepEqual(d, { browser: null, os: null });
    assert.equal(deviceLabel(d), 'An unrecognised device');
    assert.deepEqual(describeDevice(undefined), { browser: null, os: null });
  });
});

describe('displayIp', () => {
  it('unwraps IPv4-mapped IPv6 and drops anything that is not an address', () => {
    assert.equal(displayIp('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(displayIp('2001:db8::1'), '2001:db8::1');
    assert.equal(displayIp('<b>hi</b>'), null);
    assert.equal(displayIp(undefined), null);
  });
});
