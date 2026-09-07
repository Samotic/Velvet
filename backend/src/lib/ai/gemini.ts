import {
  ApiError,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type Content,
  type GenerateContentResponse,
  type SafetySetting,
} from '@google/genai';

import { env } from '../../config/env';

import {
  AIError,
  AiBlockedError,
  AiNotConfiguredError,
  BLOCKING_FINISH_REASONS,
  logCall,
  withRetry,
  type AIProvider,
  type AudioInput,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
} from './provider';

/**
 * The Gemini-backed advisor.
 *
 * Uses `models.generateContent` rather than the newer Interactions API: the
 * conversation already lives in Mongo (`AIChatMessage`, replayed by the
 * controller), so server-side state via `previous_interaction_id` would
 * duplicate a store Velvet already owns and make history a thing that exists in
 * two places. Interactions is worth revisiting if tool orchestration ever
 * lands; it is not worth it for replaying ten turns.
 *
 * One client, created lazily so the server still boots with no GEMINI_API_KEY —
 * the AI routes then answer 503 rather than the process dying at import time.
 */

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  // Checks its own key rather than `configured.ai()`, which reports on whichever
  // provider is selected — a provider must never read as ready on another's key.
  if (!env.geminiApiKey) throw new AiNotConfiguredError('Gemini');
  client ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

/**
 * Safety thresholds, set explicitly rather than left on the defaults.
 *
 * Velvet is a film and games app. The default thresholds block on exactly the
 * material the catalogue is made of — horror synopses, violent games, the plot
 * of any crime film — and a blocked response is indistinguishable to the user
 * from the advisor being broken.
 *
 * `OFF` is one step past `BLOCK_NONE` and is the most permissive the API
 * offers. These are the four adjustable text categories; the image and civic
 * categories are not settable here and are left alone.
 */
const SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

const MAX_OUTPUT_TOKENS = 2048;

/**
 * The floor the pinned model accepts, in one place.
 *
 * Reasoning tokens bill at the output rate and the advisor writes two short
 * paragraphs, so the level wants to be as low as the model allows — but
 * `gemini-3.7-flash` rejects `MINIMAL` outright with a 400. Every call site
 * reads this rather than choosing its own: a second literal is a second thing
 * to remember when the pinned model moves, and the failure is a hard 400 on a
 * path that may not be exercised often.
 */
const THINKING_LEVEL = ThinkingLevel.LOW;

/**
 * Anthropic's `assistant` is Gemini's `model`. Converted at the boundary so
 * nothing above `AIProvider` has to know either vocabulary.
 */
const toContents = (messages: ChatMessage[]): Content[] =>
  messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

/**
 * The system prompt is `config.systemInstruction`, never a leading user turn.
 * Prepending it as a message is the usual bad port and it measurably weakens
 * instruction-following.
 */
function buildConfig(opts: ChatOptions) {
  return {
    safetySettings: SAFETY_SETTINGS,
    maxOutputTokens: opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    ...(opts.system ? { systemInstruction: opts.system } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    // See THINKING_LEVEL: the floor the pinned model accepts, shared with the
    // transcription call so the two cannot drift apart.
    thinkingConfig: { thinkingLevel: THINKING_LEVEL },
    // Native schema-constrained output. When a caller asks for JSON it cannot
    // come back malformed, so no caller ever needs to strip fences or parse
    // JSON out of prose.
    ...(opts.json && opts.schema
      ? { responseMimeType: 'application/json', responseSchema: opts.schema }
      : {}),
  };
}

/**
 * Digs the retry window out of a 429.
 *
 * Gemini answers a quota error with `RetryInfo.retryDelay` — "15s", sometimes
 * fractional. It is nested in the error details and reliably present in the
 * serialised message, so it is read off the text rather than depending on the
 * SDK's error shape staying stable.
 */
function retryDelayMs(message: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

/** The SDK throws a typed error carrying an HTTP status; surface it for retry. */
function toAIError(err: unknown): AIError {
  if (err instanceof ApiError) {
    return new AIError(`Gemini ${err.status}: ${err.message}`, err.status, retryDelayMs(err.message));
  }
  if (err instanceof AIError || err instanceof AiBlockedError) throw err;
  return new AIError(err instanceof Error ? err.message : String(err));
}

/**
 * Pulls the text out, or explains why there isn't any.
 *
 * `.text` is undefined when the response was blocked or truncated, so it is
 * guarded rather than trusted. A refusal is raised as `AiBlockedError` — a
 * distinct outcome the controller answers with a specific sentence, never a
 * generic 500.
 */
function extractText(response: GenerateContentResponse): { text: string; finishReason: string } {
  const candidate = response.candidates?.[0];
  const finishReason = String(candidate?.finishReason ?? 'UNKNOWN');

  // A prompt can be rejected before generation even starts.
  const promptBlock = response.promptFeedback?.blockReason;
  if (promptBlock) throw new AiBlockedError(`prompt:${String(promptBlock)}`);

  const text = response.text?.trim();

  if (!text) {
    if (BLOCKING_FINISH_REASONS.has(finishReason)) throw new AiBlockedError(finishReason);
    throw new AIError(`Empty response from Gemini (finishReason: ${finishReason})`);
  }

  return { text, finishReason };
}

const usage = (response: GenerateContentResponse) => ({
  // Thinking tokens are billed as output, so they belong in the output count
  // rather than vanishing from the cost line.
  inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
  outputTokens:
    (response.usageMetadata?.candidatesTokenCount ?? 0) +
    (response.usageMetadata?.thoughtsTokenCount ?? 0),
});

export const geminiProvider: AIProvider = {
  name: 'gemini',

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const ai = getClient();
    const startedAt = Date.now();

    const response = await withRetry('gemini.chat', async () => {
      try {
        return await ai.models.generateContent({
          model: env.geminiModel,
          contents: toContents(messages),
          config: buildConfig(opts),
        });
      } catch (err) {
        throw toAIError(err);
      }
    });

    const { text, finishReason } = extractText(response);

    const result: ChatResult = {
      text,
      ...usage(response),
      model: env.geminiModel,
      finishReason,
    };

    logCall('gemini', result, startedAt);
    return result;
  },

  /**
   * Speech to text, as its own call.
   *
   * Deliberately bare: no system prompt, no taste profile, no history. The job
   * is to hear words, and handing it the advisor's persona invites it to
   * answer the question instead of writing it down — which then gets stored as
   * what the user said.
   *
   * `maxOutputTokens` is small on purpose. A transcript of a voice note capped
   * at two minutes cannot be long, and an unbounded ceiling on a call that
   * should return a sentence is how a stuck model becomes a bill.
   */
  async transcribe(audio: AudioInput): Promise<string> {
    const ai = getClient();
    const startedAt = Date.now();

    const response = await withRetry('gemini.transcribe', async () => {
      try {
        return await ai.models.generateContent({
          model: env.geminiModel,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: audio.mimeType, data: audio.data } },
                {
                  text:
                    'Transcribe this audio verbatim. Reply with the transcription only — ' +
                    'no preamble, no quotation marks, no commentary. If there is no ' +
                    'intelligible speech, reply with nothing at all.',
                },
              ],
            },
          ],
          config: {
            safetySettings: SAFETY_SETTINGS,
            thinkingConfig: { thinkingLevel: THINKING_LEVEL },
            maxOutputTokens: 600,
            temperature: 0,
          },
        });
      } catch (err) {
        throw toAIError(err);
      }
    });

    const { text, finishReason } = extractText(response);

    logCall(
      'gemini',
      { ...usage(response), model: env.geminiModel, finishReason },
      startedAt,
    );

    return text.trim();
  },

  /**
   * Gemini streams an async iterable of chunks, each carrying its own `.text` —
   * there are no `content_block_delta` envelopes to unwrap.
   *
   * Nothing in Velvet streams today (`POST /api/ai/chat` is a single
   * request/response), so this exists to satisfy the interface and to be ready
   * if the advisor UI ever wants incremental output. It is deliberately not
   * wired into a route.
   */
  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const ai = getClient();
    const startedAt = Date.now();

    const iterable = await withRetry('gemini.stream', async () => {
      try {
        return await ai.models.generateContentStream({
          model: env.geminiModel,
          contents: toContents(messages),
          config: buildConfig(opts),
        });
      } catch (err) {
        throw toAIError(err);
      }
    });

    let sawText = false;
    let last: GenerateContentResponse | null = null;

    for await (const chunk of iterable) {
      last = chunk;
      const piece = chunk.text;
      if (piece) {
        sawText = true;
        yield piece;
      }
    }

    // A stream that ends having emitted nothing is a refusal, and has to read as
    // one — otherwise it surfaces as an empty assistant message.
    const finishReason = String(last?.candidates?.[0]?.finishReason ?? 'UNKNOWN');
    if (!sawText) {
      if (BLOCKING_FINISH_REASONS.has(finishReason)) throw new AiBlockedError(finishReason);
      throw new AIError(`Empty stream from Gemini (finishReason: ${finishReason})`);
    }

    if (last) {
      logCall('gemini', { model: env.geminiModel, ...usage(last), finishReason }, startedAt);
    }
  },
};
