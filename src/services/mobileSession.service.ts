import { createHash, randomBytes } from 'node:crypto';
import { MobileSessionModel, type MobileSessionDocument } from '../models/mobileSession.model';
import { UserModel, type UserDocument } from '../models/user.model';

const ACCESS_MINUTES = 15;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function newTokens(refreshMs: number = REFRESH_MS) {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  return {
    tokens: { accessToken, refreshToken, expiresIn: ACCESS_MINUTES * 60 },
    stored: {
      accessHash: hash(accessToken),
      accessExpiresAt: new Date(now + ACCESS_MINUTES * 60 * 1000),
      refreshHash: hash(refreshToken),
      refreshExpiresAt: new Date(now + refreshMs),
    },
  };
}

export async function startMobileSession(user: UserDocument) {
  const { tokens, stored } = newTokens();
  await MobileSessionModel.create({ ...stored, user: user.id, sessionVersion: user.sessionVersion });
  return tokens;
}

// Null unless the token is live and the account still exists at the same session version.
export async function findMobileUser(accessToken: string) {
  const session = await MobileSessionModel.findOne({
    accessHash: hash(accessToken),
    accessExpiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await UserModel.findById(session.user);
  if (!user || user.sessionVersion !== session.sessionVersion) return null;
  return { user, session };
}

// Each refresh token works once. Reusing an old one ends the session, in case it was stolen.
export async function refreshMobileSession(refreshToken: string) {
  const presented = hash(refreshToken);
  const { tokens, stored } = newTokens();
  const session = await MobileSessionModel.findOneAndUpdate(
    { refreshHash: presented, refreshExpiresAt: { $gt: new Date() } },
    { $set: { ...stored, previousRefreshHash: presented } },
  );
  if (!session) {
    await MobileSessionModel.deleteOne({ previousRefreshHash: presented });
    return null;
  }
  const user = await UserModel.findById(session.user);
  if (!user || user.sessionVersion !== session.sessionVersion) {
    await MobileSessionModel.deleteOne({ _id: session.id });
    return null;
  }
  return tokens;
}

export async function endMobileSession(session: MobileSessionDocument): Promise<void> {
  await session.deleteOne();
}

export async function endAllMobileSessions(userId: string, except?: MobileSessionDocument): Promise<void> {
  await MobileSessionModel.deleteMany({ user: userId, ...(except && { _id: { $ne: except.id } }) });
}
