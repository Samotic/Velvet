import { Schema, Types, model, type Model, type FilterQuery } from 'mongoose';

import { MAX_MESSAGE_LENGTH } from '../config/messaging';

/**
 * The three things a message can be.
 *
 * `kind` is stored rather than inferred from which fields are populated: a
 * renderer that branches on `mediaUrl != null` has to guess whether a URL is a
 * photo or a voice note, and every future kind makes that guess worse.
 */
export const MESSAGE_KINDS = ['text', 'image', 'audio'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** One superseded version of a message body, kept so an edit is auditable. */
export interface IMessageEdit {
  text: string;
  editedAt: Date;
}

/** How many past versions `editHistory` keeps. The oldest are dropped first. */
export const EDIT_HISTORY_LIMIT = 10;

/**
 * One direct message: text, a photo, or a voice note.
 *
 * Media is never stored here — only the Cloudinary URL it was uploaded to.
 * Mongo holds the record of the conversation, not the bytes of it.
 *
 * Deletion is two different operations and they are stored differently.
 * `deletedFor` hides a message from one reader and is invisible to the other.
 * `deletedForEveryone` is a **tombstone**: the document is kept so the other
 * client's cached list and the unread counters stay coherent, but `text`,
 * `mediaUrl` and `editHistory` are genuinely cleared — a retracted message
 * must not survive in the database in any readable form.
 */
export interface IMessage {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  kind: MessageKind;
  /** The body for `kind: 'text'`. Empty string on a media message. */
  text: string;
  /** Cloudinary secure URL. Null on a text message. */
  mediaUrl: string | null;
  /**
   * The Cloudinary `public_id` of the asset, so it can be destroyed when the
   * message is. Recorded from the **upload response** — the uploaders still
   * pass no `public_id` of their own, because a deterministic one would make
   * each new photo overwrite the last. Null on text, and null on media sent
   * before this field existed; `derivePublicId` covers that case.
   */
  mediaPublicId: string | null;
  /**
   * The Cloudinary resource type the asset lives under. Audio is uploaded as
   * `'video'` — Cloudinary has no audio bucket — so destroying it with a
   * hardcoded `'image'` silently no-ops. Stored rather than guessed.
   */
  mediaResourceType: string | null;
  /** Seconds, for `kind: 'audio'` — taken from Cloudinary, not the client. */
  mediaDuration: number | null;
  /** Natural pixel size, for `kind: 'image'`, so the bubble can reserve the
   *  right box before the image loads and the log does not jump. */
  mediaWidth: number | null;
  mediaHeight: number | null;
  read: boolean;
  /** When the body was last edited. Null means never edited. */
  editedAt: Date | null;
  /** Previous bodies, oldest first, capped at `EDIT_HISTORY_LIMIT`. */
  editHistory: IMessageEdit[];
  /** The tombstone flag. True means the content has been cleared. */
  deletedForEveryone: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  /** Readers who have hidden this message. Per-user, invisible to the other. */
  deletedFor: Types.ObjectId[];
  createdAt: Date;
}

const editSchema = new Schema<IMessageEdit>(
  {
    text: { type: String, default: '' },
    editedAt: { type: Date, required: true },
  },
  { _id: false },
);

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
    kind: { type: String, enum: MESSAGE_KINDS, default: 'text', required: true },
    /**
     * Required only for a text message that is still standing. A photo carries
     * no caption in this build, so demanding text here would make every media
     * send fail validation — but leaving it optional for text would let an
     * empty bubble through, which is why the requirement is conditional
     * rather than dropped.
     *
     * `deletedForEveryone` is the third case: a tombstone has had its body
     * cleared on purpose, so the requirement must stand down for it, or the
     * delete would fail the validation it triggers.
     */
    text: {
      type: String,
      maxlength: MAX_MESSAGE_LENGTH,
      trim: true,
      default: '',
      required: [
        function (this: IMessage) {
          return this.kind === 'text' && !this.deletedForEveryone;
        },
        'A text message needs text.',
      ],
    },
    /** The mirror of the above: standing media kinds must carry a URL. */
    mediaUrl: {
      type: String,
      default: null,
      required: [
        function (this: IMessage) {
          return this.kind !== 'text' && !this.deletedForEveryone;
        },
        'A media message needs a URL.',
      ],
    },
    mediaPublicId: { type: String, default: null },
    mediaResourceType: { type: String, default: null },
    mediaDuration: { type: Number, default: null, min: 0 },
    mediaWidth: { type: Number, default: null, min: 0 },
    mediaHeight: { type: Number, default: null, min: 0 },
    read: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    editHistory: { type: [editSchema], default: () => [] },
    deletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedFor: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: () => [],
    },
  },
  {
    /**
     * `updatedAt` stays off. An edit records its own `editedAt` and a delete
     * its own `deletedAt`; a third machine-managed timestamp would be a fourth
     * answer to "when did this change" with no reader.
     */
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        /**
         * These never leave the server. `editHistory` holds the sender's own
         * superseded drafts, which the recipient has no business reading, and
         * `deletedFor` would tell each participant what the other has hidden —
         * the one thing a per-user hide must not leak.
         */
        delete ret.editHistory;
        delete ret.deletedFor;
        /** Internal handles for cleanup, not something a client can use. */
        delete ret.mediaPublicId;
        delete ret.mediaResourceType;
        return ret;
      },
    },
  },
);

/** The thread view: one conversation's messages in order. */
messageSchema.index({ conversationId: 1, createdAt: 1 });
/** The unread badge: count where I am the receiver and it is unread. */
messageSchema.index({ receiverId: 1, read: 1 });
/** Multikey, for the `$ne` every read path applies to hide per-user deletes. */
messageSchema.index({ deletedFor: 1 });

export interface MessageModel extends Model<IMessage> {
  /**
   * The filter fragment that hides what this reader has deleted for themselves.
   *
   * Returned as a fragment rather than a finished query so it composes with
   * whatever else the caller filters on:
   *
   *     Message.find({ conversationId, ...Message.visibleTo(me) })
   *
   * It exists so the rule lives in exactly one place. Spread it into **every**
   * read path — thread, inbox, unread count, search — because a path that
   * forgets it resurrects a message the user deliberately hid.
   */
  visibleTo(userId: Types.ObjectId | string): FilterQuery<IMessage>;
}

messageSchema.statics.visibleTo = function (
  userId: Types.ObjectId | string,
): FilterQuery<IMessage> {
  return { deletedFor: { $ne: new Types.ObjectId(String(userId)) } };
};

export const Message = model<IMessage, MessageModel>('Message', messageSchema);
