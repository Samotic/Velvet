'use client';

import { api } from './api';
import type { AiChatResponse, AiMessage } from './contentTypes';
// The same encoder direct messages use. A voice note is a voice note; having
// two ways to turn a Blob into a data URL is how the two paths drift.
import { toDataUrl } from './messages';

/**
 * The AI advisor's client.
 *
 * The system prompt, the taste-profile interpolation and the model choice all
 * live server-side — the browser never sees them, and never holds an API key.
 * This module just carries turns back and forth.
 */

/** The starter questions in the left panel. */
export const SUGGESTED_QUESTIONS = [
  'What should I watch tonight?',
  'Suggest something based on my mood',
  'Why do I always love thrillers?',
  'Best films like Parasite?',
  'Build my personal top 10',
  'Surprise me — something unexpected',
];

export function getAiHistory(signal?: AbortSignal): Promise<AiMessage[]> {
  return api.get<{ messages: AiMessage[] }>('/api/ai/history', { signal }).then((r) => r.messages);
}

/**
 * Sends one turn.
 *
 * `contentId`/`contentType` are set when the question came from a detail
 * screen's "Ask AI", so the advisor can be told which title is on screen
 * without the user having to name it.
 */
export function sendAiMessage(
  message: string,
  context?: { contentId: string; contentType: string; contentTitle: string },
): Promise<AiChatResponse> {
  return api.post<AiChatResponse>('/api/ai/chat', { message, context, timeZone: timeZone() });
}

/**
 * The browser's IANA zone, sent with every turn.
 *
 * The advisor is told the current date so it stops answering "what's out now"
 * against its training cutoff, and that date has to be resolved in the user's
 * zone rather than the server's — a host in UTC puts someone in Istanbul a day
 * out for most of the evening, which is exactly when the question gets asked.
 *
 * Wrapped because `resolvedOptions()` can throw on very old engines, and a
 * missing zone is a server-side fallback to UTC, not a failed message.
 */
function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The daily allowance, mirroring `AI_FREE_DAILY_MESSAGES` on the server.
 *
 * Only ever used for the line under the composer *before* the first reply of a
 * session tells us the real remaining count. The server owns the limit and
 * enforces it, so a stale value here can misstate the total for one message
 * and never grant one.
 */
export const AI_DAILY_MESSAGES = 25;

/** Matches `MAX_AUDIO_BYTES` / the recorder ceiling used by direct messages. */
export const MAX_AI_VOICE_BYTES = 3 * 1024 * 1024;

/**
 * Asks the advisor a spoken question.
 *
 * The clip is transcribed server-side and everything after that is an ordinary
 * text turn — which is why this returns the same shape as `sendAiMessage` and
 * the caller does not have to branch on how the question was asked.
 */
export async function sendAiVoiceNote(clip: Blob): Promise<AiChatResponse> {
  if (clip.size > MAX_AI_VOICE_BYTES) throw new Error('That recording is too long');

  const media = await toDataUrl(clip);
  return api.post<AiChatResponse>('/api/ai/chat', {
    kind: 'audio',
    media,
    timeZone: timeZone(),
  });
}

/**
 * Turns the film titles the advisor names into links.
 *
 * The backend wraps recommendations in `[[Title|type|id]]` so we don't have to
 * guess at titles in prose — parsing free text would link the wrong words and
 * miss the ones that matter. Anything unmatched is returned as plain text.
 */
export type AiSegment = { text: string; href?: string };

const LINK_RE = /\[\[([^\]|]+)\|([^\]|]+)\|([^\]]+)\]\]/g;

export function parseAiContent(content: string): AiSegment[] {
  const segments: AiSegment[] = [];
  let last = 0;

  // `exec` in a loop rather than `matchAll`, whose iterator needs a newer
  // downlevel-iteration target than this project compiles to. `LINK_RE` is
  // module-level and global, so reset `lastIndex` before each pass.
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(content)) !== null) {
    const [full, title, type, id] = match;
    const at = match.index;
    if (at > last) segments.push({ text: content.slice(last, at) });
    segments.push({ text: title, href: `/${type}/${id}` });
    last = at + full.length;
  }

  if (last < content.length) segments.push({ text: content.slice(last) });
  return segments.length ? segments : [{ text: content }];
}
