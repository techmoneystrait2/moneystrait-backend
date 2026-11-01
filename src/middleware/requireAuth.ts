import type { Request, RequestHandler } from 'express';
import { UserModel, type UserDocument } from '../models/user.model';
import { findMobileUser } from '../services/mobileSession.service';
import { HttpError } from './httpError';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    sessionVersion: number;
  }
}

export async function cookieUser(req: Request): Promise<UserDocument | null> {
  const { userId, sessionVersion } = req.session;
  const user = userId ? await UserModel.findById(userId) : null;
  return user?.sessionVersion === sessionVersion ? user : null;
}

// For public routes that want to know who is asking. No header means a visitor. A bad token is
// refused, so the app refreshes it instead of a customer being counted as a visitor.
export async function bearerUser(req: Request): Promise<UserDocument | null> {
  const header = req.get('authorization');
  if (header === undefined) return null;
  const token = /^Bearer ([\w-]+)$/.exec(header)?.[1];
  const found = token ? await findMobileUser(token) : null;
  if (!found) throw new HttpError(401, 'Log in to continue.');
  return found.user;
}

// The website uses its cookie and the app sends a bearer token. Any Authorization header means
// the token alone decides, so a cookie can never rescue a bad one.
export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.get('authorization');
  if (header === undefined) {
    const user = await cookieUser(req);
    if (!user) throw new HttpError(401, 'Log in to continue.');
    res.locals.user = user;
    next();
    return;
  }
  const token = /^Bearer ([\w-]+)$/.exec(header)?.[1];
  const found = token ? await findMobileUser(token) : null;
  if (!found) throw new HttpError(401, 'Log in to continue.');
  res.locals.user = found.user;
  res.locals.mobileSession = found.session;
  next();
};
