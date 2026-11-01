import { Router } from 'express';
import {
  changePassword,
  google,
  login,
  logout,
  me,
  mobileGoogle,
  mobileLogin,
  mobileRefresh,
  mobileSignup,
  signup,
  updateProfile,
} from '../controllers/auth.controller';
import { forgotPassword, resetPassword } from '../controllers/passwordReset.controller';
import { createAuthRateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleSchema,
  loginSchema,
  profileSchema,
  refreshSchema,
  resetPasswordSchema,
  signupSchema,
} from '../validators/auth.validators';

// The only routes reachable without a session: nobody can be logged in before they sign in.
export function createPublicAuthRoutes(authLimit: number): Router {
  const router = Router();
  const limiter = createAuthRateLimiter(authLimit);
  router.post('/signup', limiter, validateBody(signupSchema), signup);
  router.post('/login', limiter, validateBody(loginSchema), login);
  router.post('/google', limiter, validateBody(googleSchema), google);
  router.post('/forgot-password', limiter, validateBody(forgotPasswordSchema), forgotPassword);
  router.post('/reset-password', limiter, validateBody(resetPasswordSchema), resetPassword);
  return router;
}

// The same sign-in for the mobile app, returning tokens instead of setting a cookie.
export function createMobileAuthRoutes(authLimit: number): Router {
  const router = Router();
  const limiter = createAuthRateLimiter(authLimit);
  router.post('/signup', limiter, validateBody(signupSchema), mobileSignup);
  router.post('/login', limiter, validateBody(loginSchema), mobileLogin);
  router.post('/google', limiter, validateBody(googleSchema), mobileGoogle);
  router.post('/refresh', limiter, validateBody(refreshSchema), mobileRefresh);
  router.post('/forgot-password', limiter, validateBody(forgotPasswordSchema), forgotPassword);
  router.post('/reset-password', limiter, validateBody(resetPasswordSchema), resetPassword);
  return router;
}

// Behind requireAuth, so these work with the website's cookie or the app's token.
export function createProtectedAuthRoutes(authLimit: number): Router {
  const router = Router();
  router.get('/me', me);
  router.post('/logout', logout);
  router.patch('/profile', validateBody(profileSchema), updateProfile);
  router.post('/password', createAuthRateLimiter(authLimit), validateBody(changePasswordSchema), changePassword);
  return router;
}
