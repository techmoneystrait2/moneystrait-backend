import MongoStore from 'connect-mongo';
import type { RequestHandler } from 'express';
import session from 'express-session';
import { env } from './env';

export const SESSION_COOKIE = 'ms.sid';
export const ADMIN_SESSION_COOKIE = 'ms.admin';
export const ADMIN_COOKIE_PATH = '/api/admin';
const SESSION_MINUTES = 60;
// Browsers cap a cookie at 400 days. Every admin request starts the 400 days again.
export const ADMIN_SESSION_MS = 400 * 24 * 60 * 60 * 1000;

// Rolling, so a customer's session ends after 60 minutes without activity. Admins have their own
// cookie, so a customer logging in or out in the same browser never touches an admin's session.
export function createSessionMiddleware(): RequestHandler {
  const shared = { secret: env.SESSION_SECRET, resave: false, saveUninitialized: false, rolling: true };
  const cookie = { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production' } as const;
  // One store each: express-session writes its cookie settings onto the store it is given.
  const newStore = (ttl: number) => MongoStore.create({ mongoUrl: env.MONGODB_URI, ttl });

  const customerSession = session({
    ...shared,
    name: SESSION_COOKIE,
    store: newStore(SESSION_MINUTES * 60),
    cookie: { ...cookie, maxAge: SESSION_MINUTES * 60 * 1000 },
  });
  const adminSession = session({
    ...shared,
    name: ADMIN_SESSION_COOKIE,
    store: newStore(ADMIN_SESSION_MS / 1000),
    cookie: { ...cookie, path: ADMIN_COOKIE_PATH, maxAge: ADMIN_SESSION_MS },
  });

  return (req, res, next) => (req.path.startsWith(ADMIN_COOKIE_PATH) ? adminSession : customerSession)(req, res, next);
}
