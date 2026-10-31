import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

// bcrypt ignores everything past 72 bytes, so longer passwords are refused.
export const newPassword = z
  .string()
  .min(8)
  .refine((value) => Buffer.byteLength(value) <= 72);

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/),
  password: newPassword,
});

export const googleSchema = z.object({
  credential: z.string().min(1).max(4096),
});
