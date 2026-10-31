import { z } from 'zod';
import { newPassword } from './auth.validators';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/);

export const adminLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(50),
  password: z.string().min(1).max(200),
});

export const createAdminSchema = z.object({ username, password: newPassword });

export const updateCredentialsSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    username: username.optional(),
    password: newPassword.optional(),
  })
  .refine((body) => body.username !== undefined || body.password !== undefined);
