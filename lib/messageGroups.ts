import type { DirectMessage } from './contentTypes';
import { dayDivider, sameCalendarDay } from './format';

/**
 * Turns a flat message list into the groups the thread renders.
 *
 * Plain data and no React, so the rules are testable on their own and the
 * component is left with nothing but markup. Kept out of the `'use client'`
 * components for the reason `lib/onboarding.ts` is: importing plain data out of
 * a client module hands the server a client reference proxy.
 */

/** Consecutive messages from one sender inside this window read as one turn. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Delivery state, which exists only on the sender's screen.
 *
 * Absent means the server has it. A failed message keeps its place in the list
 * rather than vanishing — losing what you just typed because the network
 * blinked is worse than showing it greyed with a retry.
 */
export type SendState = 'sending' | 'failed';

/** A message plus the local-only delivery state the server knows nothing about. */
export interface ThreadMessage extends DirectMessage {
  sendState?: SendState;
}

export interface MessageGroup {
  /** The first message's id — stable across re-renders and socket echoes. */
  id: string;
  senderId: string;
  /** True when the signed-in user wrote it. Drives which edge it aligns to. */
  mine: boolean;
  messages: ThreadMessage[];
  /**
   * Divider to render *before* this group, or null.
   *
   * Carried on the group rather than emitted as a sibling entry so the caller
   * cannot render a divider without the group it introduces — the two are one
   * decision and separating them is how a stray divider ends up at the bottom
   * of a thread.
   */
  dayLabel: string | null;
}

/**
 * Groups by sender and time, and marks day boundaries.
 *
 * A group breaks on any of three things: a different sender, a gap wider than
 * `GROUP_WINDOW_MS`, or a calendar day change. The last is not redundant —
 * two messages four minutes apart can still straddle midnight, and without the
 * check the divider would land inside a group rather than between two.
 */
export function groupMessages(
  messages: ThreadMessage[],
  meId: string | null | undefined,
): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const m of messages) {
    const at = new Date(m.createdAt);
    const open = groups[groups.length - 1];
    const last = open?.messages[open.messages.length - 1];
    const lastAt = last ? new Date(last.createdAt) : null;

    const newDay = !lastAt || !sameCalendarDay(at, lastAt);
    const sameSender = open?.senderId === m.senderId;
    const withinWindow = lastAt ? at.getTime() - lastAt.getTime() <= GROUP_WINDOW_MS : false;

    if (open && sameSender && withinWindow && !newDay) {
      open.messages.push(m);
      continue;
    }

    groups.push({
      id: m.id,
      senderId: m.senderId,
      mine: Boolean(meId) && m.senderId === meId,
      messages: [m],
      dayLabel: newDay ? dayDivider(m.createdAt) : null,
    });
  }

  return groups;
}

/**
 * The corner radii that make a stack read as one utterance.
 *
 * Outer corners on the group's leading and trailing bubbles stay round; the
 * inner corners where bubbles meet tighten to 4px. A lone bubble is both
 * leading and trailing, so it stays fully round.
 *
 * Returned as a class suffix rather than inline styles so the values live in
 * the stylesheet with everything else.
 */
export function groupPosition(index: number, total: number): string {
  if (total === 1) return 'solo';
  if (index === 0) return 'lead';
  if (index === total - 1) return 'tail';
  return 'mid';
}
