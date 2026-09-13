import { hrefFor, type Notification } from '@/lib/contentTypes';

/**
 * Turns a notification into the sentence and destination the UI shows.
 *
 * Lives in its own module because both the navbar dropdown and the full
 * /notifications screen render the same line — and because a plain `.ts` file
 * can be imported by server and client components alike.
 *
 * Returns a string rather than JSX so the bold/accent emphasis is applied by
 * whichever surface is rendering; the dropdown wants a single quiet line, the
 * full page wants the actor's name in white.
 */
export function notificationLine(n: Notification): {
  text: string;
  href: string;
  /** True when Velvet itself sent it, so the UI shows the AI mark. */
  system: boolean;
} {
  const actor = n.actor ?? n.from;
  const who = actor?.displayName ?? actor?.username ?? 'Someone';
  const username = actor?.username ?? who;
  const title = n.contentTitle ?? 'a title';
  const contentHref =
    n.contentId && n.contentType ? hrefFor(n.contentType, n.contentId) : '/notifications';
  const profileHref = actor ? `/profile/${encodeURIComponent(actor.username)}` : '/notifications';

  switch (n.type) {
    // Pre-split rows still in the database; reads the same as new_follower.
    case 'follow':
    case 'new_follower':
      return { text: `${who} started following you`, href: profileHref, system: false };
    case 'follow_request':
      return { text: `${username} wants to follow you`, href: profileHref, system: false };
    case 'follow_accepted':
      return { text: `${username} accepted your follow request`, href: profileHref, system: false };
    case 'review_like':
      return { text: `${who} liked your review of ${title}`, href: contentHref, system: false };
    case 'review_reply':
      return { text: `${who} replied to your review of ${title}`, href: contentHref, system: false };
    case 'message':
      return {
        text: `${who} sent you a message`,
        href: n.from ? `/messages/${n.from.id}` : '/messages',
        system: false,
      };
    // No Accept on the card: accepting is irreversible, and its confirm step
    // lives in the thread, where the request's banner is.
    case 'clear_request':
      return {
        text: `${who} asked to clear your chat for both of you`,
        href: n.from ? `/messages/${n.from.id}` : '/messages',
        system: false,
      };
    case 'ai_picks':
      return { text: 'Your AI picks are ready for this week', href: '/ai', system: true };
    case 'available':
      return { text: `${title} from your watchlist is now available`, href: contentHref, system: true };
    default:
      return { text: 'Something happened on Velvet', href: '/notifications', system: true };
  }
}
