/**
 * The advisor's own logic: what it knows about the user, how it is asked, and
 * what is pulled back out of the reply.
 *
 * None of this is provider-specific, which is the point — it lived inside the
 * Claude service before and would have had to be duplicated the moment a second
 * provider existed. Prompt changes belong here, transport belongs in the
 * provider modules.
 */

import { currentMoment } from './clock';

/** Everything the system prompt interpolates about the person asking. */
export interface TasteProfile {
  displayName: string;
  age?: number;
  gender?: string;
  /** Declared at onboarding — what they *say* they like. */
  favouriteGenres: string[];
  favouriteMood?: string;
  watchHistoryCount: number;
  avgRating: number | null;
  recentWatches: string[];
  /** Their best, with scores. "Top rated" means little without the number. */
  loved?: { title: string; rating: number; type: string }[];
  /** What they disliked. The half the advisor never had. */
  disliked?: { title: string; rating: number; type: string }[];
  /** Observed genre counts from actual ratings, not the declared list. */
  observedGenres?: { genre: string; count: number }[];
  /** How their attention actually splits across the three catalogues. */
  typeMix?: { movie: number; series: number; game: number };
  /** Agreed to watch and hasn't. */
  watchlist?: string[];
  /** Part-way through right now. */
  inProgress?: { title: string; percent: number }[];
}

export interface AdvisorTurn {
  role: 'user' | 'assistant';
  content: string;
}

const none = (v: string) => v || 'not shared';
const list = (v: string[]) => (v.length ? v.join(', ') : 'none yet');

/** `Parasite (5/5)`, so a title carries the verdict that makes it useful. */
const withScores = (rows: { title: string; rating: number }[]) =>
  rows.map((r) => `${r.title} (${r.rating}/5)`).join(', ');

/**
 * The behavioural half of the profile, and the instructions for using it.
 *
 * Every line is omitted when empty rather than printed as "none yet". A new
 * account has no dislikes and no watchlist, and an absent line reads as "no
 * data"; a present-but-empty one invites the model to remark on the absence,
 * which is not a conversation anybody wants to have with a recommender.
 *
 * The instructions matter as much as the data. A model handed a list of
 * dislikes will happily recommend something adjacent to it unless told plainly
 * what the list is for, and one handed a watchlist will present items on it as
 * fresh discoveries — which is how an advisor loses the user's trust fastest,
 * because they know perfectly well they already saved it.
 */
function signals(p: TasteProfile): string {
  const lines: string[] = [];

  if (p.loved?.length) lines.push(`- Loved: ${withScores(p.loved)}`);
  if (p.disliked?.length) lines.push(`- Disliked: ${withScores(p.disliked)}`);

  if (p.observedGenres?.length) {
    const observed = p.observedGenres.map((g) => `${g.genre} (${g.count})`).join(', ');
    lines.push(`- Genres they actually rate: ${observed}`);
  }

  if (p.typeMix) {
    const { movie, series, game } = p.typeMix;
    if (movie + series + game > 0) {
      lines.push(`- Split by kind: ${movie} films, ${series} series, ${game} games`);
    }
  }

  if (p.watchlist?.length) lines.push(`- Already on their watchlist: ${list(p.watchlist)}`);

  if (p.inProgress?.length) {
    const mid = p.inProgress.map((i) => `${i.title} (${i.percent}% in)`).join(', ');
    lines.push(`- Part-way through right now: ${mid}`);
  }

  if (!lines.length) return '';

  return `${lines.join('\n')}

How to use the behavioural data above:
- The "Disliked" list is what to steer AWAY from. Do not recommend those
  titles, and be careful with close neighbours of them. If you do suggest
  something adjacent, say why this one is different.
- Where the declared favourite genres and the genres they actually rate
  disagree, trust what they rate. People describe their taste aspirationally.
- Do not present something already on their watchlist as a discovery. You may
  absolutely point at it — "you already saved this, tonight is the night" is
  useful — but never as though it were new to them.
- If they are part-way through something, that comes first. Someone 40% into a
  series does not want a new series; ask whether they are enjoying it or help
  them finish before suggesting anything else.
- If one kind dominates the split, recommend mostly that kind unless they ask
  otherwise. Do not push films at someone who only rates games.
`;
}

/**
 * Builds the system prompt from the spec, with the user's profile interpolated.
 *
 * The instruction to reference the profile is the whole point of the feature —
 * a generic recommendation is a failure here, so the prompt says so explicitly
 * and the profile lines are always present even when a field is empty (an
 * absent line reads as "no data" to the model; "none yet" is unambiguous).
 *
 * Carried across the Gemini migration unchanged apart from the closing
 * paragraph. It contains no XML scaffolding and no "reply only in JSON"
 * instruction, so there was nothing Claude-shaped to unpick: it asks for prose
 * with `[[Title]]` markers, which both model families handle.
 */
export function buildSystemPrompt(
  p: TasteProfile,
  filmContext?: string,
  timeZone?: string | null,
): string {
  const base = `You are Velvet's personal film and entertainment advisor.
You are warm, knowledgeable, opinionated, and conversational —
like a brilliant film-obsessed friend, not a corporate chatbot.

This user's profile:
- Name: ${p.displayName}
- Age: ${p.age ?? 'not shared'}
- Gender: ${none(p.gender ?? '')}
- Favourite genres: ${list(p.favouriteGenres)}
- Favourite mood: ${none(p.favouriteMood ?? '')}
- Titles rated: ${p.watchHistoryCount}
- Average rating they give: ${p.avgRating === null || p.avgRating === undefined ? 'no ratings yet' : `${p.avgRating} out of 5`}
- Recent watches: ${list(p.recentWatches)}
${signals(p)}
Use this profile to give hyper-personalised recommendations.
Be specific — name actual films, directors, explain WHY this
person specifically would love it based on their taste.
Never be generic. Always reference their profile data.
Keep responses conversational, warm, and under 200 words
unless they ask for a detailed breakdown.

You are talking about films, series and games, which means horror, crime,
war and other mature subject matter are ordinary parts of the conversation.
Discuss them as a critic would — plainly and without moralising.

When you name a film, series or game you are recommending, wrap the title in
double square brackets like [[The Brutalist]] so the app can link it. Use that
form only for titles you are actually recommending, not for passing mentions.`;

  /**
   * The clock, stated plainly.
   *
   * A model has no sense of now. Without this, every question touching
   * "today", "tonight", "this week" or "new" is answered against the training
   * cutoff — and nothing in the reply signals that a date was assumed, which
   * is what makes it worse than an admission of not knowing.
   *
   * The instruction to trust this line over its own sense of the date is the
   * load-bearing half: handed a date it finds implausible, a model will
   * otherwise hedge or argue with it rather than use it.
   */
  const clock = `Right now it is ${currentMoment(timeZone)}.
Treat that as the current date and time. It is authoritative, it comes from the
user's own device, and it is more recent than your training data. Use it for
anything that depends on the date: what is out now, what is still upcoming,
what released this year, anniversaries, seasons, and what "tonight" means. If
you are asked the date or the day of the week, answer from that line directly.`;

  const withClock = `${base}\n\n${clock}`;

  // The detail screen's "Ask AI" seeds the conversation with the title in view.
  return filmContext
    ? `${withClock}\n\nThe user is currently looking at: ${filmContext}. Ground your answer in that title unless they ask about something else.`
    : withClock;
}

/**
 * Follow-up chips shown under an assistant message.
 *
 * Deliberately derived locally rather than with a second model call: it keeps
 * one user message to one API call (which is what the daily quota counts) and
 * the chips are conversational nudges, not content that needs a model.
 */
export function followUps(reply: string, profile: TasteProfile): string[] {
  const pool: string[] = [];

  // If the reply recommended titles, offer to go deeper on the first one.
  const titles = extractTitles(reply);
  if (titles[0]) pool.push(`Tell me more about ${titles[0]}`);
  if (titles.length > 1) pool.push('Which of those should I start with?');

  const genre = profile.favouriteGenres[0];
  if (genre) pool.push(`More ${genre.toLowerCase()} like this`);

  pool.push('Something shorter tonight', 'Surprise me with something older');

  return pool.slice(0, 3);
}

/**
 * Pulls `[[Title]]` markers out of a reply.
 *
 * Note for anyone tempted to replace this with Gemini's `responseSchema`: the
 * advisor's output is prose with links *inside* it, not a list of titles beside
 * it. A schema would force the reply into a shape the chat UI does not render
 * and `linkTitles` could not rewrite. This is not the JSON-in-prose parsing
 * that structured output exists to kill — there is none of that here.
 */
export function extractTitles(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[1].trim();
    if (title && !out.includes(title)) out.push(title);
  }
  return out;
}
