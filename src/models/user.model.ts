import { type HydratedDocument, model, Schema } from 'mongoose';

export interface User {
  name: string;
  email: string;
  // bcrypt hash; absent on Google accounts until the customer sets one in Settings.
  passwordHash?: string;
  googleId?: string;
  // Raised to end every existing session for this user.
  sessionVersion: number;
}

export type UserDocument = HydratedDocument<User>;

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    googleId: { type: String, unique: true, sparse: true },
    sessionVersion: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const UserModel = model<User>('User', userSchema);
