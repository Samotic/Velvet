import { describeTtl } from '../../services/credentialTokens';
import { appLink, button, C, esc, h1, layout, p, plainText, small, strong, type EmailContent } from '../layout';

export interface ResetPasswordInput {
  displayName: string;
  /** The raw token. Only its hash is stored — see services/credentialTokens.ts. */
  token: string;
}

/** A link to set a new password. Never the password itself — Velvet cannot know it. */
export function resetPassword(opts: ResetPasswordInput): EmailContent {
  const url = appLink(`/reset-password?token=${encodeURIComponent(opts.token)}`);
  const ttl = describeTtl('passwordReset');

  return {
    subject: 'Reset your Velvet password',
    html: layout({
      kind: 'account',
      preheader: `A link to set a new password, good for ${ttl}.`,
      body: `
        ${h1(`Reset your <em style="color:${C.accentLight};">password</em>`)}
        ${p(`Someone asked to reset the password for ${esc(opts.displayName)}. If that was you, pick a new one here.`)}
        ${button(url, 'Choose a new password')}
        ${small(`This link expires in ${ttl} and works once. If the button does not work, paste this into your browser:<br><span style="color:${C.muted};word-break:break-all;">${esc(url)}</span>`)}
        ${small(`${strong('If you did not request this, ignore this email.')} Your password will not change until the link above is opened.`)}
        ${small('Velvet will never email you a password, and will never ask for one.')}
      `,
    }),
    text: plainText('account', [
      'Reset your Velvet password',
      `Someone asked to reset the password for ${opts.displayName}. If that was you, pick a new one here:\n${url}`,
      `This link expires in ${ttl} and works once.`,
      'If you did not request this, ignore this email. Your password will not change until the link above is opened.',
      'Velvet will never email you a password, and will never ask for one.',
    ]),
  };
}
