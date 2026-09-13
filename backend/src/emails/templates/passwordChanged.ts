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

export interface PasswordChangedInput extends RequestContext {
  displayName: string;
  /**
   * Whether the change also ended every other session. A reset does (it bumps
   * `tokenVersion`); only claim it when the caller knows it is true.
   */
  sessionsEnded?: boolean;
}

/** Confirmation after a password is changed — so a change nobody asked for is noticed at once. */
export function passwordChanged(opts: PasswordChangedInput): EmailContent {
  const rows = contextRows(opts);
  const resetUrl = appLink('/forgot-password');
  const summary = `The password for ${opts.displayName}'s Velvet account was just changed.${
    opts.sessionsEnded ? ' Every device that was signed in has been signed out.' : ''
  }`;
  const notYou =
    "If this wasn't you, reset your password now. The link goes only to this address, so whoever changed it cannot follow it.";

  return {
    subject: 'Your Velvet password was changed',
    html: layout({
      kind: 'account',
      preheader: 'Your password was just changed.',
      body: `
        ${h1(`Your password was <em style="color:${C.accentLight};">changed</em>`)}
        ${p(esc(summary))}
        ${facts(rows)}
        ${p(strong('If this was you, no action is required.'))}
        ${p(esc(notYou))}
        ${button(resetUrl, 'Reset your password')}
        ${small('Velvet will never email you a password, and will never ask for one.')}
      `,
    }),
    text: plainText('account', [
      'Your Velvet password was changed',
      summary,
      factsText(rows),
      'If this was you, no action is required.',
      `${notYou}\nReset your password: ${resetUrl}`,
      'Velvet will never email you a password, and will never ask for one.',
    ]),
  };
}
