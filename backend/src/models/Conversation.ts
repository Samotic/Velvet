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
 */
export interface IConversation {
  participants: Types.ObjectId[];
  lastMessage: string;
  lastMessageAt: Date | null;
  lastSenderId: Types.ObjectId | null;
  unread: Map<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

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
