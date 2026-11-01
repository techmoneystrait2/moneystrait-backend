import type { Request, RequestHandler } from 'express';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Cookies are sent by the browser automatically, so cookie requests need this check. The app has
// no cookie and no origin: its token is sent on purpose, which is what stops forged requests.
// The admin's website login has no token yet, so it never skips the check.
function isAppRequest(req: Request): boolean {
  if (req.path === '/api/admin/login') return false;
  return req.path.startsWith('/api/mobile/') || req.get('authorization') !== undefined;
}

// CSRF protection: state-changing requests must come from our own site.
export const originCheck: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || req.get('origin') === env.FRONTEND_ORIGIN || isAppRequest(req)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Forbidden.' });
};
