import bcrypt from 'bcrypt';
import type { Request, RequestHandler } from 'express';
import { SESSION_COOKIE } from '../config/session';
import { HttpError } from '../middleware/httpError';
import { UserModel, type UserDocument } from '../models/user.model';
import { type GoogleProfile, verifyGoogleCredential } from '../services/google.service';

const BCRYPT_ROUNDS = 12;

// Compared when no password exists, so response time doesn't reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('moneystrait-timing-placeholder', BCRYPT_ROUNDS);

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

function toPublicUser(user: UserDocument) {
  return { id: user.id, name: user.name, email: user.email };
}

// A new session ID on every sign-in prevents session fixation.
async function startSession(req: Request, user: UserDocument): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.userId = user.id;
  req.session.sessionVersion = user.sessionVersion;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export const signup: RequestHandler = async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const user = await UserModel.create({ name, email, passwordHash });
    await startSession(req, user);
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'Use a different email, or log in.');
    throw err;
  }
};

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body;
  const user = await UserModel.findOne({ email }).select('+passwordHash');
  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user?.passwordHash || !matches) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  await startSession(req, user);
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
  await startSession(req, user);
  res.json({ user: toPublicUser(user) });
};

export const me: RequestHandler = (_req, res) => {
  res.json({ user: toPublicUser(res.locals.user) });
};

export const logout: RequestHandler = async (req, res) => {
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
};
