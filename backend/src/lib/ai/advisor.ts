/**
 * The advisor's own logic: what it knows about the user, how it is asked, and
 * what is pulled back out of the reply.
 *
 * None of this is provider-specific, which is the point — it lived inside the
 * Claude service before and would have had to be duplicated the moment a second
 * provider existed. Prompt changes belong here, transport belongs in the
 * provider modules.
 */

/** Everything the system prompt interpolates about the person asking. */
export interface TasteProfile {
  displayName: string;
  age?: number;
  gender?: string;
  favouriteGenres: string[];
  favouriteMood?: string;
  watchHistoryCount: number;
  topRatedFilms: string[];
  avgRating: number | null;
  recentWatches: string[];
}

export interface AdvisorTurn {
  role: 'user' | 'assistant';
  content: string;
}

const none = (v: string) => v || 'not shared';
const list = (v: string[]) => (v.length ? v.join(', ') : 'none yet');

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
export function buildSystemPrompt(p: TasteProfile, filmContext?: string): string {
  const base = `You are Velvet's personal film and entertainment advisor.
You are warm, knowledgeable, opinionated, and conversational —
like a brilliant film-obsessed friend, not a corporate chatbot.

This user's profile:
- Name: ${p.displayName}
- Age: ${p.age ?? 'not shared'}
- Gender: ${none(p.gender ?? '')}
- Favourite genres: ${list(p.favouriteGenres)}
- Favourite mood: ${none(p.favouriteMood ?? '')}
- Films watched: ${p.watchHistoryCount}
- Top rated films: ${list(p.topRatedFilms)}
- Average rating they give: ${p.avgRating ?? 'no ratings yet'} out of 5
- Recent watches: ${list(p.recentWatches)}

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

  // The detail screen's "Ask AI" seeds the conversation with the title in view.
  return filmContext
    ? `${base}\n\nThe user is currently looking at: ${filmContext}. Ground your answer in that title unless they ask about something else.`
    : base;
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
