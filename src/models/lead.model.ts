import { type HydratedDocument, model, Schema, Types } from 'mongoose';

export const LEAD_SOURCES = ['website', 'app'] as const;
export const LEAD_SENDERS = ['customer', 'visitor'] as const;

// One Talk to us form. `submittedBy` comes from the session or token, never from the form, and
// stays "customer" even if that account is deleted later.
export interface Lead {
  name: string;
  role: string;
  email: string;
  phone: string;
  company: string;
  registeredIn: string;
  website: string;
  business: string;
  uses: string[];
  monthlyTotal: string;
  payToday: string;
  channel: string;
  telegram?: string;
  source: (typeof LEAD_SOURCES)[number];
  submittedBy: (typeof LEAD_SENDERS)[number];
  customer?: Types.ObjectId;
  desk: boolean;
  freeEmail: boolean;
}

export type LeadDocument = HydratedDocument<Lead>;

const leadSchema = new Schema<Lead>(
  {
    name: { type: String, required: true },
    role: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    company: { type: String, required: true },
    registeredIn: { type: String, required: true },
    website: { type: String, required: true },
    business: { type: String, required: true },
    uses: { type: [String], required: true },
    monthlyTotal: { type: String, required: true },
    payToday: { type: String, required: true },
    channel: { type: String, required: true },
    telegram: String,
    source: { type: String, enum: LEAD_SOURCES, required: true },
    submittedBy: { type: String, enum: LEAD_SENDERS, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User' },
    desk: { type: Boolean, required: true },
    freeEmail: { type: Boolean, required: true },
  },
  { timestamps: true },
);

export const LeadModel = model<Lead>('Lead', leadSchema);
