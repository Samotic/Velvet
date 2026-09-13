import { describeTtl } from '../../services/credentialTokens';
import { appLink, button, C, esc, h1, layout, p, plainText, small, type EmailContent } from '../layout';

export interface VerifyEmailInput {
  displayName: string;
  /** The raw token. Only its hash is stored — see services/credentialTokens.ts. */
  token: string;
}

/** Sent the moment a local account is created, and on every resend. */
export function verifyEmail(opts: VerifyEmailInput): EmailContent {
  const url = appLink(`/verify-email?token=${encodeURIComponent(opts.token)}`);
  const ttl = describeTtl('emailVerification');
  const pitch =
    'You are one click away. Confirm this is your address and the whole app opens up — the advisor, messages, the lot.';

  return {
    subject: 'Verify your Velvet account',
    html: layout({
      kind: 'account',
      preheader: 'One click and your Velvet account is live.',
      body: `
        ${h1(`Welcome to Velvet,<br><em style="color:${C.accentLight};">${esc(opts.displayName)}</em>`)}
        ${p(pitch)}
        ${button(url, 'Verify email')}
        ${small(`This link expires in ${ttl}. If the button does not work, paste this into your browser:<br><span style="color:${C.muted};word-break:break-all;">${esc(url)}</span>`)}
        ${small('If you did not create a Velvet account, you can ignore this email.')}
      `,
    }),
    text: plainText('account', [
      `Welcome to Velvet, ${opts.displayName}.`,
      pitch,
      `Verify your email:\n${url}`,
      `This link expires in ${ttl}.`,
      'If you did not create a Velvet account, you can ignore this email.',
    ]),
  };
}
