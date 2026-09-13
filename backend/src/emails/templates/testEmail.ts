import { C, esc, formatMoment, h1, layout, p, plainText, small, type EmailContent } from '../layout';

/** What POST /api/email/test sends. Development only. */
export function testEmail(opts: { displayName: string; at: Date }): EmailContent {
  const when = formatMoment(opts.at);
  const body = `This test was requested by ${opts.displayName} from a development Velvet API at ${when}. If it reached you, Velvet can send email.`;

  return {
    subject: 'Velvet SMTP test',
    html: layout({
      kind: 'account',
      preheader: 'If you can read this, SMTP is working.',
      body: `
        ${h1(`SMTP is <em style="color:${C.accentLight};">working</em>`)}
        ${p(esc(body))}
        ${small('Sent by POST /api/email/test, which exists only when NODE_ENV is development.')}
      `,
    }),
    text: plainText('account', [
      'SMTP is working',
      body,
      'Sent by POST /api/email/test, which exists only when NODE_ENV is development.',
    ]),
  };
}
