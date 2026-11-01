import { ADMIN_SESSION_MS } from '../config/session';
import { AdminModel, type AdminDocument } from '../models/admin.model';
import { type AdminMobileSessionDocument, AdminMobileSessionModel } from '../models/adminMobileSession.model';
import { hash, newTokens } from './mobileSession.service';

// The same as the website: an admin stays logged in until they log out. Each refresh starts it again.
const REFRESH_MS = ADMIN_SESSION_MS;

export async function startAdminMobileSession(admin: AdminDocument) {
  const { tokens, stored } = newTokens(REFRESH_MS);
  await AdminMobileSessionModel.create({ ...stored, admin: admin.id, sessionVersion: admin.sessionVersion });
  return tokens;
}

// Null unless the token is live and the admin still exists at the same session version.
export async function findMobileAdmin(accessToken: string) {
  const session = await AdminMobileSessionModel.findOne({
    accessHash: hash(accessToken),
    accessExpiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const admin = await AdminModel.findById(session.admin);
  if (!admin || admin.sessionVersion !== session.sessionVersion) return null;
  return { admin, session };
}

// Each refresh token works once. Reusing an old one ends the session, in case it was stolen.
export async function refreshAdminMobileSession(refreshToken: string) {
  const presented = hash(refreshToken);
  const { tokens, stored } = newTokens(REFRESH_MS);
  const session = await AdminMobileSessionModel.findOneAndUpdate(
    { refreshHash: presented, refreshExpiresAt: { $gt: new Date() } },
    { $set: { ...stored, previousRefreshHash: presented } },
  );
  if (!session) {
    await AdminMobileSessionModel.deleteOne({ previousRefreshHash: presented });
    return null;
  }
  const admin = await AdminModel.findById(session.admin);
  if (!admin || admin.sessionVersion !== session.sessionVersion) {
    await AdminMobileSessionModel.deleteOne({ _id: session.id });
    return null;
  }
  return tokens;
}

export async function endAdminMobileSession(session: AdminMobileSessionDocument): Promise<void> {
  await session.deleteOne();
}

export async function endAllAdminMobileSessions(adminId: string, except?: AdminMobileSessionDocument): Promise<void> {
  await AdminMobileSessionModel.deleteMany({ admin: adminId, ...(except && { _id: { $ne: except.id } }) });
}
