import rateLimit from 'express-rate-limit';

export function createAuthRateLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  });
}
