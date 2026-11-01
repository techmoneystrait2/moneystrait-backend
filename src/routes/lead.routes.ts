import { type RequestHandler, Router } from 'express';
import { createAppLead, createWebsiteLead, getLeadOptions } from '../controllers/lead.controller';
import { validateBody } from '../middleware/validate';
import { leadSchema } from '../validators/lead.validators';

// Public on purpose: the Talk to us form is for visitors too. It only ever adds a form.
export function createLeadRoutes(limiter: RequestHandler): Router {
  const router = Router();
  router.get('/options', getLeadOptions);
  router.post('/', limiter, validateBody(leadSchema), createWebsiteLead);
  return router;
}

export function createMobileLeadRoutes(limiter: RequestHandler): Router {
  const router = Router();
  router.post('/', limiter, validateBody(leadSchema), createAppLead);
  return router;
}
