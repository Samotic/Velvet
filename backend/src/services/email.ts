import { Resend } from 'resend';

import { configured, env } from '../config/env';

/**
 * Transactional email, via Resend.
 *
 * One client, created lazily so the server still boots without RESEND_API_KEY —
 * every send then becomes a logged no-op rather than a crash, which keeps
 * registration working on a machine that has no mail credentials. That is the
 * same "degrade honestly" contract the catalogue and advisor services follow.
 *
 * `send` never throws. An email failing must not fail the action that triggered
 * it: a follow still lands, an account is still created, a password is still
 * reset. Delivery is best-effort and the app is usable without it.
 *
 * ── On the markup ──
 * Email clients are not browsers. Everything here is tables and inline styles,
 * because Gmail strips <style> blocks in some contexts and Outlook's engine is
 * Word. Webfonts do not load in most clients either, so the two Velvet families
 * are declared with real fallbacks that carry the same feeling: Georgia for the
 * DM Serif display voice, the system UI stack for Inter.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!configured.email()) return null;
  client ??= new Resend(env.resendApiKey);
  return client;
}

/* ------------------------------- the palette ------------------------------ */

/**
 * Mirrors the tokens in `app/globals.css`. Inlined because email has no CSS
 * vars. Keys are named for their role, so each one tracks the token of the same
 * meaning rather than the same name — `ink` is the body copy here, as it is
 * there, not the background the brief's `--v-ink` refers to.
 */
const C = {
  bg: '#07071A', // --v-ink
  raise: '#0D0E2A', // --v-surface
  card: '#181A48', // --v-raise
  accent: '#9691E0', // --v-accent
  accentLight: '#B1ADE8', // --v-accent-mid
  display: '#F0EEFA', // --v-display
  ink: '#E0DEF2', // --v-text
  muted: '#807DA1', // --v-mist
  muted2: '#9996B3', // --v-mist-2
  /* The accent is light, so anything sitting on a filled accent takes dark
     text — the same inversion the app made at --v-on-accent. */
  onAccent: '#050516', // --v-on-accent
  line: 'rgba(255,255,255,.09)',
} as const;

const SERIF = "'DM Serif Display', Georgia, 'Times New Roman', serif";
const UI =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* ------------------------------- the shell -------------------------------- */

/** Escapes a value going into email HTML. Display names are user-controlled. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * An indigo call-to-action.
 *
 * Built as a bordered table cell rather than a styled <a> so Outlook renders the
 * fill; the anchor inside carries the padding so the whole block is clickable.
 */
function button(href: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
    <tr>
      <td align="center" bgcolor="${C.accent}" style="border-radius:4px;">
        <a href="${href}"
           style="display:inline-block;padding:15px 34px;font-family:${UI};font-size:15px;
                  font-weight:600;letter-spacing:.3px;color:${C.onAccent};text-decoration:none;
                  border-radius:4px;">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** The wordmark, section rule and unsubscribe footer every email shares. */
function layout(opts: { preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Velvet</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  <!-- Preheader: the grey line clients show beside the subject. Hidden in body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${C.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:${C.raise};border:1px solid ${C.line};
                      border-radius:6px;overflow:hidden;">

          <!-- wordmark -->
          <tr>
            <td style="padding:30px 34px 0;">
              <div style="font-family:${UI};font-size:19px;font-weight:800;letter-spacing:3.5px;
                          color:${C.display};text-transform:uppercase;">VEL<span
                          style="color:${C.accent};">VET</span></div>
            </td>
          </tr>

          <!-- body -->
          <tr>
            <td style="padding:26px 34px 34px;">${opts.body}</td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:22px 34px 28px;border-top:1px solid ${C.line};">
              <p style="margin:0;font-family:${UI};font-size:12px;font-weight:300;line-height:1.7;
                        color:${C.muted};">
                You are receiving this because you have a Velvet account.<br>
                <a href="${env.frontendUrl}/settings"
                   style="color:${C.muted};text-decoration:underline;">Manage email preferences</a>
                &nbsp;·&nbsp;
                <a href="${env.frontendUrl}" style="color:${C.muted};text-decoration:underline;">Velvet</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A display heading in the indigo serif voice. */
const h1 = (text: string) =>
  `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:30px;line-height:1.2;
              font-weight:400;color:${C.display};">${text}</h1>`;

/** Body copy. */
const p = (text: string) =>
  `<p style="margin:0 0 14px;font-family:${UI};font-size:15px;font-weight:300;line-height:1.7;
             color:${C.ink};">${text}</p>`;

/** Small print. */
const small = (text: string) =>
  `<p style="margin:16px 0 0;font-family:${UI};font-size:13px;font-weight:300;line-height:1.6;
             color:${C.muted};">${text}</p>`;

/* --------------------------------- send ----------------------------------- */

interface Mail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Delivers one email. Resolves either way — see the note at the top of the file.
 * Returns whether it actually went out, which the resend-verification endpoint
 * uses to answer honestly when mail is not configured.
 */
async function send(mail: Mail): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    console.warn(`email skipped (no RESEND_API_KEY): "${mail.subject}" → ${mail.to}`);
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.emailFrom,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
    });
    if (error) {
      console.error('resend error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('email send error:', err);
    return false;
  }
}

/* ------------------------------- templates -------------------------------- */

/** A) Verify your address — sent the moment a local account is created. */
export function sendVerificationEmail(opts: {
  to: string;
  displayName: string;
  token: string;
}): Promise<boolean> {
  const url = `${env.frontendUrl}/verify-email?token=${encodeURIComponent(opts.token)}`;
  return send({
    to: opts.to,
    subject: 'Verify your Velvet account',
    html: layout({
      preheader: 'One click and your Velvet account is live.',
      body: `
        ${h1(`Welcome to Velvet,<br><em style="color:${C.accentLight};">${esc(opts.displayName)}</em>`)}
        ${p('You are one click away. Confirm this is your address and the whole app opens up — the advisor, messages, the lot.')}
        ${button(url, 'Verify email')}
        ${small(`This link expires in 24 hours. If the button does not work, paste this into your browser:<br><span style="color:${C.muted};word-break:break-all;">${url}</span>`)}
        ${small('If you did not create a Velvet account, you can ignore this email.')}
      `,
    }),
  });
}

/** B) Welcome — sent once, immediately after the address is verified. */
export function sendWelcomeEmail(opts: {
  to: string;
  displayName: string;
  favouriteGenres: string[];
  favouriteMood?: string | null;
}): Promise<boolean> {
  const genres = opts.favouriteGenres.length ? opts.favouriteGenres.join(' · ') : null;
  const mood = opts.favouriteMood ? MOOD_LABELS[opts.favouriteMood] ?? null : null;

  // Only render the taste block when there is real taste to show. A card
  // reading "none yet" is worse than no card.
  const taste =
    genres || mood
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="margin:22px 0;background:${C.card};border:1px solid ${C.line};border-radius:4px;">
           <tr><td style="padding:18px 20px;">
             <div style="font-family:${UI};font-size:11px;font-weight:600;letter-spacing:1.6px;
                         text-transform:uppercase;color:${C.muted};margin-bottom:10px;">Your taste</div>
             ${genres ? `<div style="font-family:${UI};font-size:15px;font-weight:300;color:${C.ink};line-height:1.6;">${esc(genres)}</div>` : ''}
             ${mood ? `<div style="font-family:${UI};font-size:14px;font-weight:300;color:${C.muted};margin-top:6px;">Mood: ${esc(mood)}</div>` : ''}
           </td></tr>
         </table>`
      : '';

  return send({
    to: opts.to,
    subject: 'Welcome to Velvet 🎬',
    html: layout({
      preheader: 'Your Velvet is ready.',
      body: `
        ${h1(`Your Velvet is <em style="color:${C.accentLight};">ready</em>`)}
        ${p(`You are verified, ${esc(opts.displayName)}. Everything is unlocked.`)}
        ${taste}
        ${p('Rate what you have seen and the advisor sharpens fast — it reads your ratings, not just your genres. Ask it anything: what to watch tonight, what to play next, why you keep loving the same three directors.')}
        ${button(env.frontendUrl, 'Start discovering')}
        ${small('Films, series and games — all in one place, all rated by you.')}
      `,
    }),
  });
}

/** C) Password reset. Shorter window than verification: one hour. */
export function sendPasswordResetEmail(opts: {
  to: string;
  displayName: string;
  token: string;
}): Promise<boolean> {
  const url = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(opts.token)}`;
  return send({
    to: opts.to,
    subject: 'Reset your Velvet password',
    html: layout({
      preheader: 'A link to set a new password, good for one hour.',
      body: `
        ${h1(`Reset your <em style="color:${C.accentLight};">password</em>`)}
        ${p(`Someone asked to reset the password for ${esc(opts.displayName)}. If that was you, pick a new one here.`)}
        ${button(url, 'Choose a new password')}
        ${small(`This link expires in 1 hour. If the button does not work, paste this into your browser:<br><span style="color:${C.muted};word-break:break-all;">${url}</span>`)}
        ${small(`<strong style="color:${C.muted2};">If you did not request this, ignore this email.</strong> Your password will not change until the link above is opened.`)}
      `,
    }),
  });
}

/** D) Somebody sent you a message. */
export function sendNewMessageEmail(opts: {
  to: string;
  fromName: string;
  fromUsername: string;
  preview: string;
}): Promise<boolean> {
  const url = `${env.frontendUrl}/messages`;
  // Trim hard — an email preview is a nudge, not the message.
  const preview = opts.preview.length > 180 ? `${opts.preview.slice(0, 180)}…` : opts.preview;

  return send({
    to: opts.to,
    subject: `${opts.fromName} sent you a message on Velvet`,
    html: layout({
      preheader: preview,
      body: `
        ${h1(`<em style="color:${C.accentLight};">${esc(opts.fromName)}</em> messaged you`)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin:18px 0;background:${C.card};border-left:3px solid ${C.accent};border-radius:3px;">
          <tr><td style="padding:16px 18px;">
            <div style="font-family:${UI};font-size:12px;color:${C.muted};margin-bottom:6px;">@${esc(opts.fromUsername)}</div>
            <div style="font-family:${UI};font-size:15px;font-weight:300;line-height:1.6;color:${C.ink};">${esc(preview)}</div>
          </td></tr>
        </table>
        ${button(url, 'Reply on Velvet')}
      `,
    }),
  });
}

/** E) Somebody followed you. */
export function sendNewFollowerEmail(opts: {
  to: string;
  followerName: string;
  followerUsername: string;
  followerPhoto?: string | null;
}): Promise<boolean> {
  const url = `${env.frontendUrl}/profile/${encodeURIComponent(opts.followerUsername)}`;

  // Remote images are blocked by default in most clients, so the avatar is a
  // bonus rather than the thing carrying the meaning — the name sits beside it.
  const avatar = opts.followerPhoto
    ? `<img src="${esc(opts.followerPhoto)}" width="52" height="52" alt=""
            style="display:block;width:52px;height:52px;border-radius:50%;object-fit:cover;
                   border:1px solid ${C.line};">`
    : `<div style="width:52px;height:52px;border-radius:50%;background:${C.accent};
                   font-family:${UI};font-size:21px;font-weight:600;color:${C.onAccent};
                   text-align:center;line-height:52px;">${esc(opts.followerName.charAt(0).toUpperCase())}</div>`;

  return send({
    to: opts.to,
    subject: `${opts.followerName} started following you on Velvet`,
    html: layout({
      preheader: `@${opts.followerUsername} is now following you.`,
      body: `
        ${h1(`A new <em style="color:${C.accentLight};">follower</em>`)}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
          <tr>
            <td valign="middle" style="padding-right:14px;">${avatar}</td>
            <td valign="middle">
              <div style="font-family:${UI};font-size:16px;font-weight:500;color:${C.display};">${esc(opts.followerName)}</div>
              <div style="font-family:${UI};font-size:13px;font-weight:300;color:${C.muted};margin-top:2px;">@${esc(opts.followerUsername)}</div>
            </td>
          </tr>
        </table>
        ${p('They will see your ratings and reviews in their feed.')}
        ${button(url, 'View their profile')}
      `,
    }),
  });
}

/* --------------------------------- labels --------------------------------- */

/** Mood slugs are stored; these are the words a human reads. */
const MOOD_LABELS: Record<string, string> = {
  dark_intense: 'Dark & intense',
  feel_good: 'Feel good',
  mind_bending: 'Mind bending',
  epic_grand: 'Epic & grand',
  funny_light: 'Funny & light',
  romantic: 'Romantic',
};
