import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

// An empty value in .env counts as not set.
const optional = z
  .string()
  .optional()
  .transform((value) => value || undefined);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  MONGODB_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  FRONTEND_ORIGIN: z.url(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  EMAIL_FROM: optional,
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'] as const) {
    if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Names only: values must never reach the logs.
  const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
  console.error(`Invalid or missing environment variables: ${names.join(', ')}`);
  process.exit(1);
}

export const env = parsed.data;
