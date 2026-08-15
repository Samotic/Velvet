/**
 * The seam between Velvet and whichever model is behind the advisor.
 *
 * Everything above this line — the controller, the prompt, the title linking —
 * is provider-agnostic. Everything below it is one vendor's SDK. Nothing
 * outside `src/lib/ai` should import a provider module directly; import the
 * barrel instead, so swapping providers stays a one-line change in config.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** Sent as a first-class system instruction, never as a leading user turn. */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Request structured output. Requires `schema`. */
  json?: boolean;
  /** JSON schema, used only when `json` is true. */
  schema?: object;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: string;
}

export interface AIProvider {
  /** Human-readable name, for logs and error messages. */
  readonly name: 'gemini' | 'anthropic';
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
}

/* --------------------------------- errors --------------------------------- */

/**
 * No key for the selected provider. Answered as 503 — a setup problem on this
 * server, not a failure of the user's request.
 */
export class AiNotConfiguredError extends Error {
  constructor(provider = 'AI') {
    super(`The ${provider} advisor is not configured on this server`);
    this.name = 'AiNotConfiguredError';
  }
}

/** Any other provider failure: transport, rate limit, malformed request. */
export class AIError extends Error {
  readonly status?: number;
  /**
   * How long the provider asked us to wait, in ms, when it said so.
   *
   * A rate limiter knows when its own window reopens and we do not. Guessing
   * with a shorter backoff just burns the remaining attempts before the quota
   * has reset.
   */
  readonly retryAfterMs?: number;

  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'AIError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The model refused to answer.
 *
 * Distinct from `AIError` because it is not a fault — it is an outcome, and the
 * user is owed a specific sentence rather than a generic failure. Gemini's
 * safety filters can fire on exactly the material Velvet is about: horror
 * synopses, violent games, mature-rated titles.
 */
export class AiBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("I can't discuss that title.");
    this.name = 'AiBlockedError';
    this.reason = reason;
  }
}

/**
 * `finishReason` values that mean "refused", not "finished".
 *
 * Wider than just SAFETY on purpose: RECITATION, BLOCKLIST, PROHIBITED_CONTENT
 * and SPII all end a response early with no usable text, and treating any of
 * them as a generic error is how a refusal reaches the user as a 500.
 */
export const BLOCKING_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);

/* -------------------------------- retrying -------------------------------- */

const MAX_ATTEMPTS = 3;

/** Retryable: rate limited, or the provider had a bad moment. */
const isRetryable = (status?: number) => status === 429 || (status !== undefined && status >= 500);

/**
 * Longest we will sit on a retry. Gemini's free tier answers a 429 with a
 * ~15s window; anything much beyond that is better surfaced to the user than
 * held open, because a request nobody is still waiting for costs the same.
 */
const MAX_BACKOFF_MS = 20_000;

/**
 * Three attempts, exponential with jitter — but the provider's own retry
 * window wins when it states one.
 *
 * That override is load-bearing on Gemini's free tier: the quota is 5 requests
 * per minute per model, and the 429 carries `retryDelay: 15s`. Plain
 * exponential backoff tops out around a second, so all three attempts would
 * land inside the same closed window and fail identically. Honouring the
 * server's number turns a guaranteed failure into a success on attempt two.
 *
 * 400 is never retried — a malformed request fails identically the second time
 * and the third, so retrying only multiplies the latency before the error the
 * caller was always going to get.
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err instanceof AIError ? err.status : undefined;
      if (!isRetryable(status) || attempt === MAX_ATTEMPTS) throw err;

      // 1.5s base rather than a few hundred ms: a 503 from Gemini is a capacity
      // blip measured in seconds, and retrying inside a second just spends the
      // remaining attempts before it clears.
      const asked = err instanceof AIError ? err.retryAfterMs : undefined;
      const backoff = Math.min(asked ?? 2 ** (attempt - 1) * 1500, MAX_BACKOFF_MS);
      const jitter = Math.random() * 250;
      console.warn(
        `${label}: attempt ${attempt} failed (${status}), retrying in ~${Math.round(backoff)}ms` +
          (asked ? ' (provider-specified)' : ''),
      );
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }

  throw lastError;
}

/* -------------------------------- logging --------------------------------- */

/**
 * One line per call, so cost is visible from the first day rather than the
 * first invoice. Velvet is free, so the model is pure outgoing spend.
 */
export function logCall(
  provider: string,
  result: Pick<ChatResult, 'model' | 'inputTokens' | 'outputTokens' | 'finishReason'>,
  startedAt: number,
): void {
  console.log(
    `ai ${provider} model=${result.model} in=${result.inputTokens} out=${result.outputTokens} ` +
      `finish=${result.finishReason} ms=${Date.now() - startedAt}`,
  );
}
