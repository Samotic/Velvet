'use client';

import { api } from './api';
import type { AiChatResponse, AiMessage } from './contentTypes';

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
  return api.post<AiChatResponse>('/api/ai/chat', { message, context });
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
