/**
 * The "one pending request per conversation" index, as plain data.
 *
 * Its own module so `scripts/migrate-clear-request-index.ts` can create exactly
 * the index the schema declares without importing the model. Importing the
 * model registers its schema, and outside production that triggers autoIndex —
 * which would build the index during what was meant to be a dry run.
 */
export const PENDING_INDEX_NAME = 'one_pending_per_conversation';

export const PENDING_INDEX_KEYS = { conversationId: 1 } as const;

/**
 * Written out in full, operator and all, because this filter is the whole
 * meaning of the index: only a document whose `status` is exactly `'pending'`
 * has an entry, so uniqueness is enforced among pending requests and nowhere
 * else. See the note on the index in `ClearRequest.ts`.
 */
export const PENDING_INDEX_FILTER = { status: { $eq: 'pending' } } as const;

/** The thread notice and the inbox label: the latest accepted request. */
export const RESOLVED_INDEX_KEYS = { conversationId: 1, status: 1, resolvedAt: -1 } as const;
