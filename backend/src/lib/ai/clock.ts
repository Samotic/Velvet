/**
 * The advisor's sense of "now".
 *
 * A model has no clock. Without this it answers "what's on tonight?" against
 * whatever date its training happened to end on, and confidently calls a film
 * upcoming years after release — which is worse than saying it doesn't know,
 * because nothing in the reply signals the guess.
 *
 * The zone comes from the browser rather than the server. The server's clock is
 * a deployment detail; the user asking "what should I watch tonight" means
 * *their* tonight, and a host in UTC would put them a day out for a good part
 * of every evening.
 */

/** Only ever compared against `Intl`, never interpolated raw into the prompt. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    // RangeError for anything Intl does not recognise, which is also what
    // makes this the validation rather than a pattern match on the string.
    return false;
  }
}

/**
 * A sentence stating the current date and time, for the system prompt.
 *
 * Written out in full — weekday, day, month, year — rather than as an ISO
 * stamp, because the model reproduces the shape it is given and users ask in
 * words. The zone is named so the model can reason about "tomorrow" without
 * having to assume one.
 */
export function currentMoment(timeZone?: string | null, at: Date = new Date()): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';

  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: zone,
  }).format(at);

  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(at);

  return `${date}, ${time} (${zone})`;
}
