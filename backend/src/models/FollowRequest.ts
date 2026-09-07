import { Schema, model, type Types } from 'mongoose';

export const FOLLOW_REQUEST_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type FollowRequestStatus = (typeof FOLLOW_REQUEST_STATUSES)[number];

export interface IFollowRequest {
  from: Types.ObjectId;
  to: Types.ObjectId;
  status: FollowRequestStatus;
  createdAt: Date;
}

// The request shares its id with the corresponding Follow edge. Declined
// requests remain history while their edge is removed, allowing another request.
const schema = new Schema<IFollowRequest>(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: FOLLOW_REQUEST_STATUSES, default: 'pending', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ from: 1, to: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
schema.index({ to: 1, status: 1, createdAt: -1, _id: -1 });

export const FollowRequest = model<IFollowRequest>('FollowRequest', schema);
