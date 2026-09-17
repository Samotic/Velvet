/**
 * The pure half of sending mail: shaping a message, and making a failure safe
 * to log. No transport and no env, so every rule here is unit-testable.
 */

/** One address, no display name, nothing that could start a second header. */
const ADDRESS = /^[^\s@<>"',;()\\[\]]+@[^\s@<>"',;()\\[\]]+\.[^\s@<>"',;()\\[\]]+$/;

/**
 * Exactly one recipient, or null.
 *
 * A comma or a line break in `to` is how a single send becomes a relay to
 * addresses nobody chose, so anything that could carry a second address is
 * refused rather than trimmed into shape.
 */
export function normaliseRecipient(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 254 || /[\r\n]/.test(v)) return null;
  return ADDRESS.test(v) ? v : null;
}

/**
 * The `From` header, from a display name and a bare address.
 *
 * Returns null when the address is not exactly one plain address, so a caller
 * can fall back rather than send `Velvet <Velvet <a@b.c>>` or something worse:
 * `EMAIL_FROM_ADDRESS` holds the address alone, never `Name <address>`.
 *
 * Nodemailer builds this header itself from `{ name, address }`, so only the
 * Resend path needs it — Resend takes one string.
 */
export function formatSender(name: string, address: string): string | null {
  const addr = address.trim();
  if (!ADDRESS.test(addr)) return null;

  // A line break here would end the header and start another one.
  const display = name.replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  if (!display) return addr;

  // RFC 5322: a display name containing any of these must be a quoted string.
  const needsQuoting = /[()<>@,;:\\".[\]]/.test(display);
  const quoted = needsQuoting ? `"${display.replace(/["\\]/g, '\\$&')}"` : display;
  return `${quoted} <${addr}>`;
}

/** Collapses a header value to one line. Subjects carry display names. */
export function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * A plain-text part for a caller that supplied none.
 *
 * Every template writes its own, which reads better; this exists so a message
 * never goes out HTML-only, which spam filters score against and screen
 * readers in some clients handle badly.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|table|li)>/gi, '\n')
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `s***@example.com` — enough to tell two log lines apart, not a mailing list. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/**
 * Every spelling of an SMTP credential that can surface in an error.
 *
 * The password itself, and the base64 forms AUTH PLAIN and AUTH LOGIN put on
 * the wire. Nodemailer masks these in its own logging already; this is the
 * second lock, for whatever an SMTP server chooses to echo back.
 */
export function secretForms(user: string, pass: string): string[] {
  if (!pass) return [];
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const forms = [
    pass,
    b64(pass),
    b64(`\x00${user}\x00${pass}`),
    b64(`${user}\x00${pass}`),
    encodeURIComponent(pass),
  ];
  return [...new Set(forms)].filter(Boolean);
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  // Longest first, so a form that contains another is removed whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

export interface SafeFailure {
  /** Nodemailer's code — EAUTH, ETIMEDOUT, ECONNECTION… — or null. */
  code: string | null;
  responseCode: number | null;
  /** The SMTP verb only. An AUTH command's argument is the credential. */
  command: string | null;
  message: string;
}

/** Reduces a transport error to fields that are safe to log and to act on. */
export function describeFailure(err: unknown, secrets: string[]): SafeFailure {
  const e = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;

  const code = typeof e.code === 'string' && /^E[A-Z]{2,20}$/.test(e.code) ? e.code : null;
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : null;
  const command =
    typeof e.command === 'string'
      ? e.command
          .split(' ')
          .slice(0, 2)
          .join(' ')
          .replace(/[^A-Za-z ]/g, '')
          .toUpperCase()
          .trim()
          .slice(0, 20) || null
      : null;

  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown email error';
  const message = redact(raw, secrets).replace(/[\r\n]+/g, ' ').slice(0, 300);

  return { code, responseCode, command, message };
}
