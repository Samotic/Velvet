/**
 * A human description of the device behind a request, for security emails.
 *
 * Deliberately coarse: browser family and operating system, never versions.
 * The User-Agent header is written by whoever sent the request, so nothing
 * here echoes it — every output is one of the fixed labels below, which is
 * what makes it safe to put in an email that says "was this you?".
 */

export interface DeviceInfo {
  browser: string | null;
  os: string | null;
}

/* Order matters: Edge, Opera and Samsung Internet all also claim Chrome, and
   Chrome claims Safari. The more specific token has to be tested first. */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Microsoft Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

/* iPhone and iPad say "like Mac OS X"; Android and ChromeOS say Linux. */
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  const pick = (table: ReadonlyArray<readonly [RegExp, string]>) =>
    ua ? (table.find(([pattern]) => pattern.test(ua))?.[1] ?? null) : null;
  return { browser: pick(BROWSERS), os: pick(SYSTEMS) };
}

export function deviceLabel(device: DeviceInfo): string {
  if (device.browser && device.os) return `${device.browser} on ${device.os}`;
  return device.browser ?? device.os ?? 'An unrecognised device';
}

/**
 * `req.ip` as a person would recognise it, or null.
 *
 * `trust proxy` (app.ts) has already resolved it to the caller rather than the
 * platform edge. IPv4-mapped IPv6 is unwrapped, and anything that does not
 * look like an address is dropped rather than printed.
 */
export function displayIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : null;
}
