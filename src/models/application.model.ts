import { type HydratedDocument, model, Schema, Types } from 'mongoose';

// Removed applications are kept for the record, but the customer no longer has them.
export const APPLICATION_STATUSES = ['in_review', 'approved', 'rejected', 'removed'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const RFI_STATUSES = ['waiting', 'answered', 'accepted'] as const;

export interface RfiResponse {
  answer: string;
  answeredAt: Date;
  decision: 'pending' | 'accepted' | 'rejected';
  decidedBy?: string;
  decidedAt?: Date;
}

// A request for information: an admin's question, and every answer the customer gave to it.
export interface Rfi {
  _id: Types.ObjectId;
  question: string;
  askedBy: string;
  askedAt: Date;
  status: (typeof RFI_STATUSES)[number];
  responses: RfiResponse[];
}

export interface Application {
  user: Types.ObjectId;
  status: ApplicationStatus;
  // Validated by applicationSchema before it is stored.
  answers: Record<string, unknown>;
  reviewedAt?: Date;
  // The username, so the record survives if that admin is deleted.
  reviewedBy?: string;
  removedAt?: Date;
  removedBy?: string;
  // Kept once the customer's account is deleted, so the record still says whose it was.
  deletedCustomer?: { name: string; email: string };
  rfis: Rfi[];
}

export type ApplicationDocument = HydratedDocument<Application>;

const rfiResponseSchema = new Schema<RfiResponse>(
  {
    answer: { type: String, required: true },
    answeredAt: { type: Date, required: true },
    decision: { type: String, enum: ['pending', 'accepted', 'rejected'], required: true, default: 'pending' },
    decidedBy: String,
    decidedAt: Date,
  },
  { _id: false },
);

const rfiSchema = new Schema<Rfi>({
  question: { type: String, required: true },
  askedBy: { type: String, required: true },
  askedAt: { type: Date, required: true },
  status: { type: String, enum: RFI_STATUSES, required: true, default: 'waiting' },
  responses: { type: [rfiResponseSchema], default: [] },
});

// Every submission is its own record, so a rejected attempt stays in the history.
const applicationSchema = new Schema<Application>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: APPLICATION_STATUSES, required: true, default: 'in_review' },
    answers: { type: Schema.Types.Mixed, required: true },
    reviewedAt: Date,
    reviewedBy: String,
    removedAt: Date,
    removedBy: String,
    deletedCustomer: { name: String, email: String },
    rfis: { type: [rfiSchema], default: [] },
  },
  { timestamps: true },
);

applicationSchema.index({ user: 1, createdAt: -1 });

// A customer can only ever have one application in review or approved.
applicationSchema.index(
  { user: 1 },
  {
    name: 'one_active_application_per_user',
    unique: true,
    partialFilterExpression: { status: { $in: ['in_review', 'approved'] } },
  },
);

export const ApplicationModel = model<Application>('Application', applicationSchema);
