/**
 * The numbers direct messaging is governed by.
 *
 * They live here rather than inline because each is read from more than one
 * place: the length cap by the Message schema, the send path and the edit
 * path; the two windows by the edit and delete controllers and, through the
 * serialized message, by the client deciding whether to offer Edit at all.
 * A literal repeated across three files is three chances to disagree — which
 * had already happened once, with `2000` written into both the schema and the
 * send controller.
 */

/** Longest a message body may be, in characters, measured after sanitising. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * How long after sending a message may still be edited.
 *
 * Separate from the delete window even though both are 48h today: they answer
 * different questions ("may I still reword this" vs. "may I still retract
 * this") and tying them to one constant would make loosening one silently
 * loosen the other.
 */
export const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

/** How long after sending a message may still be deleted for everyone. */
export const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
