import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { UserModel } from '../src/models/user.model';
import { hashPassword } from '../src/services/password.service';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'test-pass-1';

let app: ReturnType<typeof createApp>;
let hash: string;

function agent() {
  const a = request.agent(app);
  const write = (method: 'post' | 'patch' | 'delete', path: string, body?: object) =>
    a[method](path).set('Origin', ORIGIN).send(body);
  return {
    get: (path: string) => a.get(path),
    post: (path: string, body?: object) => write('post', path, body),
    patch: (path: string, body?: object) => write('patch', path, body),
    delete: (path: string) => write('delete', path),
  };
}

async function logIn(username: string, password = PASSWORD) {
  const a = agent();
  await a.post('/api/admin/login', { username, password });
  return a;
}

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init()]);
  hash = await hashPassword(PASSWORD);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), UserModel.deleteMany({})]);
  await AdminModel.create([
    { username: 'root', passwordHash: hash, role: 'superadmin' },
    { username: 'staff', passwordHash: hash, role: 'admin' },
  ]);
  await UserModel.create([
    { name: 'Asha Customer', email: 'asha@example.com', passwordHash: hash },
    { name: 'Gita Google', email: 'gita@example.com', googleId: 'g-1' },
  ]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('admin access', () => {
  it.each([
    ['get', '/api/admin/me'],
    ['get', '/api/admin/overview'],
    ['get', '/api/admin/customers'],
    ['get', '/api/admin/admins'],
    ['get', '/api/admin/anything'],
    ['post', '/api/admin/admins'],
    ['patch', '/api/admin/credentials'],
    ['delete', '/api/admin/admins/abc'],
  ] as const)('%s %s returns 401 without an admin session', async (method, path) => {
    expect((await agent()[method](path)).status).toBe(401);
  });

  it('refuses a customer session', async () => {
    const customer = agent();
    await customer.post('/api/auth/login', { email: 'asha@example.com', password: PASSWORD });
    expect((await customer.get('/api/auth/me')).status).toBe(200);
    expect((await customer.get('/api/admin/customers')).status).toBe(401);
  });

  it('does not treat an admin session as a customer', async () => {
    const admin = await logIn('root');
    expect((await admin.get('/api/auth/me')).status).toBe(401);
  });

  it('gives the same error for a wrong password and an unknown username', async () => {
    const wrong = await agent().post('/api/admin/login', { username: 'root', password: 'nope-nope' });
    const unknown = await agent().post('/api/admin/login', { username: 'ghost', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('refuses a request from another origin', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .set('Origin', 'https://evil.example')
      .send({ username: 'root', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('ends the session on logout', async () => {
    const admin = await logIn('root');
    expect((await admin.post('/api/admin/logout')).status).toBe(204);
    expect((await admin.get('/api/admin/me')).status).toBe(401);
  });
});

describe('viewing data', () => {
  it.each(['root', 'staff'])('%s can see the overview, customers and admins', async (username) => {
    const admin = await logIn(username);
    const overview = await admin.get('/api/admin/overview');
    expect(overview.body.stats).toMatchObject({ customers: 2, passwordAccounts: 1, googleAccounts: 1, admins: 2 });
    const customers = await admin.get('/api/admin/customers');
    expect(customers.body.total).toBe(2);
    expect((await admin.get('/api/admin/admins')).body.admins).toHaveLength(2);
  });

  it('never returns a password hash or Google ID', async () => {
    const admin = await logIn('root');
    const paths = ['/api/admin/overview', '/api/admin/customers', '/api/admin/admins', '/api/admin/me'];
    for (const path of paths) {
      const body = JSON.stringify((await admin.get(path)).body);
      expect(body).not.toContain('$2b$');
      expect(body).not.toMatch(/passwordHash|googleId/);
    }
  });

  it('reports how each customer signs in', async () => {
    const admin = await logIn('staff');
    const { customers } = (await admin.get('/api/admin/customers')).body;
    const methods = Object.fromEntries(customers.map((c: { email: string; signIn: string }) => [c.email, c.signIn]));
    expect(methods).toEqual({ 'asha@example.com': 'Password', 'gita@example.com': 'Google' });
  });

  it('searches as plain text', async () => {
    const admin = await logIn('staff');
    expect((await admin.get('/api/admin/customers?search=gita')).body.total).toBe(1);
    expect((await admin.get('/api/admin/customers?search=.*')).body.total).toBe(0);
    expect((await admin.get('/api/admin/customers?search=(')).status).toBe(200);
  });
});

describe('managing admins', () => {
  it('lets the super admin create an admin who can log in', async () => {
    const root = await logIn('root');
    const res = await root.post('/api/admin/admins', { username: 'New.Admin', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.admin).toMatchObject({ username: 'new.admin', role: 'admin' });
    const created = await logIn('new.admin');
    expect((await created.get('/api/admin/me')).status).toBe(200);
  });

  it('ignores an attempt to create a second super admin', async () => {
    const root = await logIn('root');
    const res = await root.post('/api/admin/admins', { username: 'second', password: PASSWORD, role: 'superadmin' });
    expect(res.body.admin.role).toBe('admin');
  });

  it('refuses a taken username and a short password', async () => {
    const root = await logIn('root');
    expect((await root.post('/api/admin/admins', { username: 'staff', password: PASSWORD })).status).toBe(409);
    expect((await root.post('/api/admin/admins', { username: 'other', password: '1234567' })).status).toBe(400);
  });

  it('accepts an 8 character password', async () => {
    const root = await logIn('root');
    expect((await root.post('/api/admin/admins', { username: 'other', password: '12345678' })).status).toBe(201);
  });

  it('deletes an admin and ends their session at once', async () => {
    const root = await logIn('root');
    const staff = await logIn('staff');
    const target = await AdminModel.findOne({ username: 'staff' });
    expect((await root.delete(`/api/admin/admins/${target?.id}`)).status).toBe(204);
    expect((await staff.get('/api/admin/me')).status).toBe(401);
  });

  it('refuses to delete the super admin, and handles a bad ID', async () => {
    const root = await logIn('root');
    const self = await AdminModel.findOne({ username: 'root' });
    expect((await root.delete(`/api/admin/admins/${self?.id}`)).status).toBe(403);
    expect((await root.delete('/api/admin/admins/not-an-id')).status).toBe(404);
  });

  it('refuses all of it to a normal admin', async () => {
    const staff = await logIn('staff');
    const root = await AdminModel.findOne({ username: 'root' });
    expect((await staff.post('/api/admin/admins', { username: 'x12', password: PASSWORD })).status).toBe(403);
    expect((await staff.delete(`/api/admin/admins/${root?.id}`)).status).toBe(403);
    expect((await staff.patch('/api/admin/credentials', { currentPassword: PASSWORD, username: 'boss' })).status).toBe(403);
    expect(await AdminModel.countDocuments()).toBe(2);
  });
});

describe('super admin credentials', () => {
  it('needs the current password', async () => {
    const root = await logIn('root');
    const res = await root.patch('/api/admin/credentials', { currentPassword: 'wrong-pass', username: 'boss' });
    expect(res.status).toBe(401);
    expect(await AdminModel.countDocuments({ username: 'root' })).toBe(1);
  });

  it('needs something to change', async () => {
    const root = await logIn('root');
    expect((await root.patch('/api/admin/credentials', { currentPassword: PASSWORD })).status).toBe(400);
  });

  it('changes both, keeps this session and ends the others', async () => {
    const root = await logIn('root');
    const otherDevice = await logIn('root');
    const res = await root.patch('/api/admin/credentials', {
      currentPassword: PASSWORD,
      username: 'boss',
      password: 'new-pass-2',
    });
    expect(res.status).toBe(200);
    expect((await root.get('/api/admin/me')).body.admin.username).toBe('boss');
    expect((await otherDevice.get('/api/admin/me')).status).toBe(401);
    const old = await agent().post('/api/admin/login', { username: 'root', password: PASSWORD });
    expect(old.status).toBe(401);
    expect((await agent().post('/api/admin/login', { username: 'boss', password: 'new-pass-2' })).status).toBe(200);
  });

  it('refuses a username already in use', async () => {
    const root = await logIn('root');
    const res = await root.patch('/api/admin/credentials', { currentPassword: PASSWORD, username: 'staff' });
    expect(res.status).toBe(409);
  });
});
