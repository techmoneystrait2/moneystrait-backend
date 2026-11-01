import { type HydratedDocument, model, Schema, Types } from 'mongoose';

// One admin signed in on the app. Kept apart from customer sessions, so a customer token can
// never be read as an admin one. Tokens are random and stored hashed.
export interface AdminMobileSession {
  admin: Types.ObjectId;
  accessHash: string;
  accessExpiresAt: Date;
  refreshHash: string;
  // The token this one replaced. Seeing it again means a refresh token was stolen.
  previousRefreshHash?: string;
  refreshExpiresAt: Date;
  sessionVersion: number;
}

export type AdminMobileSessionDocument = HydratedDocument<AdminMobileSession>;

const adminMobileSessionSchema = new Schema<AdminMobileSession>(
  {
    admin: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    accessHash: { type: String, required: true, unique: true },
    accessExpiresAt: { type: Date, required: true },
    refreshHash: { type: String, required: true, unique: true },
    previousRefreshHash: { type: String, index: true },
    // MongoDB removes the record soon after this time.
    refreshExpiresAt: { type: Date, required: true, expires: 0 },
    sessionVersion: { type: Number, required: true },
  },
  { timestamps: true },
);

export const AdminMobileSessionModel = model<AdminMobileSession>('AdminMobileSession', adminMobileSessionSchema);
