import { type HydratedDocument, model, Schema, Types } from 'mongoose';

// One signed-in device. Tokens are random and stored hashed, so a database leak exposes none,
// and deleting this record logs the device out at once.
export interface MobileSession {
  user: Types.ObjectId;
  accessHash: string;
  accessExpiresAt: Date;
  refreshHash: string;
  // The token this one replaced. Seeing it again means a refresh token was stolen.
  previousRefreshHash?: string;
  refreshExpiresAt: Date;
  sessionVersion: number;
}

export type MobileSessionDocument = HydratedDocument<MobileSession>;

const mobileSessionSchema = new Schema<MobileSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
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

export const MobileSessionModel = model<MobileSession>('MobileSession', mobileSessionSchema);
