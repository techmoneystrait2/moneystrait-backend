import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { UserModel } from '../src/models/user.model';
import { hashPassword } from '../src/services/password.service';

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'person@example.com';
const PASSWORD = 'old-password-1';
const NEW_PASSWORD = 'new-password-2';

let app: ReturnType<typeof createApp>;

function agent() {
  const a = request.agent(app);
  return {
    get: (path: string) => a.get(path),
    post: (path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body),
    patch: (path: string, body?: object) => a.patch(path).set('Origin', ORIGIN).send(body),
  };
}

async function customer(password = PASSWORD) {
  const a = agent();
  await a.post('/api/auth/login', { email: EMAIL, password });
  return a;
}

beforeAll(async () => {
  await connectDb();
  await UserModel.init();
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await UserModel.create({ name: 'Test Person', email: EMAIL, passwordHash: await hashPassword(PASSWORD) });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('display name', () => {
  it('changes the name, trimmed', async () => {
    const c = await customer();
    const res = await c.patch('/api/auth/profile', { name: '  New Name  ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('New Name');
    expect((await c.get('/api/auth/me')).body.user.name).toBe('New Name');
  });

  it('never changes the email, even if sent', async () => {
    const c = await customer();
    const res = await c.patch('/api/auth/profile', { name: 'New Name', email: 'attacker@example.com', role: 'admin', sessionVersion: 9 });
    expect(res.body.user.email).toBe(EMAIL);
    const stored = await UserModel.findOne();
    expect(stored?.email).toBe(EMAIL);
    expect(stored?.sessionVersion).toBe(0);
  });

  it.each([
    ['too short', 'A'],
    ['only spaces', '    '],
    ['too long', 'x'.repeat(101)],
  ])('refuses a name that is %s', async (_label, name) => {
    const c = await customer();
    expect((await c.patch('/api/auth/profile', { name })).status).toBe(400);
    expect((await UserModel.findOne())?.name).toBe('Test Person');
  });

  it('refuses a query object', async () => {
    const c = await customer();
    expect((await c.patch('/api/auth/profile', { name: { $ne: '' } })).status).toBe(400);
  });

  it('needs a login', async () => {
    expect((await agent().patch('/api/auth/profile', { name: 'New Name' })).status).toBe(401);
  });

  it('refuses another origin', async () => {
    const res = await request(app).patch('/api/auth/profile').set('Origin', 'https://evil.example').send({ name: 'New Name' });
    expect(res.status).toBe(403);
  });
});

describe('password', () => {
  it('reports whether the account has a password', async () => {
    expect((await (await customer()).get('/api/auth/me')).body.user.hasPassword).toBe(true);
  });

  it('changes it, keeps this session and ends the others', async () => {
    const here = await customer();
    const otherDevice = await customer();
    const res = await here.post('/api/auth/password', { currentPassword: PASSWORD, password: NEW_PASSWORD });
    expect(res.status).toBe(204);
    expect((await here.get('/api/auth/me')).status).toBe(200);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    expect((await agent().post('/api/auth/login', { email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect((await agent().post('/api/auth/login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
    expect((await UserModel.findOne().select('+passwordHash'))?.passwordHash).toMatch(/^\$2b\$12\$/);
  });

  it('needs the right current password', async () => {
    const c = await customer();
    const res = await c.post('/api/auth/password', { currentPassword: 'wrong-password', password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('current password');
    expect((await agent().post('/api/auth/login', { email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('refuses a new password under 8 characters', async () => {
    const c = await customer();
    expect((await c.post('/api/auth/password', { currentPassword: PASSWORD, password: '1234567' })).status).toBe(400);
  });

  it('needs a login', async () => {
    expect((await agent().post('/api/auth/password', { currentPassword: PASSWORD, password: NEW_PASSWORD })).status).toBe(401);
  });

  it('can’t add a password to a Google-only account', async () => {
    const c = await customer();
    await UserModel.updateOne({ email: EMAIL }, { $unset: { passwordHash: 1 }, googleId: 'g-1' });
    expect((await c.get('/api/auth/me')).body.user.hasPassword).toBe(false);

    const res = await c.post('/api/auth/password', { currentPassword: 'anything', password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect((await UserModel.findOne().select('+passwordHash'))?.passwordHash).toBeUndefined();
  });
});
