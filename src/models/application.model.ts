import { type HydratedDocument, model, Schema, Types } from 'mongoose';

// Removed applications are kept for the record, but the customer no longer has them.
export const APPLICATION_STATUSES = ['in_review', 'approved', 'rejected', 'removed'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

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
}

export type ApplicationDocument = HydratedDocument<Application>;

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
