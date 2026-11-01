import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { SESSION_COOKIE } from '../config/session';
import { HttpError } from '../middleware/httpError';
import { AdminModel, type AdminDocument } from '../models/admin.model';
import type { AdminMobileSessionDocument } from '../models/adminMobileSession.model';
import { ApplicationModel } from '../models/application.model';
import { PasswordResetModel } from '../models/passwordReset.model';
import { UserModel } from '../models/user.model';
import {
  endAdminMobileSession,
  endAllAdminMobileSessions,
  refreshAdminMobileSession,
  startAdminMobileSession,
} from '../services/adminMobileSession.service';
import { notifyAccountDeleted } from '../services/email.service';
import { endAllMobileSessions } from '../services/mobileSession.service';
import { checkPassword, hashPassword } from '../services/password.service';
import { endSession, saveSession, startSession } from '../services/session.service';
import { toApplicationDetail } from './adminApplication.controller';

const PAGE_SIZE = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

function toPublicAdmin(admin: AdminDocument) {
  return {
    id: admin.id,
    username: admin.username,
    role: admin.role,
    createdAt: (admin as unknown as { createdAt: Date }).createdAt,
  };
}

interface CustomerRow {
  _id: unknown;
  name: string;
  email: string;
  passwordHash?: string;
  googleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// The hash is read only to report how the customer signs in; it never leaves this function.
function toCustomer(user: CustomerRow) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    signIn: user.googleId && user.passwordHash ? 'Google and password' : user.googleId ? 'Google' : user.passwordHash ? 'Password' : 'None',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function findCustomers(filter: object) {
  return UserModel.find(filter).select('+passwordHash').sort({ createdAt: -1 }).lean<CustomerRow[]>();
}

async function checkAdminLogin(username: string, password: string): Promise<AdminDocument> {
  const admin = await AdminModel.findOne({ username }).select('+passwordHash');
  const matches = await checkPassword(password, admin?.passwordHash);
  if (!admin || !matches) throw new HttpError(401, 'Username or password is incorrect.');
  return admin;
}

export function nameOrEmailFilter(query: unknown) {
  const search = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  // Escaped, so a search is plain text and never a pattern.
  const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return pattern ? { $or: [{ name: { $regex: pattern, $options: 'i' } }, { email: { $regex: pattern, $options: 'i' } }] } : {};
}

export const adminLogin: RequestHandler = async (req, res) => {
  const admin = await checkAdminLogin(req.body.username, req.body.password);
  await startSession(req, { adminId: admin.id, adminSessionVersion: admin.sessionVersion });
  res.json({ admin: toPublicAdmin(admin) });
};

export const mobileAdminLogin: RequestHandler = async (req, res) => {
  const admin = await checkAdminLogin(req.body.username, req.body.password);
  res.json({ admin: toPublicAdmin(admin), ...(await startAdminMobileSession(admin)) });
};

export const mobileAdminRefresh: RequestHandler = async (req, res) => {
  const tokens = await refreshAdminMobileSession(req.body.refreshToken);
  if (!tokens) throw new HttpError(401, 'Log in to continue.');
  res.json(tokens);
};

export const adminLogout: RequestHandler = async (req, res) => {
  const session: AdminMobileSessionDocument | undefined = res.locals.adminMobileSession;
  if (session) {
    await endAdminMobileSession(session);
  } else {
    await endSession(req);
    res.clearCookie(SESSION_COOKIE);
  }
  res.status(204).end();
};

export const adminMe: RequestHandler = (_req, res) => {
  res.json({ admin: toPublicAdmin(res.locals.admin) });
};

export const overview: RequestHandler = async (_req, res) => {
  const [applicationsInReview, customers, newThisWeek, passwordAccounts, googleAccounts, admins, activeSessions, recent] =
    await Promise.all([
      ApplicationModel.countDocuments({ status: 'in_review' }),
      UserModel.countDocuments(),
      UserModel.countDocuments({ createdAt: { $gte: new Date(Date.now() - WEEK_MS) } }),
      UserModel.countDocuments({ passwordHash: { $exists: true } }),
      UserModel.countDocuments({ googleId: { $exists: true } }),
      AdminModel.countDocuments(),
      mongoose.connection.collection('sessions').countDocuments(),
      findCustomers({}).limit(5),
    ]);
  res.json({
    stats: { applicationsInReview, customers, newThisWeek, passwordAccounts, googleAccounts, admins, activeSessions },
    recentCustomers: recent.map(toCustomer),
  });
};

export const listCustomers: RequestHandler = async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page), 10) || 1);
  const filter = nameOrEmailFilter(req.query.search);
  const [total, customers] = await Promise.all([
    UserModel.countDocuments(filter),
    findCustomers(filter)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
  ]);
  res.json({
    customers: customers.map(toCustomer),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  });
};

export const getCustomer: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Customer not found.');
  const user = await UserModel.findById(id).select('+passwordHash').lean<CustomerRow | null>();
  if (!user) throw new HttpError(404, 'Customer not found.');
  const applications = await ApplicationModel.find({ user: id }).populate('user', 'name email').sort({ createdAt: -1 });
  res.json({ customer: toCustomer(user), applications: applications.map(toApplicationDetail) });
};

export const deleteCustomer: RequestHandler = async (req, res) => {
  const admin: AdminDocument = res.locals.admin;
  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Customer not found.');
  const user = await UserModel.findById(id);
  if (!user) throw new HttpError(404, 'Customer not found.');
  const { name, email } = user;

  // Applications stay for compliance, with a note of whose they were.
  await ApplicationModel.updateMany({ user: id }, { deletedCustomer: { name, email } });
  await ApplicationModel.updateMany(
    { user: id, status: { $ne: 'removed' } },
    { status: 'removed', removedAt: new Date(), removedBy: admin.username },
  );
  await PasswordResetModel.deleteMany({ user: id });
  await endAllMobileSessions(id);
  // Their web sessions stop working because requireAuth can no longer find the account.
  await user.deleteOne();

  res.json({ emailSent: await notifyAccountDeleted(email) });
};

export const listAdmins: RequestHandler = async (_req, res) => {
  const admins = await AdminModel.find().sort({ createdAt: 1 });
  res.json({ admins: admins.map(toPublicAdmin) });
};

export const createAdmin: RequestHandler = async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await AdminModel.create({
      username,
      passwordHash: await hashPassword(password),
      role: 'admin',
    });
    res.status(201).json({ admin: toPublicAdmin(admin) });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'That username is taken.');
    throw err;
  }
};

export const deleteAdmin: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Admin not found.');
  const target = await AdminModel.findById(id);
  if (!target) throw new HttpError(404, 'Admin not found.');
  if (target.role !== 'admin') throw new HttpError(403, 'The super admin can’t be deleted.');
  // Their web sessions stop working because requireAdmin can no longer find the account.
  await endAllAdminMobileSessions(id);
  await target.deleteOne();
  res.status(204).end();
};

export const updateCredentials: RequestHandler = async (req, res) => {
  const { currentPassword, username, password } = req.body;
  const admin = await AdminModel.findById(res.locals.admin.id).select('+passwordHash');
  if (!admin || !(await checkPassword(currentPassword, admin.passwordHash))) {
    throw new HttpError(401, 'Your current password is incorrect.');
  }
  if (username) admin.username = username;
  if (password) admin.passwordHash = await hashPassword(password);
  // Ends the admin's other sessions; this one carries on with the new version.
  admin.sessionVersion += 1;
  try {
    await admin.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'That username is taken.');
    throw err;
  }
  const session: AdminMobileSessionDocument | undefined = res.locals.adminMobileSession;
  await endAllAdminMobileSessions(admin.id, session);
  if (session) {
    session.sessionVersion = admin.sessionVersion;
    await session.save();
  } else {
    req.session.adminSessionVersion = admin.sessionVersion;
    await saveSession(req);
  }
  res.json({ admin: toPublicAdmin(admin) });
};
