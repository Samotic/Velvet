/**
 * SMTP settings, validated.
 *
 * Pure: it takes the raw strings and answers whether they describe a usable
 * server, so every rule is testable without a `.env` and without a network.
 * `env.ts` supplies the strings; `services/emailService.ts` acts on the answer.
 *
 * Every problem is reported by **variable name only**. A message that echoed
 * the value it rejected would, sooner or later, print a password into a log.
 */

export interface RawSmtp {
  host: string;
  port: string;
  secure: string;
  user: string;
  pass: string;
  fromName: string;
  fromAddress: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromAddress: string;
}

export type SmtpReadiness =
  | { status: 'ready'; settings: SmtpSettings; warnings: string[] }
  | { status: 'incomplete'; problems: string[] }
  | { status: 'absent' };

/** One address, no display name, nothing that could start a second header. */
const ADDRESS = /^[^\s@<>"',;()\\[\]]+@[^\s@<>"',;()\\[\]]+\.[^\s@<>"',;()\\[\]]+$/;

export function readSmtp(raw: RawSmtp): SmtpReadiness {
  const host = raw.host.trim();
  const user = raw.user.trim();
  const pass = raw.pass;
  const fromAddress = raw.fromAddress.trim();

  // Port, security and the display name all have defaults in .env.example, so
  // none of them says anyone has started configuring SMTP. These four do.
  if (!host && !user && !pass.trim() && !fromAddress) return { status: 'absent' };

  const problems: string[] = [];

  if (!host) problems.push('SMTP_HOST is empty');
  else if (/[\s/@]/.test(host)) {
    problems.push('SMTP_HOST must be a bare hostname such as smtp.example.com, with no scheme, user or path');
  }
  if (!user) problems.push('SMTP_USER is empty');
  if (!pass.trim()) problems.push('SMTP_PASS is empty');
  if (!fromAddress) problems.push('EMAIL_FROM_ADDRESS is empty');
  else if (!ADDRESS.test(fromAddress)) problems.push('EMAIL_FROM_ADDRESS is not a single email address');

  const port = parsePort(raw.port);
  if (port === null) problems.push('SMTP_PORT must be a whole number between 1 and 65535');

  const secure = parseSecure(raw.secure, port);
  if (secure === null) problems.push('SMTP_SECURE must be true or false');

  if (problems.length || port === null || secure === null) return { status: 'incomplete', problems };

  // Both of these are almost always a connection that fails, but the provider
  // is the authority on its own ports, so they warn rather than refuse.
  const warnings: string[] = [];
  if (port === 465 && !secure) {
    warnings.push(
      'SMTP_PORT is 465 but SMTP_SECURE is false. Port 465 expects TLS from the first byte; set SMTP_SECURE=true or the connection will hang until it times out.',
    );
  }
  if (port === 587 && secure) {
    warnings.push(
      'SMTP_PORT is 587 but SMTP_SECURE is true. Port 587 upgrades with STARTTLS; set SMTP_SECURE=false or the TLS handshake will fail.',
    );
  }

  return {
    status: 'ready',
    settings: { host, port, secure, user, pass, fromName: displayName(raw.fromName), fromAddress },
    warnings,
  };
}

function parsePort(value: string): number | null {
  const v = value.trim();
  if (!v) return 587;
  if (!/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 65535 ? n : null;
}

/** Unset follows the port: 465 is implicit TLS, everything else starts plain and upgrades. */
function parseSecure(value: string, port: number | null): boolean | null {
  const v = value.trim().toLowerCase();
  if (!v) return port === 465;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

function displayName(value: string): string {
  // A line break in a header value is how header injection starts.
  const name = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  return name || 'Velvet';
}
