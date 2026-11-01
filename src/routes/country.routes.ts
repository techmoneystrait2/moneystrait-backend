import { Router } from 'express';
import { listLiveCountries } from '../controllers/country.controller';

// Public on purpose: the Countries page shows this list to everyone, and it is read-only.
export function createCountryRoutes(): Router {
  const router = Router();
  router.get('/', listLiveCountries);
  return router;
}
