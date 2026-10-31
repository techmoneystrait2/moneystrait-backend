import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { PasswordResetModel } from '../src/models/passwordReset.model';
import { UserModel } from '../src/models/user.model';
import { isEmailConfigured, sendPasswordResetCode } from '../src/services/email.service';
import { hashPassword } from '../src/services/password.service';

vi.mock('../src/services/email.service', () => ({
  isEmailConfigured: vi.fn(() => true),
  sendPasswordResetCode: vi.fn(async () => undefined),
}));

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'person@example.com';
const OLD_PASSWORD = 'old-password-1';
const NEW_PASSWORD = 'new-password-2';

let app: ReturnType<typeof createApp>;

function post(path: string, body: object, a = request(app)) {
  return a.post(path).set('Origin', ORIGIN).send(body);
}

async function requestCode(email = EMAIL): Promise<string> {
  const before = vi.mocked(sendPasswordResetCode).mock.calls.length;
  await post('/api/auth/forgot-password', { email });
  await vi.waitFor(() => expect(vi.mocked(sendPasswordResetCode).mock.calls.length).toBe(before + 1));
  return vi.mocked(sendPasswordResetCode).mock.calls.at(-1)![1];
}

const wrongCode = (code: string) => (code === '123456' ? '654321' : '123456');

beforeAll(async () => {
  await connectDb();
  await Promise.all([UserModel.init(), PasswordResetModel.init()]);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([UserModel.deleteMany({}), PasswordResetModel.deleteMany({})]);
  await UserModel.create({ name: 'Test Person', email: EMAIL, passwordHash: await hashPassword(OLD_PASSWORD) });
  vi.mocked(sendPasswordResetCode).mockClear();
  vi.mocked(isEmailConfigured).mockReturnValue(true);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('asking for a code', () => {
  it('emails a 6-digit code valid for 5 minutes, and never returns it', async () => {
    const res = await post('/api/auth/forgot-password', { email: 'PERSON@example.com' });
    await vi.waitFor(() => expect(sendPasswordResetCode).toHaveBeenCalledOnce());
    const [to, code, minutes] = vi.mocked(sendPasswordResetCode).mock.calls[0]!;
    expect(to).toBe(EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    expect(minutes).toBe(5);
    expect(res.body).toEqual({ minutes: 5 });
  });

  it('stores only a hash, expiring in 5 minutes', async () => {
    const code = await requestCode();
    const stored = await PasswordResetModel.findOne();
    expect(stored?.codeHash).toMatch(/^\$2b\$/);
    expect(stored?.codeHash).not.toContain(code);
    const left = stored!.expiresAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(4.9 * 60 * 1000);
    expect(left).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('answers the same for an unknown email, and sends nothing', async () => {
    const known = await post('/api/auth/forgot-password', { email: EMAIL });
    const unknown = await post('/api/auth/forgot-password', { email: 'nobody@example.com' });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    await vi.waitFor(() => expect(sendPasswordResetCode).toHaveBeenCalledOnce());
    expect(vi.mocked(sendPasswordResetCode).mock.calls[0]![0]).toBe(EMAIL);
  });

  it('sends one email a minute at most', async () => {
    await requestCode();
    await post('/api/auth/forgot-password', { email: EMAIL });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sendPasswordResetCode).toHaveBeenCalledOnce();
  });

  it('says unavailable when email is not set up', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false);
    const res = await post('/api/auth/forgot-password', { email: EMAIL });
    expect(res.status).toBe(503);
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });
});

describe('resetting the password', () => {
  it('changes the password once, and ends existing sessions', async () => {
    const session = request.agent(app);
    await post('/api/auth/login', { email: EMAIL, password: OLD_PASSWORD }, session as never);
    expect((await session.get('/api/auth/me')).status).toBe(200);

    const code = await requestCode();
    const res = await post('/api/auth/reset-password', { email: EMAIL, code, password: NEW_PASSWORD });
    expect(res.status).toBe(204);

    expect((await session.get('/api/auth/me')).status).toBe(401);
    expect((await post('/api/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status).toBe(401);
    expect((await post('/api/auth/login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
    const again = await post('/api/auth/reset-password', { email: EMAIL, code, password: 'another-pass-3' });
    expect(again.status).toBe(400);
  });

  it('refuses a wrong code', async () => {
    const code = await requestCode();
    const res = await post('/api/auth/reset-password', { email: EMAIL, code: wrongCode(code), password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect((await post('/api/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status).toBe(200);
  });

  it('refuses an expired code', async () => {
    const code = await requestCode();
    await PasswordResetModel.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });
    const res = await post('/api/auth/reset-password', { email: EMAIL, code, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('locks the code after 5 wrong tries, even with the right one next', async () => {
    const code = await requestCode();
    for (let i = 0; i < 5; i += 1) {
      await post('/api/auth/reset-password', { email: EMAIL, code: wrongCode(code), password: NEW_PASSWORD });
    }
    const res = await post('/api/auth/reset-password', { email: EMAIL, code, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect((await post('/api/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status).toBe(200);
  });

  it('counts parallel guesses', async () => {
    const code = await requestCode();
    await Promise.all(
      Array.from({ length: 8 }, () => post('/api/auth/reset-password', { email: EMAIL, code: wrongCode(code), password: NEW_PASSWORD })),
    );
    expect((await PasswordResetModel.findOne())?.attempts).toBe(5);
  });

  it('gives an unknown email the same answer as a wrong code', async () => {
    const code = await requestCode();
    const wrong = await post('/api/auth/reset-password', { email: EMAIL, code: wrongCode(code), password: NEW_PASSWORD });
    const unknown = await post('/api/auth/reset-password', { email: 'nobody@example.com', code, password: NEW_PASSWORD });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('refuses a short password and a malformed code', async () => {
    const code = await requestCode();
    expect((await post('/api/auth/reset-password', { email: EMAIL, code, password: '1234567' })).status).toBe(400);
    expect((await post('/api/auth/reset-password', { email: EMAIL, code: 'abc', password: NEW_PASSWORD })).status).toBe(400);
    expect((await post('/api/auth/reset-password', { email: EMAIL, code: { $ne: '' }, password: NEW_PASSWORD })).status).toBe(400);
  });
});
