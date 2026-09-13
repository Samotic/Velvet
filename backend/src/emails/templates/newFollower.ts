import { appLink, button, C, esc, h1, layout, p, plainText, UI, type EmailContent } from '../layout';

export interface NewFollowerInput {
  followerName: string;
  followerUsername: string;
  followerPhoto?: string | null;
}

/** Somebody followed you. */
export function newFollower(opts: NewFollowerInput): EmailContent {
  const url = appLink(`/profile/${encodeURIComponent(opts.followerUsername)}`);

  // Remote images are blocked by default in most clients, so the avatar is a
  // bonus rather than the thing carrying the meaning — the name sits beside it.
  const avatar = opts.followerPhoto
    ? `<img src="${esc(opts.followerPhoto)}" width="52" height="52" alt=""
            style="display:block;width:52px;height:52px;border-radius:50%;object-fit:cover;
                   border:1px solid ${C.line};">`
    : `<div style="width:52px;height:52px;border-radius:50%;background:${C.accent};
                   font-family:${UI};font-size:21px;font-weight:600;color:${C.onAccent};
                   text-align:center;line-height:52px;">${esc(opts.followerName.charAt(0).toUpperCase())}</div>`;

  return {
    subject: `${opts.followerName} started following you on Velvet`,
    html: layout({
      kind: 'social',
      preheader: `@${opts.followerUsername} is now following you.`,
      body: `
        ${h1(`A new <em style="color:${C.accentLight};">follower</em>`)}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
          <tr>
            <td valign="middle" style="padding-right:14px;">${avatar}</td>
            <td valign="middle">
              <div style="font-family:${UI};font-size:16px;font-weight:500;color:${C.display};">${esc(opts.followerName)}</div>
              <div style="font-family:${UI};font-size:13px;font-weight:300;color:${C.muted2};margin-top:2px;">@${esc(opts.followerUsername)}</div>
            </td>
          </tr>
        </table>
        ${p('They will see your ratings and reviews in their feed.')}
        ${button(url, 'View their profile')}
      `,
    }),
    text: plainText('social', [
      `${opts.followerName} (@${opts.followerUsername}) started following you on Velvet.`,
      'They will see your ratings and reviews in their feed.',
      `View their profile: ${url}`,
    ]),
  };
}
