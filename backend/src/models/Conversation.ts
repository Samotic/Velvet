import { Schema, model, type Types, type Model } from 'mongoose';

/**
 * A two-person thread. Exists so the inbox is one query instead of an
 * aggregation over every message.
 *
 * `participants` is stored **sorted by id string** so the pair is a stable key
 * and a unique index can prevent duplicate threads for the same two people —
 * see `conversationFor()` in the controller.
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
        validator: (v: Types.ObjectId[]) => v.length === 2,
        message: 'A conversation has exactly two participants.',
      },
    },
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

/** With participants always sorted, this makes the pair unique. */
conversationSchema.index({ participants: 1 }, { unique: true });
/** Inbox ordering. */
conversationSchema.index({ lastMessageAt: -1 });

export type ConversationModel = Model<IConversation>;

export const Conversation: ConversationModel = model<IConversation>(
  'Conversation',
  conversationSchema,
);
