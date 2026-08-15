import Anthropic from '@anthropic-ai/sdk';

import { env } from '../../config/env';

import {
  AIError,
  AiNotConfiguredError,
  logCall,
  withRetry,
  type AIProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
} from './provider';

/**
 * The Claude-backed advisor, unchanged in behaviour and now behind
 * `AIProvider`.
 *
 * Retained through the Gemini migration so the two can be diffed on the same
 * prompts before this file is deleted. It is only reachable with
 * AI_PROVIDER=anthropic.
 *
 * One client is reused across requests (the SDK is designed for that). It is
 * created lazily so the server still boots with no ANTHROPIC_API_KEY — the AI
 * routes then answer 503 rather than the process dying at import time.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  // Checks its own key rather than `configured.ai()`, which reports on whichever
  // provider is selected — a provider must never read as ready on another's key.
  if (!env.anthropicApiKey) throw new AiNotConfiguredError('Claude');
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

/** The SDK throws a typed error carrying an HTTP status; surface it for retry. */
function toAIError(err: unknown): AIError {
  if (err instanceof Anthropic.APIError) {
    return new AIError(`Anthropic ${err.status}: ${err.message}`, err.status);
  }
  return new AIError(err instanceof Error ? err.message : String(err));
}

const MAX_OUTPUT_TOKENS = 2048;

export const anthropicProvider: AIProvider = {
  name: 'anthropic',

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const anthropic = getClient();
    const startedAt = Date.now();

    const response = await withRetry('anthropic.chat', async () => {
      try {
        return await anthropic.messages.create({
          model: env.anthropicModel,
          // Generous enough for the "detailed breakdown" case without truncating
          // mid-sentence; the prompt asks for under 200 words in the normal case.
          max_tokens: opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.system ? { system: opts.system } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });
      } catch (err) {
        throw toAIError(err);
      }
    });

    // content is a discriminated union — take the text blocks and join them.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const result: ChatResult = {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
      finishReason: response.stop_reason ?? 'unknown',
    };

    logCall('anthropic', result, startedAt);
    return result;
  },

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const anthropic = getClient();
    const startedAt = Date.now();

    const stream = anthropic.messages.stream({
      model: env.anthropicModel,
      max_tokens: opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.system ? { system: opts.system } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    } catch (err) {
      throw toAIError(err);
    }

    const final = await stream.finalMessage();
    logCall(
      'anthropic',
      {
        model: final.model,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        finishReason: final.stop_reason ?? 'unknown',
      },
      startedAt,
    );
  },
};
