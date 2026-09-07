/** Display helpers shared by server and client components. */

/**
 * Catalogue scores to the design's one-decimal form ("7.8", "8.0").
 *
 * The design shows a decimal everywhere a score appears, so a whole number like
 * 8 must not render as "8".
 */
export const formatScore = (score: number): string => score.toFixed(1);

/**
 * The design's signature title treatment: the first word upright in the light
 * display tone, the remainder in the indigo italic ("The" / *Brutalist*).
 *
 * A single-word title goes wholly to the italic rather than losing the
 * two-tone gesture entirely.
 */
export function splitTitle(title: string): { lead: string | null; accent: string } {
  const i = title.indexOf(' ');
  if (i === -1) return { lead: null, accent: title };
  return { lead: title.slice(0, i), accent: title.slice(i + 1) };
}

/** Avatar fallback: the first character of whatever name we have. */
export const initial = (name: string | null | undefined): string =>
  (name || 'V').trim().charAt(0).toUpperCase() || 'V';

/** "1.2K", "18K" — used for follower counts and review totals. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/**
 * Compact relative time for activity rows, notifications and message groups
 * ("now", "4m", "3h", "2d", then an absolute date past a week).
 *
 * Deliberately not `Intl.RelativeTimeFormat`: the design's feed uses the short
 * single-letter form, which that API doesn't produce.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 45) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;

  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "14 March 2024" — for profile join dates and review timestamps. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The divider between message groups in a thread. */
export function messageGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const wasYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (wasYesterday) return `Yesterday ${time}`;

  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/**
 * `HH:mm`, 24-hour, for the timestamp inside a message bubble.
 *
 * Deliberately not `toLocaleTimeString` with `hour12` left to the locale: the
 * stamp sits inline at the end of the last line of a bubble, and "10:04 PM" is
 * three characters wider than "22:04" — enough to force a wrap on a short final
 * line. A fixed width keeps the bubble shape predictable.
 */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** True when both timestamps land on the same calendar day, locally. */
export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

/**
 * `Today` / `Yesterday` / `MMM D` — the centred divider between groups that
 * cross a calendar day. Carries no time; the bubbles do that.
 */
export function dayDivider(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const today = new Date();
  if (sameCalendarDay(d, today)) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameCalendarDay(d, yesterday)) return 'Yesterday';

  // The year only earns its space once it stops being the current one.
  return d.getFullYear() === today.getFullYear()
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Five-star display used in review headers and activity rows. */
export const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
