import type { RequestHandler } from 'express';
import { AdminModel, type AdminDocument } from '../models/admin.model';
import { HttpError } from './httpError';

declare module 'express-session' {
  interface SessionData {
    adminId: string;
    adminSessionVersion: number;
  }
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const { adminId, adminSessionVersion } = req.session;
  const admin = adminId ? await AdminModel.findById(adminId) : null;
  if (!admin || admin.sessionVersion !== adminSessionVersion) {
    throw new HttpError(401, 'Log in to continue.');
  }
  res.locals.admin = admin;
  next();
};

export const requireSuperadmin: RequestHandler = (_req, res, next) => {
  const admin: AdminDocument = res.locals.admin;
  if (admin.role !== 'superadmin') throw new HttpError(403, 'Only the super admin can do this.');
  next();
};
