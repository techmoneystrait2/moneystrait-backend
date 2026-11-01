import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { createSessionMiddleware } from './config/session';
import { errorHandler, notFound } from './middleware/errorHandler';
import { originCheck } from './middleware/originCheck';
import { requireAuth } from './middleware/requireAuth';
import { createAdminRoutes } from './routes/admin.routes';
import { createApplicationRoutes } from './routes/application.routes';
import { createMobileAuthRoutes, createProtectedAuthRoutes, createPublicAuthRoutes } from './routes/auth.routes';

const DEFAULT_AUTH_LIMIT = 10;

export function createApp({ authLimit = DEFAULT_AUTH_LIMIT } = {}) {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(helmet());
  app.use(originCheck);
  app.use(express.json({ limit: '50kb' }));
  app.use(createSessionMiddleware());

  app.use('/api/auth', createPublicAuthRoutes(authLimit));
  app.use('/api/mobile/auth', createMobileAuthRoutes(authLimit));
  app.use('/api/admin', createAdminRoutes(authLimit));

  // Deny by default: everything below this line needs a valid session, including unknown paths.
  app.use(requireAuth);
  app.use('/api/auth', createProtectedAuthRoutes(authLimit));
  app.use('/api/application', createApplicationRoutes(authLimit));
  app.use(notFound);

  app.use(errorHandler);
  return app;
}
