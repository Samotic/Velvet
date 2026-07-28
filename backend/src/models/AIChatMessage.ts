import { Schema, model, type Types, type Model } from 'mongoose';

/**
 * One turn of the AI advisor conversation. Stored per user so history survives
 * reloads, and so each request can replay recent turns to Claude as context.
 *
 * `suggestions` holds the follow-up chips the UI shows under an assistant
 * message; they're derived once at generation time rather than recomputed.
 */
export interface IAIChatMessage {
  userId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  suggestions: string[];
  createdAt: Date;
}

const aiChatMessageSchema = new Schema<IAIChatMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    suggestions: { type: [String], default: [] },
  },
  {
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

/** History replay: this user's turns in order. */
aiChatMessageSchema.index({ userId: 1, createdAt: 1 });

export type AIChatMessageModel = Model<IAIChatMessage>;

export const AIChatMessage: AIChatMessageModel = model<IAIChatMessage>(
  'AIChatMessage',
  aiChatMessageSchema,
);
