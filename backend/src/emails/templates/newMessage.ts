import { appLink, button, C, esc, h1, layout, plainText, UI, type EmailContent } from '../layout';

export interface NewMessageInput {
  fromName: string;
  fromUsername: string;
  preview: string;
}

/** Somebody sent you a message. */
export function newMessage(opts: NewMessageInput): EmailContent {
  const url = appLink('/messages');
  // Trim hard — an email preview is a nudge, not the message.
  const preview = opts.preview.length > 180 ? `${opts.preview.slice(0, 180)}…` : opts.preview;

  return {
    subject: `${opts.fromName} sent you a message on Velvet`,
    html: layout({
      kind: 'social',
      preheader: preview,
      body: `
        ${h1(`<em style="color:${C.accentLight};">${esc(opts.fromName)}</em> messaged you`)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin:18px 0;background:${C.card};border-left:3px solid ${C.accent};border-radius:3px;">
          <tr><td style="padding:16px 18px;">
            <div style="font-family:${UI};font-size:12px;color:${C.muted2};margin-bottom:6px;">@${esc(opts.fromUsername)}</div>
            <div style="font-family:${UI};font-size:15px;font-weight:300;line-height:1.6;color:${C.ink};">${esc(preview)}</div>
          </td></tr>
        </table>
        ${button(url, 'Reply on Velvet')}
      `,
    }),
    text: plainText('social', [
      `${opts.fromName} (@${opts.fromUsername}) messaged you:`,
      preview,
      `Reply on Velvet: ${url}`,
    ]),
  };
}
