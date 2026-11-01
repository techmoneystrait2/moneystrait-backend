import type { Request, RequestHandler } from 'express';
import { AdminModel, type AdminDocument } from '../models/admin.model';
import { findMobileAdmin } from '../services/adminMobileSession.service';
import { HttpError } from './httpError';

declare module 'express-session' {
  interface SessionData {
    adminId: string;
    adminSessionVersion: number;
  }
}

async function cookieAdmin(req: Request): Promise<AdminDocument | null> {
  const { adminId, adminSessionVersion } = req.session;
  const admin = adminId ? await AdminModel.findById(adminId) : null;
  return admin?.sessionVersion === adminSessionVersion ? admin : null;
}

// The website uses its cookie and the app sends a bearer token. Any Authorization header means
// the token alone decides, so a cookie can never rescue a bad one. Customer tokens live in a
// separate collection, so they are never found here.
export const requireAdmin: RequestHandler = async (req, res, next) => {
  const header = req.get('authorization');
  if (header === undefined) {
    const admin = await cookieAdmin(req);
    if (!admin) throw new HttpError(401, 'Log in to continue.');
    res.locals.admin = admin;
    next();
    return;
  }
  const token = /^Bearer ([\w-]+)$/.exec(header)?.[1];
  const found = token ? await findMobileAdmin(token) : null;
  if (!found) throw new HttpError(401, 'Log in to continue.');
  res.locals.admin = found.admin;
  res.locals.adminMobileSession = found.session;
  next();
};

export const requireSuperadmin: RequestHandler = (_req, res, next) => {
  const admin: AdminDocument = res.locals.admin;
  if (admin.role !== 'superadmin') throw new HttpError(403, 'Only the super admin can do this.');
  next();
};
