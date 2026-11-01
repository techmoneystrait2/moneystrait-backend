import type { Request, RequestHandler, Response } from 'express';
import { SESSION_COOKIE } from '../config/session';
import { HttpError } from '../middleware/httpError';
import { UserModel, type UserDocument } from '../models/user.model';
import { type GoogleProfile, verifyGoogleCredential } from '../services/google.service';
import {
  endAllMobileSessions,
  endMobileSession,
  refreshMobileSession,
  startMobileSession,
} from '../services/mobileSession.service';
import { checkPassword, hashPassword } from '../services/password.service';
import { endSession, saveSession, startSession } from '../services/session.service';

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

function toPublicUser(user: UserDocument) {
  return { id: user.id, name: user.name, email: user.email };
}

// How a signed-in customer is handed their login: a cookie for the website, tokens for the app.
type Deliver = (req: Request, res: Response, user: UserDocument, status: number) => Promise<void>;

const deliverCookie: Deliver = async (req, res, user, status) => {
  await startSession(req, { userId: user.id, sessionVersion: user.sessionVersion });
  res.status(status).json({ user: toPublicUser(user) });
};

const deliverTokens: Deliver = async (_req, res, user, status) => {
  const tokens = await startMobileSession(user);
  res.status(status).json({ user: toPublicUser(user), ...tokens });
};

function signupWith(deliver: Deliver): RequestHandler {
  return async (req, res) => {
    const { name, email, password } = req.body;
    const passwordHash = await hashPassword(password);
    try {
      const user = await UserModel.create({ name, email, passwordHash });
      await deliver(req, res, user, 201);
    } catch (err) {
      if (isDuplicateKey(err)) throw new HttpError(409, 'Use a different email, or log in.');
      throw err;
    }
  };
}

function loginWith(deliver: Deliver): RequestHandler {
  return async (req, res) => {
    const { email, password } = req.body;
    const user = await UserModel.findOne({ email }).select('+passwordHash');
    const matches = await checkPassword(password, user?.passwordHash);
    if (!user?.passwordHash || !matches) {
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    await deliver(req, res, user, 200);
  };
}

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
  await endAllMobileSessions(linked.id);
  return linked;
}

function googleWith(deliver: Deliver): RequestHandler {
  return async (req, res) => {
    const profile = await verifyGoogleCredential(req.body.credential);
    if (!profile?.emailVerified) throw new HttpError(401, 'Google sign-in failed.');
    const user = await findOrCreateGoogleUser(profile);
    await deliver(req, res, user, 200);
  };
}

export const signup = signupWith(deliverCookie);
export const login = loginWith(deliverCookie);
export const google = googleWith(deliverCookie);

export const mobileSignup = signupWith(deliverTokens);
export const mobileLogin = loginWith(deliverTokens);
export const mobileGoogle = googleWith(deliverTokens);

export const mobileRefresh: RequestHandler = async (req, res) => {
  const tokens = await refreshMobileSession(req.body.refreshToken);
  if (!tokens) throw new HttpError(401, 'Log in to continue.');
  res.json(tokens);
};

export const me: RequestHandler = async (_req, res) => {
  const user: UserDocument = res.locals.user;
  const hasPassword = await UserModel.exists({ _id: user.id, passwordHash: { $exists: true } });
  res.json({ user: { ...toPublicUser(user), hasPassword: Boolean(hasPassword) } });
};

export const updateProfile: RequestHandler = async (req, res) => {
  const user: UserDocument = res.locals.user;
  user.name = req.body.name;
  await user.save();
  res.json({ user: toPublicUser(user) });
};

// Ends the customer's other sessions; this one carries on with the new version.
async function keepOnlyThisSession(req: Request, res: Response, user: UserDocument): Promise<void> {
  const mobileSession = res.locals.mobileSession;
  await endAllMobileSessions(user.id, mobileSession);
  if (mobileSession) {
    mobileSession.sessionVersion = user.sessionVersion;
    await mobileSession.save();
  } else {
    req.session.sessionVersion = user.sessionVersion;
    await saveSession(req);
  }
}

export const changePassword: RequestHandler = async (req, res) => {
  const { currentPassword, password } = req.body;
  const user = await UserModel.findById(res.locals.user.id).select('+passwordHash');
  if (!user?.passwordHash || !(await checkPassword(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Your current password is incorrect.');
  }
  user.passwordHash = await hashPassword(password);
  user.sessionVersion += 1;
  await user.save();
  await keepOnlyThisSession(req, res, user);
  res.status(204).end();
};

// For Google accounts, which start with no password. Matches only while there is none, so this
// can never replace a password without the current one.
export const setPassword: RequestHandler = async (req, res) => {
  const user = await UserModel.findOneAndUpdate(
    { _id: res.locals.user.id, passwordHash: { $exists: false } },
    { $set: { passwordHash: await hashPassword(req.body.password) }, $inc: { sessionVersion: 1 } },
    { returnDocument: 'after' },
  );
  if (!user) throw new HttpError(409, 'You already have a password. Use your current password to change it.');
  await keepOnlyThisSession(req, res, user);
  res.status(204).end();
};

export const logout: RequestHandler = async (req, res) => {
  if (res.locals.mobileSession) {
    await endMobileSession(res.locals.mobileSession);
    res.status(204).end();
    return;
  }
  await endSession(req);
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
};
