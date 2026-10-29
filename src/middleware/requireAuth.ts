import type { RequestHandler } from 'express';
import { UserModel } from '../models/user.model';
import { HttpError } from './httpError';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    sessionVersion: number;
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const { userId, sessionVersion } = req.session;
  const user = userId ? await UserModel.findById(userId) : null;
  if (!user || user.sessionVersion !== sessionVersion) {
    throw new HttpError(401, 'Log in to continue.');
  }
  res.locals.user = user;
  next();
};
