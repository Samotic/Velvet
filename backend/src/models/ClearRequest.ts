import { Schema, model, type Model, type Types } from 'mongoose';

import {
  PENDING_INDEX_FILTER,
  PENDING_INDEX_KEYS,
  PENDING_INDEX_NAME,
  RESOLVED_INDEX_KEYS,
} from './clearRequestIndex';

/**
 * A request to clear a whole conversation for both participants.
 *
 * **Creating one clears nothing.** It is the consent gate in front of the two
 * deletion outcomes that already exist: when the other participant accepts,
 * delete-for-me is applied for both of them and delete-for-everyone's content
 * wipe is applied to every message before `cutoff` — see
 * `acceptClearRequest` in the message controller. There is no third kind of
 * deletion here, only a third way of being *permitted* the existing two.
 *
 * Resolved documents are kept. An accepted one is the record of an
 * irreversible wipe — who asked, who agreed, when, and how far back it
 * reached — and it is what the thread's "You and Saman cleared this chat" line
 * and the inbox's "Chat cleared" are drawn from. A declined or cancelled one
 * is history in the same sense `FollowRequest` is.
 */
export const CLEAR_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export type ClearRequestStatus = (typeof CLEAR_REQUEST_STATUSES)[number];

export interface IClearRequest {
  conversationId: Types.ObjectId;
  /** Who asked. The only one who may cancel. */
  requesterId: Types.ObjectId;
  /** Who has to agree. The only one who may accept or decline. */
  recipientId: Types.ObjectId;
  /**
   * Messages created **strictly before** this instant are cleared on
   * acceptance. Stamped when the request is made, never when it is answered:
   * anything sent while the request waits is not part of what the requester
   * asked to erase, nor of what the recipient was looking at when they agreed.
   *
   * Strictly before, because a message the requester could have seen was
   * rendered before they pressed the button — it cannot share the millisecond.
   * A message that does share it cannot have been seen, and on an irreversible
   * write the tie goes to the message surviving.
   */
  cutoff: Date;
  status: ClearRequestStatus;
  /**
   * When it stopped being pending, by any of the three routes. For an
   * acceptance, the moment its writes finished — not when it was pressed.
   */
  resolvedAt: Date | null;
  /** How many messages acceptance cleared. Null until then. */
  clearedCount: number | null;
  /**
   * Set while an acceptance is being carried out; null otherwise.
   *
   * A request stays `pending` for the whole of an acceptance and reads
   * `accepted` only once every write has landed, so a failure partway leaves
   * it pending and answerable again. This is what holds it in the meantime: a
   * withdraw, a decline or a second accept will not act on a request with a
   * live claim. A claim older than `ACCEPT_LEASE_MS` belongs to an attempt that
   * died without releasing it, and holds nothing.
   */
  acceptingSince: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * How long an acceptance may hold its request. Generous on purpose: the writes
 * take seconds, and a lease that lapses mid-acceptance lets a withdraw through
 * against a thread that is being wiped — far worse than a crashed attempt
 * blocking the retry for ten minutes.
 */
export const ACCEPT_LEASE_MS = 10 * 60 * 1000;

const clearRequestSchema = new Schema<IClearRequest>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cutoff: { type: Date, required: true },
    status: { type: String, enum: CLEAR_REQUEST_STATUSES, default: 'pending', required: true },
    resolvedAt: { type: Date, default: null },
    clearedCount: { type: Number, default: null, min: 0 },
    acceptingSince: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * One **pending** request per conversation — and only pending.
 *
 *     { conversationId: 1 }
 *     unique, partialFilterExpression: { status: { $eq: 'pending' } }
 *
 * The index holds an entry only for a document whose `status` is exactly
 * `'pending'`. The moment a request is accepted, declined or cancelled it drops
 * out, and the next request for the same thread is free to be created.
 *
 * A plain `unique` on `conversationId` would be the `participants_1` mistake
 * again: correct for the first request and then wrong forever, because every
 * resolved request would keep its entry — a thread could be asked about exactly
 * once, and every later request would 11000. Like that bug, it would pass any
 * test that only ever makes one request, which is why `verify:clearboth` makes
 * a second one after a decline.
 *
 * It is the race guard as well as the rule. Both participants can press "Ask to
 * clear for both" in the same instant and both miss the `findOne` in the
 * controller; only this index decides that one of them loses.
 *
 * ── autoIndex is off in production ──
 * So this does not exist on Atlas until
 * `scripts/migrate-clear-request-index.ts --apply` creates it. The feature
 * still works without it; the race above is simply unguarded.
 */
clearRequestSchema.index(PENDING_INDEX_KEYS, {
  name: PENDING_INDEX_NAME,
  unique: true,
  partialFilterExpression: PENDING_INDEX_FILTER,
});

/** The thread notice and the inbox label read the latest accepted request. */
clearRequestSchema.index(RESOLVED_INDEX_KEYS);

export type ClearRequestModel = Model<IClearRequest>;

export const ClearRequest: ClearRequestModel = model<IClearRequest>(
  'ClearRequest',
  clearRequestSchema,
);
