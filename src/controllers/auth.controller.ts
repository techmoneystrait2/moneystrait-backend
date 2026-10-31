import type { RequestHandler } from 'express';
import { SESSION_COOKIE } from '../config/session';
import { HttpError } from '../middleware/httpError';
import { UserModel, type UserDocument } from '../models/user.model';
import { type GoogleProfile, verifyGoogleCredential } from '../services/google.service';
import { checkPassword, hashPassword } from '../services/password.service';
import { endSession, startSession } from '../services/session.service';

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

function toPublicUser(user: UserDocument) {
  return { id: user.id, name: user.name, email: user.email };
}

function sessionFor(user: UserDocument) {
  return { userId: user.id as string, sessionVersion: user.sessionVersion };
}

export const signup: RequestHandler = async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await hashPassword(password);
  try {
    const user = await UserModel.create({ name, email, passwordHash });
    await startSession(req, sessionFor(user));
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'Use a different email, or log in.');
    throw err;
  }
};

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body;
  const user = await UserModel.findOne({ email }).select('+passwordHash');
  const matches = await checkPassword(password, user?.passwordHash);
  if (!user?.passwordHash || !matches) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  await startSession(req, sessionFor(user));
  res.json({ user: toPublicUser(user) });
};

async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<UserDocument> {
  const { googleId, email, name } = profile;
  const byGoogleId = await UserModel.findOne({ googleId });
  if (byGoogleId) return byGoogleId;

  const byEmail = await UserModel.findOne({ email });
  if (!byEmail) return UserModel.create({ name, email, googleId });

  // Password signups don't prove the email, so someone else may have registered it first.
  // Google has proved it, so remove that password and end that account's sessions.
  const linked = await UserModel.findByIdAndUpdate(
    byEmail.id,
    { $set: { googleId }, $unset: { passwordHash: 1 }, $inc: { sessionVersion: 1 } },
    { returnDocument: 'after' },
  );
  if (!linked) throw new HttpError(409, 'Try again.');
  return linked;
}

export const google: RequestHandler = async (req, res) => {
  const profile = await verifyGoogleCredential(req.body.credential);
  if (!profile?.emailVerified) throw new HttpError(401, 'Google sign-in failed.');
  const user = await findOrCreateGoogleUser(profile);
  await startSession(req, sessionFor(user));
  res.json({ user: toPublicUser(user) });
};

export const me: RequestHandler = (_req, res) => {
  res.json({ user: toPublicUser(res.locals.user) });
};

export const logout: RequestHandler = async (req, res) => {
  await endSession(req);
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
};
