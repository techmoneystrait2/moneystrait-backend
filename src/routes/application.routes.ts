import { Router } from 'express';
import { answerRfi, getApplicationOptions, getMyApplication, submitApplication } from '../controllers/application.controller';
import { createAuthRateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { applicationSchema, rfiAnswerSchema } from '../validators/application.validators';

// Mounted behind requireAuth: a customer only ever reaches their own application.
export function createApplicationRoutes(submitLimit: number): Router {
  const router = Router();
  router.get('/', getMyApplication);
  router.get('/options', getApplicationOptions);
  router.post('/', createAuthRateLimiter(submitLimit), validateBody(applicationSchema), submitApplication);
  router.post('/rfis/:rfiId', validateBody(rfiAnswerSchema), answerRfi);
  return router;
}
