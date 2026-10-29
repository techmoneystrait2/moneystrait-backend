import type { RequestHandler } from 'express';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF protection: state-changing requests must come from our own site.
export const originCheck: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || req.get('origin') === env.FRONTEND_ORIGIN) {
    next();
    return;
  }
  res.status(403).json({ error: 'Forbidden.' });
};
