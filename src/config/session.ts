import MongoStore from 'connect-mongo';
import session from 'express-session';
import { env } from './env';

export const SESSION_COOKIE = 'ms.sid';
const SESSION_MINUTES = 60;

// Rolling, so a session ends after 60 minutes without activity.
export function createSessionMiddleware() {
  return session({
    name: SESSION_COOKIE,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: env.MONGODB_URI,
      ttl: SESSION_MINUTES * 60,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: SESSION_MINUTES * 60 * 1000,
    },
  });
}
