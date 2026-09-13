import { env } from '../config/env';
import { currentMoment } from '../lib/ai/clock';
import { deviceLabel, type DeviceInfo } from '../utils/device';

/**
 * The shell every Velvet email is built on, and the pieces bodies are made of.
 *
 * ── On the markup ──
 * Email clients are not browsers. Everything here is tables and inline styles,
 * because Gmail strips <style> blocks in some contexts and Outlook's engine is
 * Word. Webfonts do not load in most clients either, so the two Velvet families
 * are declared with real fallbacks that carry the same feeling: Georgia for the
 * DM Serif display voice, the system UI stack for Inter.
 *
 * ── On phones ──
 * The card is fluid up to 560px, so inline styles alone already fit a narrow
 * screen. The one <style> block only refines that below 600px — tighter
 * gutters, a smaller headline, full-width buttons, fact rows stacked. A client
 * that strips it still gets a layout that works; the media query is never what
 * holds it together.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * `account` mail concerns the account itself — verification, resets, alerts.
 * `social` mail is about other people, and is the kind a preferences link is for.
 */
export type EmailKind = 'account' | 'social';

/* ------------------------------- the palette ------------------------------ */

/**
 * Mirrors the tokens in `app/globals.css`. Inlined because email has no CSS
 * vars. Keys are named for their role, so each one tracks the token of the same
 * meaning rather than the same name — `ink` is the body copy here, as it is
 * there, not the background the brief's `--v-ink` refers to.
 */
export const C = {
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

export const SERIF = "'DM Serif Display', Georgia, 'Times New Roman', serif";
export const UI =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* -------------------------------- helpers --------------------------------- */

/** Escapes a value going into email HTML. Display names are user-controlled. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A link into the frontend. `APP_URL`, falling back to `FRONTEND_URL`. */
export const appLink = (path: string): string =>
  `${env.appUrl}${path.startsWith('/') ? path : `/${path}`}`;

/** "Sunday, 13 September 2026, 01:56 (Europe/Istanbul)"; UTC when the zone is unknown. */
export const formatMoment = (at: Date, timeZone?: string | null): string =>
  currentMoment(timeZone, at);

/* ------------------------------- the shell -------------------------------- */

const FOOTER: Record<EmailKind, string> = {
  account: 'You are receiving this because it concerns your Velvet account.',
  social: 'You are receiving this because you have a Velvet account.',
};

export function layout(opts: { preheader: string; body: string; kind: EmailKind }): string {
  const preferences =
    opts.kind === 'social'
      ? `<a href="${esc(appLink('/settings'))}"
           style="color:${C.muted};text-decoration:underline;">Manage email preferences</a>
         &nbsp;·&nbsp;`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Velvet</title>
<style>
  @media only screen and (max-width: 600px) {
    .v-outer { padding: 16px 8px !important; }
    .v-pad { padding-left: 22px !important; padding-right: 22px !important; }
    .v-h1 { font-size: 25px !important; }
    .v-btn { width: 100% !important; }
    .v-btn-link { display: block !important; text-align: center !important; }
    .v-fact-label, .v-fact-value { display: block !important; width: auto !important; }
    .v-fact-label { padding-bottom: 0 !important; }
    .v-fact-value { padding-top: 2px !important; padding-left: 18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  <!-- Preheader: the grey line clients show beside the subject. Hidden in body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>

  <table role="presentation" class="v-outer" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${C.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:${C.raise};border:1px solid ${C.line};
                      border-radius:6px;overflow:hidden;">

          <!-- wordmark -->
          <tr>
            <td class="v-pad" style="padding:30px 34px 0;">
              <div style="font-family:${UI};font-size:19px;font-weight:800;letter-spacing:3.5px;
                          color:${C.display};text-transform:uppercase;">VEL<span
                          style="color:${C.accent};">VET</span></div>
            </td>
          </tr>

          <!-- body -->
          <tr>
            <td class="v-pad" style="padding:26px 34px 34px;">${opts.body}</td>
          </tr>

          <!-- footer -->
          <tr>
            <td class="v-pad" style="padding:22px 34px 28px;border-top:1px solid ${C.line};">
              <p style="margin:0;font-family:${UI};font-size:12px;font-weight:300;line-height:1.7;
                        color:${C.muted};">
                ${FOOTER[opts.kind]}<br>
                ${preferences}
                <a href="${esc(env.appUrl)}" style="color:${C.muted};text-decoration:underline;">Velvet</a>
              </p>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** The plain-text part: paragraphs split by blank lines, then the footer. Falsy entries are dropped. */
export function plainText(
  kind: EmailKind,
  paragraphs: ReadonlyArray<string | null | undefined | false>,
): string {
  const footer =
    kind === 'social'
      ? `${FOOTER.social}\nManage email preferences: ${appLink('/settings')}`
      : FOOTER.account;
  return [...paragraphs.filter(Boolean), `—\nVelvet · ${env.appUrl}\n${footer}`].join('\n\n');
}

/* --------------------------------- pieces --------------------------------- */

/** A display heading in the indigo serif voice. Takes HTML — escape names before passing them. */
export const h1 = (html: string) =>
  `<h1 class="v-h1" style="margin:0 0 14px;font-family:${SERIF};font-size:30px;line-height:1.2;
              font-weight:400;color:${C.display};">${html}</h1>`;

/** Body copy. Takes HTML. */
export const p = (html: string) =>
  `<p style="margin:0 0 14px;font-family:${UI};font-size:15px;font-weight:300;line-height:1.7;
             color:${C.ink};">${html}</p>`;

/** Small print. Takes HTML. */
export const small = (html: string) =>
  `<p style="margin:16px 0 0;font-family:${UI};font-size:13px;font-weight:300;line-height:1.6;
             color:${C.muted};">${html}</p>`;

/** Emphasis inside `p`. */
export const strong = (html: string) =>
  `<strong style="font-weight:600;color:${C.display};">${html}</strong>`;

/**
 * An indigo call-to-action.
 *
 * Built as a filled table cell rather than a styled <a> so Outlook renders the
 * fill; the anchor inside carries the padding so the whole block is clickable.
 */
export function button(href: string, label: string): string {
  return `
  <table role="presentation" class="v-btn" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
    <tr>
      <td align="center" bgcolor="${C.accent}" style="border-radius:4px;">
        <a href="${esc(href)}" class="v-btn-link"
           style="display:inline-block;padding:15px 34px;font-family:${UI};font-size:15px;
                  font-weight:600;letter-spacing:.3px;color:${C.onAccent};text-decoration:none;
                  border-radius:4px;">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** A labelled list of facts — when, which device, from where. Values are escaped. */
export function facts(rows: ReadonlyArray<readonly [string, string]>): string {
  const last = rows.length - 1;
  const cells = rows
    .map(([label, value], i) => {
      const top = i === 0 ? 16 : 5;
      const bottom = i === last ? 16 : 5;
      return `
      <tr>
        <td class="v-fact-label" valign="top" width="120"
            style="padding:${top}px 12px ${bottom}px 18px;width:120px;font-family:${UI};font-size:11px;
                   font-weight:600;letter-spacing:1.4px;text-transform:uppercase;line-height:20px;
                   color:${C.muted2};">${esc(label)}</td>
        <td class="v-fact-value" valign="top"
            style="padding:${top}px 18px ${bottom}px 0;font-family:${UI};font-size:14px;font-weight:300;
                   line-height:20px;color:${C.ink};word-break:break-word;">${esc(value)}</td>
      </tr>`;
    })
    .join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:20px 0;background:${C.card};border:1px solid ${C.line};border-radius:4px;">
    ${cells}
  </table>`;
}

export const factsText = (rows: ReadonlyArray<readonly [string, string]>): string =>
  rows.map(([label, value]) => `${label}: ${value}`).join('\n');

/** When, and from what, a security-relevant action happened. Every field but `at` is optional. */
export interface RequestContext {
  at: Date;
  /** The browser's IANA zone. Validated against Intl; UTC otherwise. */
  timeZone?: string | null;
  device?: DeviceInfo | null;
  ip?: string | null;
}

export function contextRows(ctx: RequestContext): Array<[string, string]> {
  const rows: Array<[string, string]> = [['When', formatMoment(ctx.at, ctx.timeZone)]];
  if (ctx.device) rows.push(['Device', deviceLabel(ctx.device)]);
  if (ctx.ip) rows.push(['IP address', ctx.ip]);
  return rows;
}
