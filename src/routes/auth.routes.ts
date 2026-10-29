import { Router } from 'express';
import { google, login, logout, me, signup } from '../controllers/auth.controller';
import { createAuthRateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { googleSchema, loginSchema, signupSchema } from '../validators/auth.validators';

// The only routes reachable without a session: nobody can be logged in before they sign in.
export function createPublicAuthRoutes(authLimit: number): Router {
  const router = Router();
  const limiter = createAuthRateLimiter(authLimit);
  router.post('/signup', limiter, validateBody(signupSchema), signup);
  router.post('/login', limiter, validateBody(loginSchema), login);
  router.post('/google', limiter, validateBody(googleSchema), google);
  return router;
}

export function createProtectedAuthRoutes(): Router {
  const router = Router();
  router.get('/me', me);
  router.post('/logout', logout);
  return router;
}
