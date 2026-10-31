import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { ApplicationModel, type ApplicationStatus } from '../src/models/application.model';
import { PasswordResetModel } from '../src/models/passwordReset.model';
import { UserModel } from '../src/models/user.model';
import { notifyAccountDeleted } from '../src/services/email.service';
import { hashPassword } from '../src/services/password.service';

vi.mock('../src/services/email.service', () => ({
  isEmailConfigured: vi.fn(() => true),
  notifyAccountDeleted: vi.fn(async () => true),
  sendPasswordResetCode: vi.fn(async () => undefined),
}));

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'test-pass-1';
const EMAIL = 'person@example.com';

const answers = { company: { legalName: 'Test Imports GmbH', country: 'Switzerland' } };

let app: ReturnType<typeof createApp>;
let hash: string;
let userId: string;

function agent() {
  const a = request.agent(app);
  const write = (method: 'post' | 'delete', path: string, body?: object) => a[method](path).set('Origin', ORIGIN).send(body);
  return {
    get: (path: string) => a.get(path),
    post: (path: string, body?: object) => write('post', path, body),
    delete: (path: string) => write('delete', path),
  };
}

async function customer() {
  const a = agent();
  await a.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  return a;
}

async function admin(username = 'staff') {
  const a = agent();
  await a.post('/api/admin/login', { username, password: PASSWORD });
  return a;
}

const addApplication = async (status: ApplicationStatus) =>
  (await ApplicationModel.create({ user: userId, status, answers })).id as string;

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init(), ApplicationModel.init(), PasswordResetModel.init()]);
  hash = await hashPassword(PASSWORD);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), UserModel.deleteMany({}), ApplicationModel.deleteMany({}), PasswordResetModel.deleteMany({})]);
  await AdminModel.create({ username: 'staff', passwordHash: hash, role: 'admin' });
  userId = (await UserModel.create({ name: 'Test Person', email: EMAIL, passwordHash: hash })).id;
  vi.mocked(notifyAccountDeleted).mockClear();
  vi.mocked(notifyAccountDeleted).mockResolvedValue(true);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('removing an application', () => {
  it.each(['in_review', 'approved', 'rejected'] as const)('sends the customer back to a new form from %s', async (status) => {
    const id = await addApplication(status);
    const c = await customer();
    expect((await c.get('/api/application')).body.application.status).toBe(status);

    const a = await admin();
    const res = await a.delete(`/api/admin/applications/${id}`);
    expect(res.body.application).toMatchObject({ status: 'removed', removedBy: 'staff' });
    expect((await c.get('/api/application')).body.application).toBeNull();
  });

  it('ignores an older rejected application once the latest is removed', async () => {
    await addApplication('rejected');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const id = await addApplication('approved');
    const c = await customer();
    await (await admin()).delete(`/api/admin/applications/${id}`);
    expect((await c.get('/api/application')).body.application).toBeNull();
  });

  it('keeps the record, and lets the customer apply again', async () => {
    const id = await addApplication('approved');
    const a = await admin();
    await a.delete(`/api/admin/applications/${id}`);
    expect((await a.get('/api/admin/applications?status=removed')).body.total).toBe(1);
    expect((await a.get(`/api/admin/applications/${id}`)).body.application.answers).toEqual(answers);
    const second = await addApplication('in_review');
    expect(second).not.toBe(id);
    expect(await ApplicationModel.countDocuments()).toBe(2);
  });

  it('can’t be approved or removed again', async () => {
    const id = await addApplication('in_review');
    const a = await admin();
    await a.delete(`/api/admin/applications/${id}`);
    expect((await a.post(`/api/admin/applications/${id}/approve`)).status).toBe(409);
    expect((await a.delete(`/api/admin/applications/${id}`)).status).toBe(409);
  });

  it('needs an admin', async () => {
    const id = await addApplication('approved');
    const c = await customer();
    expect((await agent().delete(`/api/admin/applications/${id}`)).status).toBe(401);
    expect((await c.delete(`/api/admin/applications/${id}`)).status).toBe(401);
    expect((await ApplicationModel.findById(id))?.status).toBe('approved');
  });

  it('handles a bad ID', async () => {
    const a = await admin();
    expect((await a.delete('/api/admin/applications/not-an-id')).status).toBe(404);
  });
});

describe('sending a removed application back to review', () => {
  it('puts it in review for the customer, with old decisions cleared', async () => {
    const id = await addApplication('approved');
    await ApplicationModel.updateOne({ _id: id }, { reviewedAt: new Date(), reviewedBy: 'staff' });
    const c = await customer();
    const a = await admin();
    await a.delete(`/api/admin/applications/${id}`);
    expect((await c.get('/api/application')).body.application).toBeNull();

    const res = await a.post(`/api/admin/applications/${id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('in_review');
    expect(res.body.application.reviewedBy).toBeUndefined();
    expect(res.body.application.removedBy).toBeUndefined();
    expect((await c.get('/api/application')).body.application).toMatchObject({ id, status: 'in_review' });
    expect((await a.post(`/api/admin/applications/${id}/approve`)).status).toBe(200);
  });

  it('shows the restored one even when a newer application was rejected', async () => {
    const id = await addApplication('removed');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addApplication('rejected');
    const a = await admin();
    await a.post(`/api/admin/applications/${id}/restore`);
    const { application } = (await (await customer()).get('/api/application')).body;
    expect(application).toMatchObject({ id, status: 'in_review' });
  });

  it.each(['in_review', 'approved'] as const)('refuses when the customer already has one %s', async (status) => {
    const id = await addApplication('removed');
    const other = await addApplication(status);
    const a = await admin();
    const res = await a.post(`/api/admin/applications/${id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already has an application');
    expect((await ApplicationModel.findById(id))?.status).toBe('removed');
    expect((await ApplicationModel.findById(other))?.status).toBe(status);
  });

  it('refuses when the account was deleted', async () => {
    const id = await addApplication('approved');
    const a = await admin();
    await a.delete(`/api/admin/customers/${userId}`);
    const res = await a.post(`/api/admin/applications/${id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('deleted');
  });

  it('only works on a removed application', async () => {
    const id = await addApplication('rejected');
    expect((await (await admin()).post(`/api/admin/applications/${id}/restore`)).status).toBe(409);
    expect((await ApplicationModel.findById(id))?.status).toBe('rejected');
  });
});

describe('deleting a removed application for good', () => {
  it('erases it from the database', async () => {
    const id = await addApplication('removed');
    const a = await admin();
    expect((await a.delete(`/api/admin/applications/${id}/permanent`)).status).toBe(204);
    expect(await ApplicationModel.findById(id)).toBeNull();
    expect((await a.get(`/api/admin/applications/${id}`)).status).toBe(404);
  });

  it('also works once the account is gone', async () => {
    const id = await addApplication('approved');
    const a = await admin();
    await a.delete(`/api/admin/customers/${userId}`);
    expect((await a.delete(`/api/admin/applications/${id}/permanent`)).status).toBe(204);
    expect(await ApplicationModel.countDocuments()).toBe(0);
  });

  it.each(['in_review', 'approved', 'rejected'] as const)('refuses a %s application', async (status) => {
    const id = await addApplication(status);
    expect((await (await admin()).delete(`/api/admin/applications/${id}/permanent`)).status).toBe(409);
    expect(await ApplicationModel.countDocuments()).toBe(1);
  });

  it('needs an admin for both actions', async () => {
    const id = await addApplication('removed');
    const c = await customer();
    expect((await c.delete(`/api/admin/applications/${id}/permanent`)).status).toBe(401);
    expect((await c.post(`/api/admin/applications/${id}/restore`)).status).toBe(401);
    expect((await agent().delete(`/api/admin/applications/${id}/permanent`)).status).toBe(401);
    expect(await ApplicationModel.countDocuments()).toBe(1);
  });

  it('handles a bad ID', async () => {
    const a = await admin();
    expect((await a.delete('/api/admin/applications/not-an-id/permanent')).status).toBe(404);
    expect((await a.post('/api/admin/applications/not-an-id/restore')).status).toBe(404);
  });
});

describe('deleting a customer account', () => {
  it('removes the login, ends the session and emails the customer', async () => {
    const c = await customer();
    expect((await c.get('/api/auth/me')).status).toBe(200);

    const res = await (await admin()).delete(`/api/admin/customers/${userId}`);
    expect(res.body).toEqual({ emailSent: true });
    expect(notifyAccountDeleted).toHaveBeenCalledExactlyOnceWith(EMAIL);

    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.get('/api/application')).status).toBe(401);
    expect((await agent().post('/api/auth/login', { email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('keeps applications marked removed, with whose they were', async () => {
    const approved = await addApplication('approved');
    const rejected = await addApplication('rejected');
    const a = await admin();
    await a.delete(`/api/admin/customers/${userId}`);
    for (const id of [approved, rejected]) {
      const { application } = (await a.get(`/api/admin/applications/${id}`)).body;
      expect(application).toMatchObject({ status: 'removed', removedBy: 'staff', accountDeleted: true });
      expect(application.customer).toMatchObject({ id: null, name: 'Test Person', email: EMAIL });
    }
    const list = (await a.get('/api/admin/applications')).body;
    expect(list.applications[0].customer.email).toBe(EMAIL);
    expect((await a.get('/api/admin/overview')).body.stats.applicationsInReview).toBe(0);
  });

  it('clears a pending password reset', async () => {
    await PasswordResetModel.create({ user: userId, codeHash: 'x', expiresAt: new Date(Date.now() + 60000), sentAt: new Date() });
    await (await admin()).delete(`/api/admin/customers/${userId}`);
    expect(await PasswordResetModel.countDocuments()).toBe(0);
  });

  it('lets the same email sign up afresh, with a blank application', async () => {
    await addApplication('approved');
    await (await admin()).delete(`/api/admin/customers/${userId}`);
    const again = agent();
    const res = await again.post('/api/auth/signup', { name: 'Test Person', email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(201);
    expect((await again.get('/api/application')).body.application).toBeNull();
  });

  it('still deletes the account when the email fails, and says so', async () => {
    vi.mocked(notifyAccountDeleted).mockResolvedValue(false);
    const res = await (await admin()).delete(`/api/admin/customers/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emailSent: false });
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('needs an admin, and a real customer', async () => {
    const c = await customer();
    expect((await agent().delete(`/api/admin/customers/${userId}`)).status).toBe(401);
    expect((await c.delete(`/api/admin/customers/${userId}`)).status).toBe(401);
    expect(await UserModel.countDocuments()).toBe(1);
    const a = await admin();
    expect((await a.delete('/api/admin/customers/not-an-id')).status).toBe(404);
    expect((await a.delete(`/api/admin/customers/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });
});
