import mongoose from 'mongoose';
import { connectDb } from '../config/db';
import { env } from '../config/env';
import { AdminModel } from '../models/admin.model';
import { hashPassword } from '../services/password.service';
import { createAdminSchema } from '../validators/admin.validators';

const WEAK_PASSWORDS = new Set(['12345678', 'password']);

// Creates the one super admin from the environment. Running it again changes nothing.
async function main(): Promise<void> {
  const parsed = createAdminSchema.safeParse({
    username: process.env.SEED_SUPERADMIN_USERNAME,
    password: process.env.SEED_SUPERADMIN_PASSWORD,
  });
  if (!parsed.success) {
    throw new Error('Set a valid SEED_SUPERADMIN_USERNAME and SEED_SUPERADMIN_PASSWORD.');
  }
  const { username, password } = parsed.data;
  if (env.NODE_ENV === 'production' && WEAK_PASSWORDS.has(password)) {
    throw new Error('Refusing to seed a production super admin with a weak password.');
  }

  await connectDb();
  const existing = await AdminModel.findOne({ role: 'superadmin' });
  if (existing) {
    console.log('A super admin already exists. Nothing changed.');
    return;
  }
  await AdminModel.create({ username, passwordHash: await hashPassword(password), role: 'superadmin' });
  console.log(`Super admin "${username}" created.`);
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
