import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { ApplicationModel } from '../src/models/application.model';
import { MobileSessionModel } from '../src/models/mobileSession.model';
import { PasswordResetModel } from '../src/models/passwordReset.model';
import { UserModel } from '../src/models/user.model';
import { sendPasswordResetCode } from '../src/services/email.service';
import { verifyGoogleCredential } from '../src/services/google.service';
import { hashPassword } from '../src/services/password.service';

vi.mock('../src/services/google.service', () => ({ verifyGoogleCredential: vi.fn() }));
vi.mock('../src/services/email.service', () => ({
  isEmailConfigured: vi.fn(() => true),
  notifyAccountDeleted: vi.fn(async () => true),
  notifyInformationRequest: vi.fn(async () => true),
  sendPasswordResetCode: vi.fn(async () => undefined),
}));

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'person@example.com';
const PASSWORD = 'test-pass-1';
const person = { email: EMAIL, password: PASSWORD };

let app: ReturnType<typeof createApp>;

// A real phone sends no Origin header and no cookies.
const post = (path: string, body?: object, token?: string) => {
  const r = request(app).post(path);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
const get = (path: string, token?: string) => {
  const r = request(app).get(path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const patch = (path: string, body: object, token: string) =>
  request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body);

async function logIn() {
  return (await post('/api/mobile/auth/login', person)).body as { accessToken: string; refreshToken: string };
}

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init(), MobileSessionModel.init(), ApplicationModel.init(), PasswordResetModel.init()]);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([UserModel.deleteMany({}), MobileSessionModel.deleteMany({}), AdminModel.deleteMany({}), ApplicationModel.deleteMany({}), PasswordResetModel.deleteMany({})]);
  await UserModel.create({ name: 'Test Person', email: EMAIL, passwordHash: await hashPassword(PASSWORD) });
  vi.mocked(verifyGoogleCredential).mockReset();
  vi.mocked(sendPasswordResetCode).mockClear();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('signing in from the app', () => {
  it('logs in with no origin, returning tokens and no cookie', async () => {
    const res = await post('/api/mobile/auth/login', person);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.expiresIn).toBe(900);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('signs up with no origin', async () => {
    const res = await post('/api/mobile/auth/signup', { name: 'New Person', email: 'new@example.com', password: PASSWORD });
    expect(res.status).toBe(201);
    expect((await get('/api/auth/me', res.body.accessToken)).body.user.email).toBe('new@example.com');
  });

  it('stores only hashes of the tokens', async () => {
    const { accessToken, refreshToken } = await logIn();
    const stored = JSON.stringify(await MobileSessionModel.findOne().lean());
    expect(stored).not.toContain(accessToken);
    expect(stored).not.toContain(refreshToken);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrong = await post('/api/mobile/auth/login', { email: EMAIL, password: 'wrong-password' });
    const unknown = await post('/api/mobile/auth/login', { email: 'x@example.com', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rate limits sign-in', async () => {
    const limited = createApp({ authLimit: 2 });
    const attempt = () => request(limited).post('/api/mobile/auth/login').send(person);
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
  });

  it('signs in with Google', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue({ googleId: 'g-1', email: 'g@example.com', emailVerified: true, name: 'Google Person' });
    const res = await post('/api/mobile/auth/google', { credential: 'token' });
    expect(res.status).toBe(200);
    expect((await get('/api/auth/me', res.body.accessToken)).body.user.hasPassword).toBe(false);
  });

  it('refuses a bad Google token', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue(null);
    expect((await post('/api/mobile/auth/google', { credential: 'bad' })).status).toBe(401);
  });

  it('ends app sessions when Google takes over a password account', async () => {
    const { accessToken } = await logIn();
    vi.mocked(verifyGoogleCredential).mockResolvedValue({ googleId: 'g-1', email: EMAIL, emailVerified: true, name: 'Owner' });
    await post('/api/mobile/auth/google', { credential: 'token' });
    expect((await get('/api/auth/me', accessToken)).status).toBe(401);
  });
});

describe('using the app token', () => {
  it('reaches every customer route', async () => {
    const { accessToken } = await logIn();
    expect((await get('/api/auth/me', accessToken)).status).toBe(200);
    expect((await get('/api/application', accessToken)).body.application).toBeNull();
    expect((await get('/api/application/options', accessToken)).status).toBe(200);
    const renamed = await patch('/api/auth/profile', { name: 'Renamed' }, accessToken);
    expect(renamed.body.user.name).toBe('Renamed');
  });

  it.each([
    ['no token', undefined],
    ['a made-up token', 'not-a-real-token'],
  ])('refuses %s', async (_label, token) => {
    expect((await get('/api/auth/me', token)).status).toBe(401);
  });

  it('refuses a malformed header', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('refuses a refresh token used as an access token', async () => {
    const { refreshToken } = await logIn();
    expect((await get('/api/auth/me', refreshToken)).status).toBe(401);
  });

  it('refuses an expired access token', async () => {
    const { accessToken } = await logIn();
    await MobileSessionModel.updateOne({}, { accessExpiresAt: new Date(Date.now() - 1000) });
    expect((await get('/api/auth/me', accessToken)).status).toBe(401);
  });

  it('never opens the admin panel', async () => {
    await AdminModel.create({ username: 'staff', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    const { accessToken } = await logIn();
    expect((await get('/api/admin/customers', accessToken)).status).toBe(401);
    expect((await post('/api/admin/login', { username: 'staff', password: PASSWORD }, accessToken)).status).toBe(403);
  });
});

describe('refreshing', () => {
  it('swaps for new tokens, and the old access token stops working', async () => {
    const first = await logIn();
    const res = await post('/api/mobile/auth/refresh', { refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).not.toBe(first.accessToken);
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect((await get('/api/auth/me', res.body.accessToken)).status).toBe(200);
    expect((await get('/api/auth/me', first.accessToken)).status).toBe(401);
  });

  it('treats a reused refresh token as theft and ends the session', async () => {
    const first = await logIn();
    const second = (await post('/api/mobile/auth/refresh', { refreshToken: first.refreshToken })).body;
    expect((await post('/api/mobile/auth/refresh', { refreshToken: first.refreshToken })).status).toBe(401);
    expect((await get('/api/auth/me', second.accessToken)).status).toBe(401);
    expect((await post('/api/mobile/auth/refresh', { refreshToken: second.refreshToken })).status).toBe(401);
    expect(await MobileSessionModel.countDocuments()).toBe(0);
  });

  it('refuses an unknown or expired refresh token', async () => {
    expect((await post('/api/mobile/auth/refresh', { refreshToken: 'nope' })).status).toBe(401);
    const { refreshToken } = await logIn();
    await MobileSessionModel.updateOne({}, { refreshExpiresAt: new Date(Date.now() - 1000) });
    expect((await post('/api/mobile/auth/refresh', { refreshToken })).status).toBe(401);
  });

  it('refuses a non-string token', async () => {
    expect((await post('/api/mobile/auth/refresh', { refreshToken: { $ne: '' } })).status).toBe(400);
  });
});

describe('ending app sessions', () => {
  it('logs out this device only', async () => {
    const one = await logIn();
    const two = await logIn();
    expect((await post('/api/auth/logout', {}, one.accessToken)).status).toBe(204);
    expect((await get('/api/auth/me', one.accessToken)).status).toBe(401);
    expect((await post('/api/mobile/auth/refresh', { refreshToken: one.refreshToken })).status).toBe(401);
    expect((await get('/api/auth/me', two.accessToken)).status).toBe(200);
  });

  it('changing the password keeps this device and ends the others', async () => {
    const here = await logIn();
    const other = await logIn();
    const web = request.agent(app);
    await web.post('/api/auth/login').set('Origin', ORIGIN).send(person);
    const res = await post('/api/auth/password', { currentPassword: PASSWORD, password: 'new-password-2' }, here.accessToken);
    expect(res.status).toBe(204);
    expect((await get('/api/auth/me', here.accessToken)).status).toBe(200);
    expect((await get('/api/auth/me', other.accessToken)).status).toBe(401);
    expect((await web.get('/api/auth/me')).status).toBe(401);
  });

  it('changing the password on the website ends app sessions', async () => {
    const { accessToken } = await logIn();
    const web = request.agent(app);
    await web.post('/api/auth/login').set('Origin', ORIGIN).send(person);
    await web.post('/api/auth/password').set('Origin', ORIGIN).send({ currentPassword: PASSWORD, password: 'new-password-2' });
    expect((await get('/api/auth/me', accessToken)).status).toBe(401);
    expect((await web.get('/api/auth/me')).status).toBe(200);
  });

  it('a password reset from the app ends all sessions', async () => {
    const { accessToken } = await logIn();
    await post('/api/mobile/auth/forgot-password', { email: EMAIL });
    await vi.waitFor(() => expect(sendPasswordResetCode).toHaveBeenCalledOnce());
    const code = vi.mocked(sendPasswordResetCode).mock.calls[0]![1];
    const res = await post('/api/mobile/auth/reset-password', { email: EMAIL, code, password: 'new-password-2' });
    expect(res.status).toBe(204);
    expect((await get('/api/auth/me', accessToken)).status).toBe(401);
    expect(await MobileSessionModel.countDocuments()).toBe(0);
  });

  it('deleting the account ends app sessions', async () => {
    await AdminModel.create({ username: 'staff', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    const { accessToken } = await logIn();
    const userId = (await UserModel.findOne())!.id;
    const admin = request.agent(app);
    await admin.post('/api/admin/login').set('Origin', ORIGIN).send({ username: 'staff', password: PASSWORD });
    await admin.delete(`/api/admin/customers/${userId}`).set('Origin', ORIGIN);
    expect((await get('/api/auth/me', accessToken)).status).toBe(401);
    expect(await MobileSessionModel.countDocuments()).toBe(0);
  });
});

describe('the website stays protected', () => {
  it('still refuses cookie requests from another origin', async () => {
    const web = request.agent(app);
    await web.post('/api/auth/login').set('Origin', ORIGIN).send(person);
    const res = await web.patch('/api/auth/profile').set('Origin', 'https://evil.example').send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('never lets a cookie rescue a bad token sent alongside it', async () => {
    const web = request.agent(app);
    await web.post('/api/auth/login').set('Origin', ORIGIN).send(person);
    const res = await web.patch('/api/auth/profile').set('Authorization', 'Bearer fake').send({ name: 'Hacked' });
    expect(res.status).toBe(401);
    expect((await UserModel.findOne())?.name).toBe('Test Person');
  });

  it('still refuses admin requests with no origin, even with a token header', async () => {
    const res = await request(app).post('/api/admin/login').set('Authorization', 'Bearer fake').send({ username: 'a', password: 'b' });
    expect(res.status).toBe(403);
  });

  it('does not set a mobile session from the website login', async () => {
    const web = request.agent(app);
    await web.post('/api/auth/login').set('Origin', ORIGIN).send(person);
    expect(await MobileSessionModel.countDocuments()).toBe(0);
  });
});
