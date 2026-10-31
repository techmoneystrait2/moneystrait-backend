import { randomInt } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HttpError } from '../middleware/httpError';
import { PasswordResetModel } from '../models/passwordReset.model';
import { UserModel } from '../models/user.model';
import { isEmailConfigured, sendPasswordResetCode } from '../services/email.service';
import { checkPassword, hashPassword } from '../services/password.service';

const CODE_MINUTES = 5;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const BAD_CODE = 'That code is wrong or has expired. Ask for a new one.';

// Runs after the response, so timing can't reveal whether an account exists.
async function issueCode(email: string): Promise<void> {
  const user = await UserModel.findOne({ email });
  if (!user) return;

  const now = Date.now();
  const previous = await PasswordResetModel.findOne({ user: user.id });
  if (previous && now - previous.sentAt.getTime() < RESEND_SECONDS * 1000) return;

  const code = String(randomInt(100000, 1000000));
  await PasswordResetModel.findOneAndUpdate(
    { user: user.id },
    {
      codeHash: await hashPassword(code),
      expiresAt: new Date(now + CODE_MINUTES * 60 * 1000),
      attempts: 0,
      sentAt: new Date(now),
    },
    { upsert: true },
  );
  await sendPasswordResetCode(user.email, code, CODE_MINUTES);
}

export const forgotPassword: RequestHandler = (req, res) => {
  if (!isEmailConfigured()) throw new HttpError(503, 'Password reset is currently unavailable.');
  issueCode(req.body.email).catch((err: Error) => {
    console.error(`Password reset email failed: ${err.name}`);
  });
  res.json({ minutes: CODE_MINUTES });
};

export const resetPassword: RequestHandler = async (req, res) => {
  const { email, code, password } = req.body;
  const user = await UserModel.findOne({ email });

  // Counts the attempt first, so parallel guesses can't get past the limit.
  const reset = user
    ? await PasswordResetModel.findOneAndUpdate(
        { user: user.id, attempts: { $lt: MAX_ATTEMPTS }, expiresAt: { $gt: new Date() } },
        { $inc: { attempts: 1 } },
      )
    : null;
  const matches = await checkPassword(code, reset?.codeHash);
  if (!user || !reset || !matches) throw new HttpError(400, BAD_CODE);

  await UserModel.updateOne(
    { _id: user.id },
    { $set: { passwordHash: await hashPassword(password) }, $inc: { sessionVersion: 1 } },
  );
  await PasswordResetModel.deleteOne({ user: user.id });
  res.status(204).end();
};
