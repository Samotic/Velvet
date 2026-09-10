import { Schema, model, type Types, type Model } from 'mongoose';

import { pairKeyFor } from './conversationKey';

/**
 * A two-person thread. Exists so the inbox is one query instead of an
 * aggregation over every message.
 *
 * `pairKey` is the thread's identity — both ids, sorted, joined with `:` — and
 * the unique index on it is what prevents two threads for the same two people.
 * It is derived from `participants` on validate, so the two cannot disagree.
 * See `conversationFor()` in the controller.
 *
 * `unread` is a per-user counter keyed by user id, because "unread" is a fact
 * about a reader, not about the thread.
 *
 * `lastFor` follows `unread` for exactly the same reason. Once a message can be
 * deleted for one participant only, the newest message *I* can see is no longer
 * the newest message the thread has — so the inbox preview is a fact about a
 * reader too, and a single shared string cannot express it. The alternative was
 * computing the preview per viewer in the inbox query, which would turn a plain
 * `find().populate()` into a `$lookup` pipeline on every inbox load to serve a
 * write that happens rarely.
 */
export interface IConversationPreview {
  /** Already run through `previewFor` — a label for media, not a raw body. */
  text: string;
  at: Date | null;
  senderId: Types.ObjectId | null;
}

export interface IConversation {
  participants: Types.ObjectId[];
  /** `pairKeyFor(participants)`. Set on validate; never written by hand. */
  pairKey: string;
  /**
   * The thread-level truth, ignoring per-user deletes. Retained because the
   * inbox still *sorts* on `lastMessageAt` — a per-user map cannot be indexed
   * for a sort — and because it is the fallback for any document written
   * before `lastFor` existed.
   */
  lastMessage: string;
  lastMessageAt: Date | null;
  lastSenderId: Types.ObjectId | null;
  /** What each participant should see, keyed by user id. */
  lastFor: Map<string, IConversationPreview>;
  unread: Map<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const previewSchema = new Schema<IConversationPreview>(
  {
    text: { type: String, default: '' },
    at: { type: Date, default: null },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const conversationSchema = new Schema<IConversation>(
  {
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (v: Types.ObjectId[]) => v.length === 2 && String(v[0]) !== String(v[1]),
        message: 'A conversation has exactly two different participants.',
      },
    },
    pairKey: { type: String, required: true },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null },
    lastSenderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastFor: {
      type: Map,
      of: previewSchema,
      default: () => new Map<string, IConversationPreview>(),
    },
    unread: { type: Map, of: Number, default: () => new Map<string, number>() },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/**
 * Derived rather than passed in, so every create path — the controller, a
 * script, a test fixture — gets a key that matches its participants without
 * having to remember to.
 */
conversationSchema.pre('validate', function derivePairKey() {
  if (this.participants?.length === 2) {
    this.pairKey = pairKeyFor(this.participants[0], this.participants[1]);
  }
});

/**
 * One thread per pair of people. This is the uniqueness rule, and it lives on
 * a scalar field on purpose — see the next index for why it cannot live on
 * `participants`.
 */
conversationSchema.index({ pairKey: 1 }, { unique: true });

/**
 * The inbox query, `find({ participants: me })`. **Not unique, and must never
 * be.**
 *
 * It was, once, on the belief that with the array stored sorted a unique index
 * made each *pair* unique. It does not. An index on an array field has one
 * entry per element, and `unique` applies to each element across documents —
 * so no user id could appear in two conversations. Everyone got exactly one
 * thread, ever, and the first message to a second person failed.
 *
 * ── Changing either index requires a migration ──
 * `autoIndex` is off in production, and MongoDB refuses to redefine an
 * existing index with different options. See
 * `scripts/migrate-conversation-pair-key.ts`.
 */
conversationSchema.index({ participants: 1 });

/** Inbox ordering. */
conversationSchema.index({ lastMessageAt: -1 });

export type ConversationModel = Model<IConversation>;

export const Conversation: ConversationModel = model<IConversation>(
  'Conversation',
  conversationSchema,
);
