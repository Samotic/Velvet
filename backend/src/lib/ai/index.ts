import { env } from '../../config/env';

import { buildSystemPrompt, type AdvisorTurn, type TasteProfile } from './advisor';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { AIError, type AIProvider } from './provider';

/**
 * The only module the rest of the server imports for anything AI.
 *
 * Nothing outside this directory should reach for `./gemini` or `./anthropic`
 * directly — that is what turns a provider swap from a config change back into
 * a code change. The acceptance criteria grep for it.
 */

/** Chosen once at import: the flag cannot change under a running process. */
const provider: AIProvider = env.aiProvider === 'anthropic' ? anthropicProvider : geminiProvider;

/** Which provider is live. Logged at boot and useful in error copy. */
export const activeProvider = provider.name;

/**
 * Sends one turn to the advisor and returns the reply text.
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
  /** IANA zone from the browser, so "tonight" means the user's tonight. */
  timeZone?: string | null;
}): Promise<string> {
  const result = await provider.chat(
    [
      ...opts.history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user' as const, content: opts.message },
    ],
    { system: buildSystemPrompt(opts.profile, opts.filmContext, opts.timeZone) },
  );

  return result.text || "I didn't manage a reply there — ask me again?";
}

/**
 * Turns a spoken question into the text the rest of the advisor already
 * handles.
 *
 * A second call rather than sending the audio along with the conversation, and
 * the extra call buys something specific: from here on a voice note **is** a
 * text message. History replay, `[[Title]]` extraction, the follow-up chips
 * and the daily quota all keep working untouched, where a parallel audio path
 * would need each of them taught a second shape.
 *
 * The alternative — one multimodal call answering the audio directly — cannot
 * produce the transcript the stored history needs without asking the model to
 * emit both in one reply, and pulling two values out of one prose response is
 * exactly the fence-parsing this codebase refuses elsewhere.
 *
 * Output is capped hard. This is a transcription, not an answer, and an
 * unbounded ceiling on a call that should return a sentence is how a stuck
 * model turns into a bill.
 */
export async function transcribe(audio: { data: string; mimeType: string }): Promise<string> {
  if (!provider.transcribe) {
    // No status: this is a configuration fact about the running provider,
    // not something the upstream API refused.
    throw new AIError(`${provider.name} cannot accept audio`);
  }
  return provider.transcribe(audio);
}

/** Whether the live provider can hear. Lets the UI hide the mic rather than
 *  offer a button whose only outcome is an error. */
export const supportsVoice = typeof provider.transcribe === 'function';

export { buildSystemPrompt, extractTitles, followUps } from './advisor';
export type { AdvisorTurn, TasteProfile } from './advisor';
export {
  AIError,
  AiBlockedError,
  AiNotConfiguredError,
  type AIProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
} from './provider';
