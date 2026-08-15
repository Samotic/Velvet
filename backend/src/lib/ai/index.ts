import { env } from '../../config/env';

import { buildSystemPrompt, type AdvisorTurn, type TasteProfile } from './advisor';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import type { AIProvider } from './provider';

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
}): Promise<string> {
  const result = await provider.chat(
    [
      ...opts.history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user' as const, content: opts.message },
    ],
    { system: buildSystemPrompt(opts.profile, opts.filmContext) },
  );

  return result.text || "I didn't manage a reply there — ask me again?";
}

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
