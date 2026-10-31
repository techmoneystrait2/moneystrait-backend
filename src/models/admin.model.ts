import { type HydratedDocument, model, Schema } from 'mongoose';

export const ADMIN_ROLES = ['superadmin', 'admin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface Admin {
  username: string;
  passwordHash: string;
  role: AdminRole;
  // Raised to end every existing session for this admin.
  sessionVersion: number;
}

export type AdminDocument = HydratedDocument<Admin>;

const adminSchema = new Schema<Admin>(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, required: true },
    sessionVersion: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const AdminModel = model<Admin>('Admin', adminSchema);
