import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { AdminMobileSessionModel } from '../src/models/adminMobileSession.model';
import { ApplicationModel } from '../src/models/application.model';
import { MobileSessionModel } from '../src/models/mobileSession.model';
import { UserModel } from '../src/models/user.model';
import { hashPassword } from '../src/services/password.service';

vi.mock('../src/services/email.service', () => ({
  isEmailConfigured: vi.fn(() => true),
  notifyAccountDeleted: vi.fn(async () => true),
  notifyInformationRequest: vi.fn(async () => true),
  sendPasswordResetCode: vi.fn(async () => undefined),
}));

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'test-pass-1';
let app: ReturnType<typeof createApp>;

const bearer = (token: string) => `Bearer ${token}`;
const get = (path: string, token: string) => request(app).get(path).set('Authorization', bearer(token));
const login = async (username = 'boss') =>
  (await request(app).post('/api/mobile/admin/login').send({ username, password: PASSWORD })).body as {
    accessToken: string;
    refreshToken: string;
  };

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init(), AdminMobileSessionModel.init(), MobileSessionModel.init(), ApplicationModel.init()]);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), AdminMobileSessionModel.deleteMany({}), MobileSessionModel.deleteMany({}), UserModel.deleteMany({}), ApplicationModel.deleteMany({})]);
  const passwordHash = await hashPassword(PASSWORD);
  await AdminModel.create([
    { username: 'boss', passwordHash, role: 'superadmin' },
    { username: 'staff', passwordHash, role: 'admin' },
  ]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('admin on the mobile app', () => {
  it('logs in with no origin, returning tokens and no cookie', async () => {
    const res = await request(app).post('/api/mobile/admin/login').send({ username: 'boss', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.admin.role).toBe('superadmin');
    expect(res.body.admin.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await get('/api/admin/me', res.body.accessToken)).status).toBe(200);
  });

  it('refuses a wrong password', async () => {
    const res = await request(app).post('/api/mobile/admin/login').send({ username: 'boss', password: 'wrong-pass' });
    expect(res.status).toBe(401);
  });

  it('can act without an origin', async () => {
    const { accessToken } = await login();
    const res = await request(app).post('/api/admin/admins').set('Authorization', bearer(accessToken)).send({ username: 'new.one', password: PASSWORD });
    expect(res.status).toBe(201);
  });

  it('still keeps superadmin actions from a normal admin', async () => {
    const { accessToken } = await login('staff');
    const res = await request(app).post('/api/admin/admins').set('Authorization', bearer(accessToken)).send({ username: 'new.one', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('never accepts a customer token, and an admin token never opens customer routes', async () => {
    await request(app).post('/api/mobile/auth/signup').send({ name: 'Pat Doe', email: 'pat@example.com', password: PASSWORD });
    const customer = (await request(app).post('/api/mobile/auth/login').send({ email: 'pat@example.com', password: PASSWORD })).body;
    expect((await get('/api/admin/me', customer.accessToken)).status).toBe(401);
    const { accessToken } = await login();
    expect((await get('/api/auth/me', accessToken)).status).toBe(401);
  });

  it('never lets an admin cookie rescue a bad token', async () => {
    const web = request.agent(app);
    await web.post('/api/admin/login').set('Origin', ORIGIN).send({ username: 'boss', password: PASSWORD });
    expect((await web.get('/api/admin/me').set('Authorization', 'Bearer fake')).status).toBe(401);
    expect((await web.get('/api/admin/me')).status).toBe(200);
  });

  it('still refuses cookie requests from another origin', async () => {
    const web = request.agent(app);
    await web.post('/api/admin/login').set('Origin', ORIGIN).send({ username: 'boss', password: PASSWORD });
    expect((await web.post('/api/admin/logout')).status).toBe(403);
  });

  it('refreshes once, and treats a reused refresh token as theft', async () => {
    const first = await login();
    const second = await request(app).post('/api/mobile/admin/refresh').send({ refreshToken: first.refreshToken });
    expect(second.status).toBe(200);
    expect((await get('/api/admin/me', first.accessToken)).status).toBe(401);
    expect((await get('/api/admin/me', second.body.accessToken)).status).toBe(200);
    expect((await request(app).post('/api/mobile/admin/refresh').send({ refreshToken: first.refreshToken })).status).toBe(401);
    expect((await get('/api/admin/me', second.body.accessToken)).status).toBe(401);
  });

  it('logs out only this device', async () => {
    const phone = await login();
    const tablet = await login();
    expect((await request(app).post('/api/admin/logout').set('Authorization', bearer(phone.accessToken)).send({})).status).toBe(204);
    expect((await get('/api/admin/me', phone.accessToken)).status).toBe(401);
    expect((await get('/api/admin/me', tablet.accessToken)).status).toBe(200);
  });

  it('keeps this device and ends the others when credentials change', async () => {
    const phone = await login();
    const tablet = await login();
    const res = await request(app).patch('/api/admin/credentials').set('Authorization', bearer(phone.accessToken)).send({ currentPassword: PASSWORD, password: 'new-pass-22' });
    expect(res.status).toBe(200);
    expect((await get('/api/admin/me', phone.accessToken)).status).toBe(200);
    expect((await get('/api/admin/me', tablet.accessToken)).status).toBe(401);
  });

  it('ends a deleted admin’s app session', async () => {
    const staff = await login('staff');
    const boss = await login();
    const target = await AdminModel.findOne({ username: 'staff' });
    await request(app).delete(`/api/admin/admins/${target!.id}`).set('Authorization', bearer(boss.accessToken));
    expect((await get('/api/admin/me', staff.accessToken)).status).toBe(401);
    expect(await AdminMobileSessionModel.countDocuments({ admin: target!.id })).toBe(0);
  });
});

describe('staying logged in', () => {
  const daysLeft = (cookie: string) => (new Date(/Expires=([^;]+)/.exec(cookie)![1]!).getTime() - Date.now()) / (24 * 60 * 60 * 1000);

  const adminAgent = async () => {
    const web = request.agent(app);
    const res = await web.post('/api/admin/login').set('Origin', ORIGIN).send({ username: 'boss', password: PASSWORD });
    return { web, cookie: String(res.headers['set-cookie']) };
  };

  it('gives admins their own long cookie, and customers keep 60 minutes', async () => {
    const { cookie } = await adminAgent();
    expect(cookie).toContain('ms.admin=');
    expect(daysLeft(cookie)).toBeGreaterThan(399);
    expect(cookie).toContain('Path=/api/admin');
    expect(cookie).toContain('HttpOnly');
    const customer = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Pat Doe', email: 'pat@example.com', password: PASSWORD });
    const customerCookie = String(customer.headers['set-cookie']);
    expect(customerCookie).toContain('ms.sid=');
    expect(daysLeft(customerCookie)).toBeLessThan(0.05);
  });

  it('keeps an admin logged in when a customer logs in and out in the same browser', async () => {
    const { web } = await adminAgent();
    await web.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Pat Doe', email: 'pat@example.com', password: PASSWORD });
    expect((await web.get('/api/admin/me')).status).toBe(200);
    expect((await web.get('/api/auth/me')).status).toBe(200);
    await web.post('/api/auth/logout').set('Origin', ORIGIN).send({});
    expect((await web.get('/api/auth/me')).status).toBe(401);
    expect((await web.get('/api/admin/me')).status).toBe(200);
  });

  it('logs the admin out, and leaves a customer in the same browser logged in', async () => {
    const { web } = await adminAgent();
    await web.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Pat Doe', email: 'pat@example.com', password: PASSWORD });
    expect((await web.post('/api/admin/logout').set('Origin', ORIGIN).send({})).status).toBe(204);
    expect((await web.get('/api/admin/me')).status).toBe(401);
    expect((await web.get('/api/auth/me')).status).toBe(200);
  });

  it('gives the app a long refresh, with no 60-minute limit', async () => {
    await login();
    const session = await AdminMobileSessionModel.findOne();
    expect(session!.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now() + 399 * 24 * 60 * 60 * 1000);
  });
});

describe('customer details', () => {
  it('needs an admin', async () => {
    const user = await UserModel.create({ name: 'Pat Doe', email: 'pat@example.com' });
    expect((await request(app).get(`/api/admin/customers/${user.id}`)).status).toBe(401);
  });

  it('returns the customer and every application, newest first, with no hash', async () => {
    const user = await UserModel.create({ name: 'Pat Doe', email: 'pat@example.com', passwordHash: await hashPassword(PASSWORD) });
    await ApplicationModel.create({ user: user.id, status: 'rejected', answers: { company: { legalName: 'Old Co', country: 'Germany' } } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ApplicationModel.create({ user: user.id, status: 'in_review', answers: { company: { legalName: 'New Co', country: 'Germany' } } });
    const { accessToken } = await login('staff');
    const res = await get(`/api/admin/customers/${user.id}`, accessToken);
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({ name: 'Pat Doe', email: 'pat@example.com', signIn: 'Password' });
    expect(res.body.applications.map((a: { company: string }) => a.company)).toEqual(['New Co', 'Old Co']);
    expect(res.body.applications[0].answers.company.legalName).toBe('New Co');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('answers 404 for an unknown or malformed id', async () => {
    const { accessToken } = await login();
    expect((await get('/api/admin/customers/not-an-id', accessToken)).status).toBe(404);
    expect((await get(`/api/admin/customers/${new mongoose.Types.ObjectId()}`, accessToken)).status).toBe(404);
  });
});
