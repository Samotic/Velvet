import { Schema, model, type Types, type Model } from 'mongoose';

/** One text message. Text only — no media, per the spec. */
export interface IMessage {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  text: string;
  read: boolean;
  createdAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 2000, trim: true },
    read: { type: Boolean, default: false },
  },
  {
    // Messages are immutable once sent apart from `read`, so only createdAt.
    timestamps: { createdAt: true, updatedAt: false },
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

/** The thread view: one conversation's messages in order. */
messageSchema.index({ conversationId: 1, createdAt: 1 });
/** The unread badge: count where I'm the receiver and it's unread. */
messageSchema.index({ receiverId: 1, read: 1 });

export type MessageModel = Model<IMessage>;

export const Message: MessageModel = model<IMessage>('Message', messageSchema);
