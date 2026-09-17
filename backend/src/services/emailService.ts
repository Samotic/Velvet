import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { Resend } from 'resend';

import { env } from '../config/env';
import { readSmtp, type SmtpReadiness, type SmtpSettings } from '../config/smtp';
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

/**
 * The one place mail leaves Velvet.
 *
 * Three states, decided from the environment at boot:
 *   SMTP ready        → Nodemailer, through the provider in SMTP_*.
 *   SMTP not ready,
 *   RESEND_API_KEY    → Resend, the transport this replaced, kept as fallback.
 *   neither           → every send is a logged no-op.
 *
 * `sendEmail` never throws. An email failing must not fail the action that
 * triggered it: an account is still created, a sign-in still succeeds, a
 * password is still reset. It resolves to what happened instead, so a caller
 * that needs to answer honestly — resend-verification, the test endpoint — can.
 *
 * ── Credentials ──
 * SMTP_PASS is read here and nowhere else. It is never returned, never stored,
 * and never logged: every failure is reduced by `describeFailure`, which keeps
 * the error code and redacts the password in each form it takes on the wire.
 * Nodemailer's own logger, which prints the SMTP conversation, is off.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Derived from `html` when absent. */
  text?: string;
}

export type EmailTransport = 'smtp' | 'resend';

export type SendResult =
  | { sent: true; transport: EmailTransport; messageId: string | null }
  | {
      sent: false;
      transport: EmailTransport | null;
      reason: 'not_configured' | 'invalid_message' | 'failed';
      /** A transport error code such as EAUTH. Never free text. */
      code: string | null;
    };

export interface SendOptions {
  /**
   * Use this transport or none. Login alerts and the test endpoint both mean
   * SMTP specifically, and a silent fallback to Resend would hide exactly the
   * misconfiguration they exist to reveal.
   */
  only?: EmailTransport;
}

/* ------------------------------ configuration ----------------------------- */

let readiness: SmtpReadiness | undefined;

/** `env` is a snapshot taken at boot, so this is decided once. */
const smtpReadiness = (): SmtpReadiness => (readiness ??= readSmtp(env.smtp));

function available(transport: EmailTransport): boolean {
  return transport === 'smtp' ? smtpReadiness().status === 'ready' : Boolean(env.resendApiKey);
}

export function activeTransport(): EmailTransport | null {
  if (available('smtp')) return 'smtp';
  if (available('resend')) return 'resend';
  return null;
}

/** Why SMTP is not usable, by variable name. Empty when it is. */
export function smtpProblems(): string[] {
  const r = smtpReadiness();
  if (r.status === 'incomplete') return r.problems;
  if (r.status === 'absent') return ['SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM_ADDRESS are all empty'];
  return [];
}

/** What to check for a given transport error, naming variables only. */
export function smtpHint(code: string | null): string {
  switch (code) {
    case 'EAUTH':
      return 'The server rejected the login. Check SMTP_USER and SMTP_PASS (Gmail needs an App Password, not the account password).';
    case 'ETLS':
      return 'TLS failed. Port 465 needs SMTP_SECURE=true; port 587 needs SMTP_SECURE=false.';
    case 'ETIMEDOUT':
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'EDNS':
    case 'ENOTFOUND':
    case 'ENETUNREACH':
      return 'Could not reach the server. Check SMTP_HOST, SMTP_PORT and SMTP_SECURE, and that this host may connect out on that port over IPv4.';
    case 'EENVELOPE':
      return 'The server refused the sender or the recipient. EMAIL_FROM_ADDRESS must be an address this SMTP account may send as.';
    default:
      return 'See the API log for the transport error.';
  }
}

const isLoopback = (host: string) =>
  host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);

/* -------------------------------- transports ------------------------------ */

/**
 * The SMTP host's IPv4 address.
 *
 * Nodemailer resolves a hostname itself: it asks for A **and** AAAA records,
 * concatenates them, and connects to one picked at random. It leaves IPv6 out
 * only when the machine has no IPv6 interface at all. Railway's containers have
 * one but no outbound IPv6 route, so a share of connections went to Gmail's
 * AAAA address and died with ENETUNREACH.
 *
 * None of the obvious switches reach that code. Nodemailer has no `family`
 * option; a custom `lookup` is never called, because it connects to the
 * address it resolved rather than handing the name to `net.connect`; and
 * `--dns-result-order=ipv4first` only orders `dns.lookup`, which it does not
 * use — it calls `resolve4` and `resolve6`.
 *
 * What it does honour is a host that is already an IP: it skips resolution
 * entirely. So the name is resolved here, IPv4 only. `dns.lookup` goes through
 * the OS resolver, so `localhost` and hosts-file entries keep working.
 */
async function ipv4For(host: string): Promise<string> {
  if (isIP(host) === 4) return host;
  const { address } = await lookup(host, { family: 4 });
  return address;
}

let smtpClient: { address: string; transporter: Transporter } | null = null;

/**
 * One transporter per resolved address. DNS can move the host to a different
 * address over the life of the process; when it does, the old transporter is
 * closed and a new one built, rather than connecting to a stale address.
 */
async function smtpTransporter(s: SmtpSettings): Promise<Transporter> {
  const address = await ipv4For(s.host);
  if (smtpClient?.address === address) return smtpClient.transporter;
  smtpClient?.transporter.close();

  // `servername` is a real SMTP-connection option that the type definitions
  // do not list; Nodemailer reads it for SNI and certificate checks on both the
  // implicit-TLS and the STARTTLS path.
  const options: SMTPTransport.Options & { servername?: string } = {
    host: address,
    /*
     * The certificate is issued to the hostname, not to the address. With an
     * IP as `host`, Nodemailer would otherwise send no SNI and verify the
     * certificate against the IP, and every handshake would fail. Omitted when
     * SMTP_HOST is itself an address, where there is no name to present.
     */
    ...(isIP(s.host) ? {} : { servername: s.host }),
    port: s.port,
    secure: s.secure,
    /*
     * On a plain start, STARTTLS is mandatory before AUTH. Without this a
     * server — or anything between here and it — that simply leaves STARTTLS
     * out of its EHLO reply gets the password in the clear. Loopback is exempt:
     * a local catcher such as Mailpit has no TLS, and a credential that never
     * leaves the machine cannot be read off the wire. Decided on the configured
     * name, not the resolved address.
     */
    requireTLS: !s.secure && !isLoopback(s.host),
    auth: { user: s.user, pass: s.pass },
    tls: { minVersion: 'TLSv1.2' },
    /*
     * Bounded. Nodemailer's defaults run to minutes, and a server that accepts
     * the connection and then says nothing would hold the request that sent
     * the mail open for that long.
     */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
    // Content is always a string built here. Never let a message resolve a
    // file path or fetch a URL as the source of a part.
    disableFileAccess: true,
    disableUrlAccess: true,
  };

  const transporter = nodemailer.createTransport(options);
  smtpClient = { address, transporter };
  return transporter;
}

let resendClient: Resend | null = null;
let warnedAboutSender = false;

/**
 * The `From` Resend is given.
 *
 * `EMAIL_FROM_NAME` + `EMAIL_FROM_ADDRESS` are the sender for both transports —
 * Nodemailer already takes them as a pair, and this is the string form Resend
 * wants. `EMAIL_FROM` stays as the older single-string override for a
 * deployment that still sets it, and the resend.dev default is last: it only
 * delivers to the address owning the Resend account.
 */
function resendSender(): string {
  const composed = formatSender(env.smtp.fromName || 'Velvet', env.smtp.fromAddress);
  if (composed) return composed;

  if (env.smtp.fromAddress.trim() && !warnedAboutSender) {
    warnedAboutSender = true;
    console.warn(
      'EMAIL_FROM_ADDRESS is not a single bare address (it must not include a display name); falling back to EMAIL_FROM',
    );
  }
  return env.emailFrom;
}

interface Prepared {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function viaSmtp(mail: Prepared): Promise<SendResult> {
  const r = smtpReadiness();
  if (r.status !== 'ready') return { sent: false, transport: null, reason: 'not_configured', code: null };
  const s = r.settings;

  try {
    const transporter = await smtpTransporter(s);
    const info = await transporter.sendMail({
      from: { name: s.fromName, address: s.fromAddress },
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return {
      sent: true,
      transport: 'smtp',
      messageId: typeof info.messageId === 'string' ? info.messageId : null,
    };
  } catch (err) {
    const failure = describeFailure(err, secretForms(s.user, s.pass));
    console.error(`email send failed (smtp): "${mail.subject}" → ${maskAddress(mail.to)}`, failure);
    return { sent: false, transport: 'smtp', reason: 'failed', code: failure.code };
  }
}

async function viaResend(mail: Prepared): Promise<SendResult> {
  resendClient ??= new Resend(env.resendApiKey);
  const secrets = [env.resendApiKey];

  try {
    const { data, error } = await resendClient.emails.send({
      from: resendSender(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (error) {
      console.error(`email send failed (resend): "${mail.subject}" → ${maskAddress(mail.to)}`, {
        name: error.name,
        message: redact(String(error.message ?? ''), secrets),
      });
      return { sent: false, transport: 'resend', reason: 'failed', code: null };
    }
    return { sent: true, transport: 'resend', messageId: data?.id ?? null };
  } catch (err) {
    const failure = describeFailure(err, secrets);
    console.error(`email send failed (resend): "${mail.subject}" → ${maskAddress(mail.to)}`, failure);
    return { sent: false, transport: 'resend', reason: 'failed', code: failure.code };
  }
}

/* ---------------------------------- send ---------------------------------- */

export async function sendEmail(message: EmailMessage, options: SendOptions = {}): Promise<SendResult> {
  const transport = options.only
    ? available(options.only)
      ? options.only
      : null
    : activeTransport();

  const to = normaliseRecipient(message.to);
  const subject = oneLine(String(message.subject ?? '')).slice(0, 200);

  if (!to || !subject || !message.html) {
    console.warn('email refused: a message needs exactly one valid recipient, a subject and a body');
    return { sent: false, transport, reason: 'invalid_message', code: null };
  }

  if (!transport) {
    const what = options.only === 'smtp' ? 'SMTP' : options.only === 'resend' ? 'Resend' : 'email';
    console.warn(`email skipped (${what} not configured): "${subject}" → ${maskAddress(to)}`);
    return { sent: false, transport: null, reason: 'not_configured', code: null };
  }

  const prepared: Prepared = {
    to,
    subject,
    html: message.html,
    text: message.text?.trim() || htmlToText(message.html),
  };

  return transport === 'smtp' ? viaSmtp(prepared) : viaResend(prepared);
}

/* ---------------------------------- boot ---------------------------------- */

/**
 * The startup check. Never exits: a missing mail server disables mail, not the
 * app. Filling the variables in and restarting is all it takes to switch on.
 */
export function reportEmailConfiguration(): void {
  const r = smtpReadiness();

  if (r.status === 'ready') {
    const { host, port, secure } = r.settings;
    const security = secure ? 'TLS' : isLoopback(host) ? 'plain, loopback only' : 'STARTTLS required';
    console.log(`  ✓ SMTP ready — ${host}:${port} (${security}, IPv4)`);
    for (const warning of r.warnings) console.warn(`  ⚠ ${warning}`);
    void checkSmtpConnection(r.settings);
    return;
  }

  if (env.resendApiKey) {
    console.warn('  ⚠ SMTP is not configured. Email is going through Resend; login alerts are disabled.');
  } else {
    console.warn('  ⚠ SMTP is not configured. Email functionality is disabled.');
  }
  if (r.status === 'incomplete') {
    for (const problem of r.problems) console.warn(`    · ${problem}`);
  }
}

/** Logs in once at boot, so a wrong password shows up now rather than at the first signup. */
async function checkSmtpConnection(settings: SmtpSettings): Promise<void> {
  try {
    const transporter = await smtpTransporter(settings);
    await transporter.verify();
    console.log('  ✓ SMTP accepted the connection and the credentials');
  } catch (err) {
    const failure = describeFailure(err, secretForms(settings.user, settings.pass));
    console.warn(`  ✗ SMTP check failed${failure.code ? ` (${failure.code})` : ''}: ${failure.message}`);
    console.warn(`    ${smtpHint(failure.code)}`);
  }
}
