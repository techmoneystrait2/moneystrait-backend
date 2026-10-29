import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  MONGODB_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  FRONTEND_ORIGIN: z.url(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Names only: values must never reach the logs.
  const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
  console.error(`Invalid or missing environment variables: ${names.join(', ')}`);
  process.exit(1);
}

export const env = parsed.data;
