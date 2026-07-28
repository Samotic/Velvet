import Anthropic from '@anthropic-ai/sdk';

import { configured, env } from '../config/env';

/**
 * The Claude-backed advisor.
 *
 * One client is reused across requests (the SDK is designed for that). It is
 * created lazily so the server still boots with no ANTHROPIC_API_KEY — the AI
 * routes then answer 503 rather than the process dying at import time.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!configured.ai()) throw new AiNotConfiguredError();
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('The AI advisor is not configured on this server');
    this.name = 'AiNotConfiguredError';
  }
}

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

const none = (v: string) => v || 'not shared';
const list = (v: string[]) => (v.length ? v.join(', ') : 'none yet');

/**
 * Builds the system prompt from the spec, with the user's profile interpolated.
 *
 * The instruction to reference the profile is the whole point of the feature —
 * a generic recommendation is a failure here, so the prompt says so explicitly
 * and the profile lines are always present even when a field is empty (an
 * absent line reads as "no data" to the model; "none yet" is unambiguous).
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

When you name a film, series or game you are recommending, wrap the title in
double square brackets like [[The Brutalist]] so the app can link it. Use that
form only for titles you are actually recommending, not for passing mentions.`;

  // The detail screen's "Ask AI" seeds the conversation with the title in view.
  return filmContext
    ? `${base}\n\nThe user is currently looking at: ${filmContext}. Ground your answer in that title unless they ask about something else.`
    : base;
}

export interface AdvisorTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Sends one turn to Claude and returns the reply text.
 *
 * `history` is the recent conversation, oldest first, excluding the new message.
 * It is trimmed by the caller — replaying an unbounded history would grow cost
 * without improving answers.
 */
export async function askAdvisor(opts: {
  profile: TasteProfile;
  history: AdvisorTurn[];
  message: string;
  filmContext?: string;
}): Promise<string> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: env.anthropicModel,
    // Generous enough for the "detailed breakdown" case without truncating
    // mid-sentence; the prompt asks for under 200 words in the normal case.
    max_tokens: 2048,
    system: buildSystemPrompt(opts.profile, opts.filmContext),
    messages: [
      ...opts.history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user' as const, content: opts.message },
    ],
  });

  // content is a discriminated union — take the text blocks and join them.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return text || "I didn't manage a reply there — ask me again?";
}

/**
 * Follow-up chips shown under an assistant message.
 *
 * Deliberately derived locally rather than with a second Claude call: it keeps
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

/** Pulls `[[Title]]` markers out of a reply. */
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
