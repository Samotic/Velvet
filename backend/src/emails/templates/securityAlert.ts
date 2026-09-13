import {
  appLink,
  button,
  C,
  contextRows,
  esc,
  facts,
  factsText,
  h1,
  layout,
  p,
  plainText,
  small,
  strong,
  type EmailContent,
  type RequestContext,
} from '../layout';

export interface SecurityAlertInput extends RequestContext {
  displayName: string;
  /** Short plain text, e.g. "Your email address was changed". Escaped; never HTML. */
  headline: string;
  /** One or two plain-text sentences on what happened. */
  summary: string;
  /**
   * What to do about it. `path` must be a path inside the app: anything else —
   * an absolute URL, `//host` — is replaced with Settings, so an alert can never
   * be made to carry a link off-site.
   */
  action?: { label: string; path: string } | null;
}

/** A general-purpose security notice, for events that have no dedicated template. */
export function securityAlert(opts: SecurityAlertInput): EmailContent {
  const headline = opts.headline.replace(/[\r\n]+/g, ' ').trim();
  const rows = contextRows(opts);
  const action =
    opts.action && /^\/(?![/\\])/.test(opts.action.path)
      ? { label: opts.action.label, href: appLink(opts.action.path) }
      : { label: 'Review your account', href: appLink('/settings') };
  const notYou =
    "If you don't recognise this, reset your password — that signs out every device using your account.";

  return {
    subject: `Security alert: ${headline}`,
    html: layout({
      kind: 'account',
      preheader: headline,
      body: `
        ${h1(`Security <em style="color:${C.accentLight};">alert</em>`)}
        ${p(`Hi ${esc(opts.displayName)}, ${strong(esc(headline))}.`)}
        ${p(esc(opts.summary))}
        ${facts(rows)}
        ${p(esc(notYou))}
        ${button(action.href, action.label)}
        ${small(`Reset your password: <a href="${esc(appLink('/forgot-password'))}" style="color:${C.muted2};">${esc(appLink('/forgot-password'))}</a>`)}
        ${small('Velvet will never ask for your password by email.')}
      `,
    }),
    text: plainText('account', [
      `Security alert: ${headline}`,
      `Hi ${opts.displayName}, ${headline}.`,
      opts.summary,
      factsText(rows),
      `${notYou}\nReset your password: ${appLink('/forgot-password')}`,
      `${action.label}: ${action.href}`,
      'Velvet will never ask for your password by email.',
    ]),
  };
}
