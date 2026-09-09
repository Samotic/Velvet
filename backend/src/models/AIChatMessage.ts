import { Schema, model, type Types, type Model } from 'mongoose';

import { POSTER_ASPECT, type AdvisorMedia } from '../services/catalogTypes';
import { CONTENT_TYPES } from './User';

/**
 * One turn of the AI advisor conversation. Stored per user so history survives
 * reloads, and so each request can replay recent turns to the model as context.
 *
 * `suggestions` holds the follow-up chips the UI shows under an assistant
 * message; they're derived once at generation time rather than recomputed.
 */
export interface IAIChatMessage {
  userId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  suggestions: string[];
  /**
   * Artwork resolved from the `[[Title]]` markers in `content`.
   *
   * Stored rather than re-resolved on every history read: the catalogue search
   * is cached but not free, and a poster for a title the advisor named three
   * weeks ago should not depend on that title still being findable today.
   * Assistant messages only — a user turn has none.
   */
  media: AdvisorMedia[];
  createdAt: Date;
}

/** Mirrors `AdvisorMedia`. Subdocument with no `_id`: these are values on the
 *  message, not rows anything addresses. */
const mediaSchema = new Schema<AdvisorMedia>(
  {
    contentId: { type: String, required: true },
    contentType: { type: String, enum: CONTENT_TYPES, required: true },
    title: { type: String, default: '' },
    url: { type: String, required: true },
    kind: { type: String, enum: ['poster'], default: 'poster' },
    aspect: { type: Number, default: POSTER_ASPECT },
  },
  { _id: false },
);

const aiChatMessageSchema = new Schema<IAIChatMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    suggestions: { type: [String], default: [] },
    media: { type: [mediaSchema], default: () => [] },
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
