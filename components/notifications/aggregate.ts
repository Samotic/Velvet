import type { Notification } from '@/lib/contentTypes';

/**
 * Collapses runs of `new_follower` notifications from the same 24h window into
 * one row: "Ada and 4 others started following you".
 *
 * Ten separate "started following you" rows is noise once an account has real
 * followers, and it buries everything else in the list.
 *
 * Two rules that matter:
 *
 *  - **`follow_request` is never aggregated.** Those rows carry Accept /
 *    Decline, and burying an action behind a tap loses it.
 *  - Only *adjacent* rows collapse. The list is already newest-first, so a run
 *    is contiguous; grouping non-adjacent rows would reorder the feed and move
 *    things the user had already placed.
 */

export type NotificationGroup =
  | { kind: 'single'; key: string; item: Notification }
  | { kind: 'followers'; key: string; items: Notification[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two types that mean "started following you" — one is pre-split legacy. */
const FOLLOWER_TYPES = new Set(['new_follower', 'follow']);

export function groupNotifications(items: Notification[]): NotificationGroup[] {
  const out: NotificationGroup[] = [];
  let run: Notification[] = [];

  const flush = () => {
    if (!run.length) return;
    // A "group" of one is just a row — collapsing it would hide the actor's
    // name behind a tap for no benefit.
    out.push(
      run.length === 1
        ? { kind: 'single', key: run[0].id, item: run[0] }
        : { kind: 'followers', key: `grp-${run[0].id}`, items: run },
    );
    run = [];
  };

  for (const n of items) {
    if (!FOLLOWER_TYPES.has(n.type)) {
      flush();
      out.push({ kind: 'single', key: n.id, item: n });
      continue;
    }

    // Window is measured from the newest row in the run, so a long tail of
    // older follows doesn't drag unrelated days into one group.
    const anchor = run[0];
    const within =
      !anchor ||
      new Date(anchor.createdAt).getTime() - new Date(n.createdAt).getTime() < DAY_MS;

    if (!within) flush();
    run.push(n);
  }

  flush();
  return out;
}

/** "Ada and 4 others started following you" */
export function groupLabel(items: Notification[]): string {
  const first = items[0].actor ?? items[0].from;
  const who = first?.displayName ?? 'Someone';
  const others = items.length - 1;
  return `${who} and ${others} other${others === 1 ? '' : 's'} started following you`;
}
