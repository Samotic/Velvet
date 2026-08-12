import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * One directed block: `blockerId` has blocked `blockedId`.
 *
 * A follow system without blocking is a harassment vector, which is why this
 * ships alongside rather than after.
 *
 * Directed, not symmetric, because the two people are not in the same position:
 * only the blocker can lift it. Enforcement checks both directions — neither
 * party may follow the other — but the record of *who acted* has to survive.
 *
 * Blocking is never disclosed. `POST /users/:id/follow` returns a generic
 * refusal either way; saying "you are blocked" confirms the block, which is
 * exactly the information a determined harasser is probing for.
 */

export interface IBlock {
  blockerId: Types.ObjectId;
  blockedId: Types.ObjectId;
  createdAt: Date;
}

const blockSchema = new Schema<IBlock>(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blockedId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** Idempotent: blocking twice is not an error, and cannot duplicate. */
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

/** "Has anyone blocked me?" — the reverse lookup the follow guard needs. */
blockSchema.index({ blockedId: 1, blockerId: 1 });

export type BlockModel = Model<IBlock>;

export const Block: BlockModel = model<IBlock>('Block', blockSchema);
