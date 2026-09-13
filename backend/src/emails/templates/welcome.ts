import { appLink, button, C, esc, h1, layout, p, plainText, small, UI, type EmailContent } from '../layout';

/** Mood slugs are stored; these are the words a human reads. */
const MOOD_LABELS: Record<string, string> = {
  dark_intense: 'Dark & intense',
  feel_good: 'Feel good',
  mind_bending: 'Mind bending',
  epic_grand: 'Epic & grand',
  funny_light: 'Funny & light',
  romantic: 'Romantic',
};

export interface WelcomeInput {
  displayName: string;
  favouriteGenres: string[];
  favouriteMood?: string | null;
}

/** Sent once, immediately after the address is verified. */
export function welcome(opts: WelcomeInput): EmailContent {
  const genres = opts.favouriteGenres.length ? opts.favouriteGenres.join(' · ') : null;
  const mood = opts.favouriteMood ? (MOOD_LABELS[opts.favouriteMood] ?? null) : null;
  const home = appLink('/');

  // Only render the taste block when there is real taste to show. A card
  // reading "none yet" is worse than no card.
  const taste =
    genres || mood
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="margin:22px 0;background:${C.card};border:1px solid ${C.line};border-radius:4px;">
           <tr><td style="padding:18px 20px;">
             <div style="font-family:${UI};font-size:11px;font-weight:600;letter-spacing:1.6px;
                         text-transform:uppercase;color:${C.muted2};margin-bottom:10px;">Your taste</div>
             ${genres ? `<div style="font-family:${UI};font-size:15px;font-weight:300;color:${C.ink};line-height:1.6;">${esc(genres)}</div>` : ''}
             ${mood ? `<div style="font-family:${UI};font-size:14px;font-weight:300;color:${C.muted2};margin-top:6px;">Mood: ${esc(mood)}</div>` : ''}
           </td></tr>
         </table>`
      : '';

  const pitch =
    'Rate what you have seen and the advisor sharpens fast — it reads your ratings, not just your genres. Ask it anything: what to watch tonight, what to play next, why you keep loving the same three directors.';

  return {
    subject: 'Welcome to Velvet 🎬',
    html: layout({
      kind: 'account',
      preheader: 'Your Velvet is ready.',
      body: `
        ${h1(`Your Velvet is <em style="color:${C.accentLight};">ready</em>`)}
        ${p(`You are verified, ${esc(opts.displayName)}. Everything is unlocked.`)}
        ${taste}
        ${p(pitch)}
        ${button(home, 'Start discovering')}
        ${small('Films, series and games — all in one place, all rated by you.')}
      `,
    }),
    text: plainText('account', [
      'Your Velvet is ready.',
      `You are verified, ${opts.displayName}. Everything is unlocked.`,
      genres && `Your taste: ${genres}`,
      mood && `Mood: ${mood}`,
      pitch,
      `Start discovering: ${home}`,
    ]),
  };
}
