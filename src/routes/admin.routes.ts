import { Router } from 'express';
import {
  adminLogin,
  adminLogout,
  adminMe,
  createAdmin,
  deleteAdmin,
  deleteCustomer,
  listAdmins,
  listCustomers,
  overview,
  updateCredentials,
} from '../controllers/admin.controller';
import {
  approveApplication,
  deleteApplicationForever,
  getApplication,
  listApplications,
  rejectApplication,
  removeApplication,
  restoreApplication,
} from '../controllers/adminApplication.controller';
import { notFound } from '../middleware/errorHandler';
import { createAuthRateLimiter } from '../middleware/rateLimiter';
import { requireAdmin, requireSuperadmin } from '../middleware/requireAdmin';
import { validateBody } from '../middleware/validate';
import {
  adminLoginSchema,
  createAdminSchema,
  updateCredentialsSchema,
} from '../validators/admin.validators';

export function createAdminRoutes(authLimit: number): Router {
  const router = Router();
  router.post('/login', createAuthRateLimiter(authLimit), validateBody(adminLoginSchema), adminLogin);

  // Deny by default: every route below needs an admin session.
  router.use(requireAdmin);
  router.get('/me', adminMe);
  router.post('/logout', adminLogout);
  router.get('/overview', overview);
  router.get('/customers', listCustomers);
  router.get('/admins', listAdmins);
  router.get('/applications', listApplications);
  router.get('/applications/:id', getApplication);
  router.post('/applications/:id/approve', approveApplication);
  router.post('/applications/:id/reject', rejectApplication);
  router.delete('/applications/:id', removeApplication);
  router.post('/applications/:id/restore', restoreApplication);
  router.delete('/applications/:id/permanent', deleteApplicationForever);
  router.delete('/customers/:id', deleteCustomer);

  router.post('/admins', requireSuperadmin, validateBody(createAdminSchema), createAdmin);
  router.delete('/admins/:id', requireSuperadmin, deleteAdmin);
  router.patch('/credentials', requireSuperadmin, validateBody(updateCredentialsSchema), updateCredentials);

  router.use(notFound);
  return router;
}
