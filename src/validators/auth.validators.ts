import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  // bcrypt ignores everything past 72 bytes, so longer passwords are refused.
  password: z
    .string()
    .min(12)
    .refine((value) => Buffer.byteLength(value) <= 72),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const googleSchema = z.object({
  credential: z.string().min(1).max(4096),
});
