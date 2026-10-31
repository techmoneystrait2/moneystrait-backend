import { model, Schema, Types } from 'mongoose';

export interface PasswordReset {
  user: Types.ObjectId;
  // A bcrypt hash: the code itself is never stored.
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  sentAt: Date;
}

const passwordResetSchema = new Schema<PasswordReset>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  codeHash: { type: String, required: true },
  // MongoDB removes the record soon after this time; the code is refused from this moment.
  expiresAt: { type: Date, required: true, expires: 0 },
  attempts: { type: Number, required: true, default: 0 },
  sentAt: { type: Date, required: true },
});

export const PasswordResetModel = model<PasswordReset>('PasswordReset', passwordResetSchema);
