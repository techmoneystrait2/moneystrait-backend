import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { UserModel } from '../src/models/user.model';
import { verifyGoogleCredential } from '../src/services/google.service';

vi.mock('../src/services/google.service', () => ({ verifyGoogleCredential: vi.fn() }));

const ORIGIN = 'http://localhost:3000';
const person = { name: 'Test Person', email: 'person@example.com', password: 'a-long-test-password' };
const googleProfile = {
  googleId: 'google-1',
  email: 'person@example.com',
  emailVerified: true,
  name: 'Test Person',
};

let app: ReturnType<typeof createApp>;

function agent() {
  const a = request.agent(app);
  return {
    get: (path: string) => a.get(path),
    post: (path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body),
  };
}

beforeAll(async () => {
  await connectDb();
  await UserModel.init();
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  vi.mocked(verifyGoogleCredential).mockReset();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('route protection', () => {
  it.each([
    ['get', '/api/auth/me'],
    ['post', '/api/auth/logout'],
    ['get', '/api/anything-else'],
    ['post', '/api/anything-else'],
    ['get', '/'],
  ])('%s %s returns 401 without a session', async (method, path) => {
    const a = agent();
    const res = await (method === 'get' ? a.get(path) : a.post(path));
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown path only once logged in', async () => {
    const a = agent();
    await a.post('/api/auth/signup', person);
    expect((await a.get('/api/anything-else')).status).toBe(404);
  });

  it('refuses a state-changing request from another origin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send(person);
    expect(res.status).toBe(403);
  });

  it('refuses a state-changing request with no origin', async () => {
    const res = await request(app).post('/api/auth/login').send(person);
    expect(res.status).toBe(403);
  });

  it('rate limits sign-in attempts', async () => {
    const limited = request.agent(createApp({ authLimit: 2 }));
    const attempt = () => limited.post('/api/auth/login').set('Origin', ORIGIN).send(person);
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
  });
});

describe('password accounts', () => {
  it('signs up, stores only a bcrypt hash and starts a session', async () => {
    const a = agent();
    const res = await a.post('/api/auth/signup', person);
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('password');

    const stored = await UserModel.findOne({ email: person.email }).select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$12\$/);

    const me = await a.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(person.email);
  });

  it('sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const res = await agent().post('/api/auth/signup', person);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('refuses a duplicate email', async () => {
    await agent().post('/api/auth/signup', person);
    const res = await agent().post('/api/auth/signup', { ...person, email: 'PERSON@example.com' });
    expect(res.status).toBe(409);
  });

  it.each([
    ['a short password', { ...person, password: 'short' }],
    ['a password over 72 bytes', { ...person, password: 'x'.repeat(73) }],
    ['a bad email', { ...person, email: 'nope' }],
    ['a query object as email', { ...person, email: { $gt: '' } }],
  ])('refuses %s', async (_label, body) => {
    expect((await agent().post('/api/auth/signup', body)).status).toBe(400);
  });

  it('logs in with the right password and ends the session on logout', async () => {
    await agent().post('/api/auth/signup', person);
    const a = agent();
    const res = await a.post('/api/auth/login', { email: person.email, password: person.password });
    expect(res.status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await a.post('/api/auth/logout')).status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    await agent().post('/api/auth/signup', person);
    const wrong = await agent().post('/api/auth/login', {
      email: person.email,
      password: 'wrong-password',
    });
    const unknown = await agent().post('/api/auth/login', {
      email: 'x@example.com',
      password: 'wrong-password',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('refuses a query object as the login password', async () => {
    const res = await agent().post('/api/auth/login', {
      email: person.email,
      password: { $ne: '' },
    });
    expect(res.status).toBe(400);
  });
});

describe('Google sign-in', () => {
  it('creates an account with no password', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue(googleProfile);
    const a = agent();
    expect((await a.post('/api/auth/google', { credential: 'token' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    const stored = await UserModel.findOne({ email: person.email }).select('+passwordHash');
    expect(stored?.googleId).toBe('google-1');
    expect(stored?.passwordHash).toBeUndefined();
  });

  it('signs the same person in again without a second account', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue(googleProfile);
    await agent().post('/api/auth/google', { credential: 'token' });
    await agent().post('/api/auth/google', { credential: 'token' });
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('refuses an invalid token', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue(null);
    expect((await agent().post('/api/auth/google', { credential: 'bad' })).status).toBe(401);
  });

  it('refuses an unverified Google email', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue({ ...googleProfile, emailVerified: false });
    expect((await agent().post('/api/auth/google', { credential: 'token' })).status).toBe(401);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('takes over a password account: the old password and sessions stop working', async () => {
    const squatter = agent();
    await squatter.post('/api/auth/signup', person);
    expect((await squatter.get('/api/auth/me')).status).toBe(200);

    vi.mocked(verifyGoogleCredential).mockResolvedValue(googleProfile);
    const owner = agent();
    expect((await owner.post('/api/auth/google', { credential: 'token' })).status).toBe(200);

    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect((await squatter.get('/api/auth/me')).status).toBe(401);
    const res = await agent().post('/api/auth/login', {
      email: person.email,
      password: person.password,
    });
    expect(res.status).toBe(401);
  });

  it('keeps a password set later when the customer logs in with Google again', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue(googleProfile);
    const a = agent();
    await a.post('/api/auth/google', { credential: 'token' });
    expect((await a.post('/api/auth/password/set', { password: 'set-in-settings' })).status).toBe(204);
    expect((await agent().post('/api/auth/google', { credential: 'token' })).status).toBe(200);
    expect((await agent().post('/api/auth/login', { email: googleProfile.email, password: 'set-in-settings' })).status).toBe(200);
  });

  it('refuses a password login on a Google-only account', async () => {
    vi.mocked(verifyGoogleCredential).mockResolvedValue(googleProfile);
    await agent().post('/api/auth/google', { credential: 'token' });
    const res = await agent().post('/api/auth/login', {
      email: person.email,
      password: person.password,
    });
    expect(res.status).toBe(401);
  });
});
