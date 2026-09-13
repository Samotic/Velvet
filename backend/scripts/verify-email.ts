/**
 * End-to-end check of outgoing email: the SMTP transport, login alerts, the
 * development test endpoint, and that no credential leaks along the way.
 *
 * Runs the real app against an in-memory MongoDB and a fake SMTP server on
 * 127.0.0.1 — enough of the protocol (EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT,
 * DATA) for Nodemailer to deliver to it. Nothing reaches a real mail server.
 *
 * Two child runs cover what one process cannot, because `env.ts` snapshots
 * NODE_ENV and the SMTP variables when first imported: a production boot, where
 * the test endpoint must not exist, and a development boot with SMTP empty,
 * where login must still work and nothing is sent.
 *
 *   npm run verify:email        (from backend/)
 */
import './testEnv';

import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';

import { secretForms } from '../src/services/emailMessage';

const SMTP_USER = 'velvet-verify';
const SMTP_PASS = 'Verify-Smtp-Pa55word';
const APP_URL = 'https://app.velvet.test';
const FROM = 'noreply@velvet.test';
const LOGIN_SUBJECT = 'New login to your Velvet account';
const TEST_SUBJECT = 'Velvet SMTP test';
const UA_CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/* --------------------------------- output --------------------------------- */

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}

const section = (title: string) => console.log(`\n${title}`);

/** Everything the app writes to the console, so it can be searched for leaks. */
const logs: string[] = [];

function captureConsole() {
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4 }))).join(' '));
      original(...args);
    };
  }
}

async function waitFor(predicate: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) return false;
    await delay(40);
  }
  return true;
}

/* ------------------------------- fake SMTP -------------------------------- */

interface Received {
  raw: string;
  headers: string;
  subject: string;
  text: string;
  html: string;
  rcpt: string[];
  authUser: string | null;
}

const b64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

function quotedPrintable(s: string): string {
  const src = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const hex = src.slice(i + 1, i + 3);
    if (src[i] === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(src[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeMime(raw: string): Omit<Received, 'rcpt' | 'authUser'> {
  const split = raw.indexOf('\r\n\r\n');
  const headers = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ');
  const body = raw.slice(split + 4);

  const subjectRaw = /^Subject: (.*)$/im.exec(headers)?.[1] ?? '';
  const subject = subjectRaw
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?utf-8\?([QB])\?([^?]*)\?=/gi, (_m, enc: string, data: string) =>
      enc.toUpperCase() === 'B' ? b64(data) : quotedPrintable(data.replace(/_/g, ' ')),
    );

  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];
  const parts = boundary ? body.split(`--${boundary}`).slice(1, -1) : [`${headers}\r\n\r\n${body}`];

  let text = '';
  let html = '';
  for (const part of parts) {
    const at = part.indexOf('\r\n\r\n');
    const partHeaders = part.slice(0, at).replace(/\r\n[ \t]+/g, ' ');
    const partBody = part.slice(at + 4).replace(/\r\n$/, '');
    const encoding = /content-transfer-encoding:\s*([\w-]+)/i.exec(partHeaders)?.[1]?.toLowerCase();
    const decoded =
      encoding === 'quoted-printable'
        ? quotedPrintable(partBody)
        : encoding === 'base64'
          ? b64(partBody.replace(/\s+/g, ''))
          : partBody;
    if (/content-type:\s*text\/plain/i.test(partHeaders)) text = decoded;
    else if (/content-type:\s*text\/html/i.test(partHeaders)) html = decoded;
  }

  return { raw, headers, subject, text, html };
}

class FakeSmtp {
  readonly messages: Received[] = [];
  /** ok: accept · reject-auth: 535 every login · silent: accept the socket, never greet. */
  mode: 'ok' | 'reject-auth' | 'silent' = 'ok';
  port = 0;
  private readonly sockets = new Set<net.Socket>();
  private readonly server = net.createServer((socket) => this.handle(socket));

  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  count(subject: string) {
    return this.messages.filter((m) => m.subject.includes(subject)).length;
  }

  last(subject: string) {
    return this.messages.filter((m) => m.subject.includes(subject)).at(-1);
  }

  private handle(socket: net.Socket) {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
    if (this.mode === 'silent') return;

    socket.setEncoding('utf8');
    const reply = (line: string) => socket.write(`${line}\r\n`);

    let buffer = '';
    let inData = false;
    let step: null | 'plain' | 'login-user' | 'login-pass' = null;
    let loginUser = '';
    let rcpt: string[] = [];
    let authUser: string | null = null;

    const authenticate = (user: string, pass: string) => {
      if (this.mode === 'reject-auth' || user !== SMTP_USER || pass !== SMTP_PASS) {
        reply('535 5.7.8 Authentication credentials invalid');
      } else {
        authUser = user;
        reply('235 2.7.0 Authentication successful');
      }
    };
    const plain = (arg: string) => {
      const [, user = '', pass = ''] = b64(arg).split('\x00');
      authenticate(user, pass);
    };

    reply('220 fake.velvet.test ESMTP');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          const raw = buffer.slice(0, end).replace(/^\.\./gm, '.');
          buffer = buffer.slice(end + 5);
          inData = false;
          this.messages.push({ ...decodeMime(raw), rcpt, authUser });
          rcpt = [];
          reply('250 2.0.0 Queued');
          continue;
        }

        const nl = buffer.indexOf('\r\n');
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);

        if (step === 'plain') {
          step = null;
          plain(line);
          continue;
        }
        if (step === 'login-user') {
          loginUser = b64(line);
          step = 'login-pass';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (step === 'login-pass') {
          step = null;
          authenticate(loginUser, b64(line));
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') {
          reply('250-fake.velvet.test');
          reply('250-AUTH PLAIN LOGIN');
          reply('250 8BITMIME');
        } else if (/^AUTH PLAIN/i.test(line)) {
          const arg = line.slice(10).trim();
          if (arg) plain(arg);
          else {
            step = 'plain';
            reply('334 ');
          }
        } else if (/^AUTH LOGIN/i.test(line)) {
          const arg = line.slice(10).trim();
          if (arg) {
            loginUser = b64(arg);
            step = 'login-pass';
            reply('334 UGFzc3dvcmQ6');
          } else {
            step = 'login-user';
            reply('334 VXNlcm5hbWU6');
          }
        } else if (verb === 'MAIL') reply('250 2.1.0 OK');
        else if (verb === 'RCPT') {
          rcpt.push(line);
          reply('250 2.1.5 OK');
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (verb === 'RSET') {
          rcpt = [];
          reply('250 OK');
        } else if (verb === 'NOOP') reply('250 OK');
        else if (verb === 'QUIT') {
          reply('221 Bye');
          socket.end();
          return;
        } else reply('502 5.5.2 Command not implemented');
      }
    });
  }
}

/* --------------------------------- children ------------------------------- */

interface ChildRun {
  result: Record<string, unknown> | null;
  output: string;
}

async function runChild(mode: string, extra: Record<string, string>): Promise<ChildRun> {
  const child = spawn(process.execPath, ['--import', 'tsx', process.argv[1]], {
    env: { ...process.env, ...extra, VERIFY_EMAIL_MODE: mode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (output += c));
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  const line = output.split(/\r?\n/).find((l) => l.startsWith('RESULT '));
  return { result: line ? JSON.parse(line.slice(7)) : null, output: `${output}\n(exit ${code})` };
}

async function productionChild(): Promise<void> {
  process.env.NODE_ENV = 'production';
  const { default: request } = await import('supertest');
  const { createApp } = await import('../src/app.js');
  const res = await request(createApp()).post('/api/email/test').send({});
  process.stdout.write(`RESULT ${JSON.stringify({ status: res.status })}\n`);
  process.exit(0);
}

async function unconfiguredChild(): Promise<void> {
  captureConsole();
  process.env.NODE_ENV = 'development';

  const { default: request } = await import('supertest');
  const { createApp } = await import('../src/app.js');
  const { connectDb, disconnectDb } = await import('../src/lib/db.js');
  const { User } = await import('../src/models/User.js');
  const { reportEmailConfiguration } = await import('../src/services/emailService.js');

  reportEmailConfiguration();
  await connectDb(process.env.VERIFY_MONGO_URI ?? '');
  const app = createApp();

  const email = 'bare@velvet.test';
  const password = 'bare-password-123';
  await request(app).post('/api/auth/register').send({ email, password });
  await User.updateOne({ email }, { $set: { emailVerified: true } });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  const test = await request(app)
    .post('/api/email/test')
    .set('Authorization', `Bearer ${login.body?.data?.token}`)
    .send({});
  await delay(800);

  const result = {
    warned: logs.some((l) => l.includes('SMTP is not configured. Email functionality is disabled.')),
    login: login.status,
    alertAttempted: logs.some((l) => l.includes(LOGIN_SUBJECT)),
    test: test.status,
    testError: test.body?.error ?? null,
  };
  await disconnectDb();
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  process.exit(0);
}

/* ---------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  const mode = process.env.VERIFY_EMAIL_MODE;
  if (mode === 'production') return productionChild();
  if (mode === 'unconfigured') return unconfiguredChild();

  captureConsole();

  const smtp = new FakeSmtp();
  await smtp.start();

  Object.assign(process.env, {
    NODE_ENV: 'development',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: 'false',
    SMTP_USER,
    SMTP_PASS,
    EMAIL_FROM_NAME: 'Velvet',
    EMAIL_FROM_ADDRESS: FROM,
    APP_URL,
  });

  // Dynamic, so env.ts snapshots the values above rather than the blanks.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const { default: request } = await import('supertest');
  const { createApp } = await import('../src/app.js');
  const { configured } = await import('../src/config/env.js');
  const { connectDb, disconnectDb } = await import('../src/lib/db.js');
  const { User } = await import('../src/models/User.js');
  const { hashCredentialToken } = await import('../src/services/credentialTokens.js');
  const { reportEmailConfiguration } = await import('../src/services/emailService.js');

  const mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  const app = createApp();

  const bodies: string[] = [];
  const keep = <T extends { body: unknown }>(res: T): T => {
    bodies.push(JSON.stringify(res.body ?? {}));
    return res;
  };
  const login = async (email: string, password: string, extra: { ua?: string; timeZone?: string } = {}) => {
    let req = request(app).post('/api/auth/login');
    if (extra.ua) req = req.set('User-Agent', extra.ua);
    return keep(await req.send({ email, password, ...(extra.timeZone ? { timeZone: extra.timeZone } : {}) }));
  };
  const failureLogs = () => logs.filter((l) => l.includes('email send failed (smtp)')).length;

  const ADA = 'ada@velvet.test';
  const PASSWORD = 'correct-horse-battery-9';

  section('BOOT');
  {
    reportEmailConfiguration();
    check('SMTP reads as configured', configured.smtp());
    check('boot report names the server', logs.some((l) => l.includes(`SMTP ready — 127.0.0.1:${smtp.port}`)));
    check(
      'boot check logs in to the server',
      await waitFor(() => logs.some((l) => l.includes('SMTP accepted the connection and the credentials'))),
    );
  }

  section('REGISTRATION — a verification email over SMTP');
  let rawToken = '';
  {
    const reg = keep(await request(app).post('/api/auth/register').send({ email: ADA, password: PASSWORD }));
    check('register → 201', reg.status === 201, `got ${reg.status}`);
    check('verification email delivered', await waitFor(() => smtp.count('Verify your Velvet account') === 1));

    const m = smtp.last('Verify your Velvet account');
    check('the server saw SMTP_USER authenticate', m?.authUser === SMTP_USER);
    check('addressed to the new account', m?.rcpt.some((r) => r.includes(ADA)) ?? false);
    check('From is EMAIL_FROM_NAME <EMAIL_FROM_ADDRESS>', /^From: Velvet <noreply@velvet\.test>$/im.test(m?.headers ?? ''));
    check('has a plain-text part and an HTML part', Boolean(m?.text) && Boolean(m?.html.includes('<table')));
    check('the HTML carries the mobile media query', m?.html.includes('max-width: 600px') ?? false);

    const link = /https:\/\/app\.velvet\.test\/verify-email\?token=([0-9a-f]{64})\b/.exec(m?.text ?? '');
    check('link points at APP_URL and carries a 64-hex token', Boolean(link));
    rawToken = link?.[1] ?? '';

    const stored = await User.findOne({ email: ADA })
      .select('+emailVerificationToken +emailVerificationExpires')
      .lean();
    check(
      'only the token’s SHA-256 is stored, never the token',
      Boolean(rawToken) && stored?.emailVerificationToken === hashCredentialToken(rawToken),
    );
    const ttl = (stored?.emailVerificationExpires?.getTime() ?? 0) - Date.now();
    check('the token expires in 24 hours', Math.abs(ttl - 24 * 60 * 60 * 1000) < 60_000, `${ttl}ms`);
  }

  section('LOGIN ALERTS');
  let session = '';
  {
    const r = await login(ADA, PASSWORD);
    check('unverified account: login → 200', r.status === 200, `got ${r.status}`);
    await delay(1200);
    check('unverified address: no login alert', smtp.count(LOGIN_SUBJECT) === 0);
  }
  {
    const r = keep(await request(app).post('/api/auth/verify-email').send({ token: rawToken }));
    check('verification link accepted → 200', r.status === 200, `got ${r.status}`);
    const again = keep(await request(app).post('/api/auth/verify-email').send({ token: rawToken }));
    check('the same link a second time → 400', again.status === 400, `got ${again.status}`);
  }
  {
    const r = await login(ADA, PASSWORD, { ua: UA_CHROME_WINDOWS, timeZone: 'Europe/Istanbul' });
    check('verified account: login → 200', r.status === 200, `got ${r.status}`);
    session = r.body?.data?.token ?? '';
    check('login alert delivered', await waitFor(() => smtp.count(LOGIN_SUBJECT) === 1));

    const m = smtp.last(LOGIN_SUBJECT);
    const text = m?.text ?? '';
    const everything = `${m?.raw ?? ''}\n${text}\n${m?.html ?? ''}`;
    check('subject is "New login to your Velvet account"', m?.subject === LOGIN_SUBJECT, m?.subject);
    check('sent to the registered address', m?.rcpt.some((x) => x.includes(ADA)) ?? false);
    check('"If this was you, no action is required."', text.includes('If this was you, no action is required.'));
    check(
      '"If this wasn\'t you, change your password immediately."',
      text.includes("If this wasn't you, change your password immediately."),
    );
    check('time stated in the browser’s zone', text.includes('(Europe/Istanbul)'));
    check('device named from fixed labels', text.includes('Device: Chrome on Windows'));
    check('the raw User-Agent is not echoed', !everything.includes('AppleWebKit') && !everything.includes('Win64'));
    check('IP address included', text.includes('IP address: 127.0.0.1'), text);
    check('points at the reset flow on APP_URL', text.includes(`${APP_URL}/forgot-password`));
    check('contains neither the password nor the session JWT', Boolean(session) && !everything.includes(PASSWORD) && !everything.includes(session));
  }
  {
    const before = smtp.count(LOGIN_SUBJECT);
    const r = await login(ADA, 'wrong-password-1');
    check('wrong password → 401', r.status === 401, `got ${r.status}`);
    await delay(1200);
    check('…and no login alert', smtp.count(LOGIN_SUBJECT) === before);
  }
  {
    const before = smtp.count(LOGIN_SUBJECT);
    const r = await login(ADA, PASSWORD, { timeZone: 'Mars/Olympus' });
    check('unknown time zone: login → 200', r.status === 200, `got ${r.status}`);
    check('…alert falls back to UTC', await waitFor(() => smtp.count(LOGIN_SUBJECT) === before + 1) && Boolean(smtp.last(LOGIN_SUBJECT)?.text.includes('(UTC)')));
  }

  section('POST /api/email/test — development');
  {
    const before = smtp.count(TEST_SUBJECT);
    const anon = keep(await request(app).post('/api/email/test').send({}));
    check('signed out → 401', anon.status === 401, `got ${anon.status}`);

    const authed = () => request(app).post('/api/email/test').set('Authorization', `Bearer ${session}`);
    const own = keep(await authed().send({}));
    check('signed in → 200', own.status === 200, `got ${own.status} ${JSON.stringify(own.body)}`);
    check('reports the SMTP transport', own.body?.data?.transport === 'smtp');
    check(
      'delivered to your own address by default',
      smtp.count(TEST_SUBJECT) === before + 1 && (smtp.last(TEST_SUBJECT)?.rcpt.some((x) => x.includes(ADA)) ?? false),
    );

    const other = keep(await authed().send({ to: 'someone@velvet.test' }));
    check(
      'an explicit "to" → 200, delivered there',
      other.status === 200 && (smtp.last(TEST_SUBJECT)?.rcpt.some((x) => x.includes('someone@velvet.test')) ?? false),
    );
    check('two addresses in "to" → 422', keep(await authed().send({ to: 'a@velvet.test, b@velvet.test' })).status === 422);
    check('a header smuggled into "to" → 422', keep(await authed().send({ to: 'a@velvet.test\r\nBcc: b@velvet.test' })).status === 422);

    smtp.mode = 'reject-auth';
    const refused = keep(await authed().send({}));
    smtp.mode = 'ok';
    check('SMTP refuses the login → 502', refused.status === 502, `got ${refused.status}`);
    check('…naming the error code', String(refused.body?.error ?? '').includes('EAUTH'), refused.body?.error);
  }

  section('A FAILING MAIL SERVER NEVER FAILS A LOGIN');
  {
    const before = failureLogs();
    smtp.mode = 'reject-auth';
    const r = await login(ADA, PASSWORD);
    check('credentials rejected: login → 200', r.status === 200, `got ${r.status}`);
    check('…and the failure is logged with its code', await waitFor(() => failureLogs() > before && logs.some((l) => l.includes('EAUTH'))));
  }
  {
    const before = failureLogs();
    smtp.mode = 'silent';
    const started = Date.now();
    const r = await login(ADA, PASSWORD);
    const took = Date.now() - started;
    check('server that never answers: login → 200', r.status === 200, `got ${r.status}`);
    check('…without waiting on it', took < 3000, `${took}ms`);
    check(
      '…and the hung connection is cut off by the timeout',
      await waitFor(() => failureLogs() > before && logs.some((l) => l.includes('ETIMEDOUT')), 20_000),
    );
  }
  {
    smtp.mode = 'ok';
    await smtp.stop();
    const before = failureLogs();
    const r = await login(ADA, PASSWORD);
    check('server gone: login → 200', r.status === 200, `got ${r.status}`);
    check('…and the refusal is logged', await waitFor(() => failureLogs() > before, 15_000));
  }

  section('NO CREDENTIAL LEAKS');
  {
    const forms = secretForms(SMTP_USER, SMTP_PASS);
    const leaks = (haystack: string) => forms.some((f) => haystack.includes(f));
    check('no API response contains SMTP_PASS, in any encoding', !bodies.some(leaks));
    check('no log line contains SMTP_PASS, in any encoding', !logs.some(leaks));
    check('no delivered email contains SMTP_PASS', !smtp.messages.some((m) => leaks(m.raw)));
  }

  section('PRODUCTION — the test endpoint does not exist');
  {
    const prod = await runChild('production', {});
    check('POST /api/email/test → 404', prod.result?.status === 404, prod.result ? `got ${prod.result.status}` : prod.output.slice(-800));
  }

  section('SMTP NOT CONFIGURED — email off, sign-in unaffected');
  {
    const bare = await runChild('unconfigured', { VERIFY_MONGO_URI: mongo.getUri() });
    const r = bare.result;
    if (!r) console.log(bare.output.slice(-1500));
    check('boot warns "SMTP is not configured. Email functionality is disabled."', r?.warned === true);
    check('login → 200', r?.login === 200, `got ${r?.login}`);
    check('no login alert attempted', r?.alertAttempted === false);
    check('POST /api/email/test → 503', r?.test === 503, `got ${r?.test}`);
    const testError = r?.testError;
    check('…naming the missing variables', typeof testError === 'string' && testError.includes('SMTP_HOST'), String(testError));
  }

  await disconnectDb();
  await mongo.stop();

  console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nverify-email crashed:', err);
  process.exit(1);
});
