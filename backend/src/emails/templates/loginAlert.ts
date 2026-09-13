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

export interface LoginAlertInput extends RequestContext {
  displayName: string;
  /** How they signed in. It decides what "if this wasn't you" can honestly tell them to do. */
  method: 'password' | 'google';
}

const GOOGLE_SECURITY = 'https://myaccount.google.com/security';

/**
 * "New login to your Velvet account" — after every successful sign-in.
 *
 * Says when, roughly on what, and from where. Never the password, the session
 * token or a link that signs anyone in: the one action it offers leads to a
 * flow that has to prove ownership of this inbox first.
 */
export function loginAlert(opts: LoginAlertInput): EmailContent {
  const rows = contextRows(opts);
  const google = opts.method === 'google';

  const opening = `Hi ${opts.displayName}, someone just signed in to your Velvet account${google ? ' with Google' : ''}.`;
  const notYou = google
    ? "If this wasn't you, change your Google account password immediately — anyone who can sign in to that Google account can sign in to Velvet."
    : "If this wasn't you, change your password immediately.";
  const action = google
    ? { href: GOOGLE_SECURITY, label: 'Secure your Google account' }
    : { href: appLink('/forgot-password'), label: 'Change your password' };
  const aftercare = google
    ? 'Then sign out of Velvet on any device: signing out ends every session on your account, including theirs.'
    : 'Changing it through that link signs out every device using your account, including whoever just signed in.';

  return {
    subject: 'New login to your Velvet account',
    html: layout({
      kind: 'account',
      preheader: rows
        .slice(0, 2)
        .map(([, value]) => value)
        .join(' · '),
      body: `
        ${h1(`New login to your <em style="color:${C.accentLight};">Velvet account</em>`)}
        ${p(esc(opening))}
        ${facts(rows)}
        ${p(strong('If this was you, no action is required.'))}
        ${p(esc(notYou))}
        ${button(action.href, action.label)}
        ${small(esc(aftercare))}
        ${small('Velvet will never ask for your password by email.')}
      `,
    }),
    text: plainText('account', [
      'New login to your Velvet account',
      opening,
      factsText(rows),
      'If this was you, no action is required.',
      `${notYou}\n${action.label}: ${action.href}`,
      aftercare,
      'Velvet will never ask for your password by email.',
    ]),
  };
}
