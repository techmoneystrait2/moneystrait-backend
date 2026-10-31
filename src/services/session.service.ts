import type { Request } from 'express';
import type { SessionData } from 'express-session';

// A new session ID on every sign-in prevents session fixation.
export async function startSession(req: Request, values: Partial<SessionData>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  Object.assign(req.session, values);
  await saveSession(req);
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export function endSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
