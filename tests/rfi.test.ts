import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { ApplicationModel, type ApplicationStatus } from '../src/models/application.model';
import { UserModel } from '../src/models/user.model';
import { notifyInformationRequest } from '../src/services/email.service';
import { hashPassword } from '../src/services/password.service';

vi.mock('../src/services/email.service', () => ({
  isEmailConfigured: vi.fn(() => true),
  notifyAccountDeleted: vi.fn(async () => true),
  notifyInformationRequest: vi.fn(async () => true),
  sendPasswordResetCode: vi.fn(async () => undefined),
}));

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'test-pass-1';
const EMAIL = 'person@example.com';
const QUESTION = 'What is your company address?';

let app: ReturnType<typeof createApp>;
let hash: string;
let userId: string;

function agent() {
  const a = request.agent(app);
  return {
    get: (path: string) => a.get(path),
    post: (path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body),
    delete: (path: string) => a.delete(path).set('Origin', ORIGIN),
  };
}

async function customer(email = EMAIL) {
  const a = agent();
  await a.post('/api/auth/login', { email, password: PASSWORD });
  return a;
}

async function admin() {
  const a = agent();
  await a.post('/api/admin/login', { username: 'staff', password: PASSWORD });
  return a;
}

const addApplication = async (status: ApplicationStatus = 'in_review') =>
  (await ApplicationModel.create({ user: userId, status, answers: { company: { legalName: 'Test GmbH' } } })).id as string;

type Admin = Awaited<ReturnType<typeof admin>>;
type Customer = Awaited<ReturnType<typeof customer>>;

async function ask(a: Admin, id: string, question = QUESTION) {
  await a.post(`/api/admin/applications/${id}/rfis`, { question });
  const { rfis } = (await a.get(`/api/admin/applications/${id}`)).body.application;
  return rfis.at(-1).id as string;
}

const answer = (c: Customer, rfiId: string, text = '1 Test Street') => c.post(`/api/application/rfis/${rfiId}`, { answer: text });

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init(), ApplicationModel.init()]);
  hash = await hashPassword(PASSWORD);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), UserModel.deleteMany({}), ApplicationModel.deleteMany({})]);
  await AdminModel.create({ username: 'staff', passwordHash: hash, role: 'admin' });
  const users = await UserModel.create([
    { name: 'Test Person', email: EMAIL, passwordHash: hash },
    { name: 'Other Person', email: 'other@example.com', passwordHash: hash },
  ]);
  userId = users[0]!.id;
  vi.mocked(notifyInformationRequest).mockClear();
  vi.mocked(notifyInformationRequest).mockResolvedValue(true);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('asking for information', () => {
  it('shows the question to the customer and emails them', async () => {
    const id = await addApplication();
    const a = await admin();
    const c = await customer();
    const res = await a.post(`/api/admin/applications/${id}/rfis`, { question: QUESTION });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ emailSent: true });
    expect(notifyInformationRequest).toHaveBeenCalledExactlyOnceWith(EMAIL);

    const { application } = (await c.get('/api/application')).body;
    expect(application.status).toBe('in_review');
    expect(application.rfis).toHaveLength(1);
    expect(application.rfis[0]).toMatchObject({ question: QUESTION, status: 'waiting', askedAgain: false });
    expect(application.rfis[0].askedBy).toBeUndefined();
  });

  it('still works when the email fails, and says so', async () => {
    vi.mocked(notifyInformationRequest).mockResolvedValue(false);
    const id = await addApplication();
    const res = await (await admin()).post(`/api/admin/applications/${id}/rfis`, { question: QUESTION });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ emailSent: false });
  });

  it('allows several questions, and records who asked', async () => {
    const id = await addApplication();
    const a = await admin();
    await ask(a, id, 'First question?');
    await ask(a, id, 'Second question?');
    const { rfis, rfisWaiting } = (await a.get(`/api/admin/applications/${id}`)).body.application;
    expect(rfis.map((rfi: { question: string }) => rfi.question)).toEqual(['First question?', 'Second question?']);
    expect(rfis[0].askedBy).toBe('staff');
    expect(rfisWaiting).toBe(2);
  });

  it.each(['approved', 'rejected', 'removed'] as const)('refuses a %s application', async (status) => {
    const id = await addApplication(status);
    const res = await (await admin()).post(`/api/admin/applications/${id}/rfis`, { question: QUESTION });
    expect(res.status).toBe(409);
  });

  it('refuses an empty or oversized question', async () => {
    const id = await addApplication();
    const a = await admin();
    expect((await a.post(`/api/admin/applications/${id}/rfis`, { question: '  ' })).status).toBe(400);
    expect((await a.post(`/api/admin/applications/${id}/rfis`, { question: 'x'.repeat(1001) })).status).toBe(400);
    expect((await a.post(`/api/admin/applications/${id}/rfis`, { question: { $ne: '' } })).status).toBe(400);
  });

  it('stops at 20 questions', async () => {
    const id = await addApplication();
    const a = await admin();
    for (let i = 0; i < 20; i += 1) await a.post(`/api/admin/applications/${id}/rfis`, { question: `Question ${i}` });
    expect((await a.post(`/api/admin/applications/${id}/rfis`, { question: 'One more' })).status).toBe(409);
  });

  it('needs an admin', async () => {
    const id = await addApplication();
    const c = await customer();
    expect((await c.post(`/api/admin/applications/${id}/rfis`, { question: QUESTION })).status).toBe(401);
    expect((await agent().post(`/api/admin/applications/${id}/rfis`, { question: QUESTION })).status).toBe(401);
  });
});

describe('customer answers', () => {
  it('shows the answer to the admin and to the customer', async () => {
    const id = await addApplication();
    const a = await admin();
    const c = await customer();
    const rfiId = await ask(a, id);
    expect((await answer(c, rfiId)).status).toBe(204);

    const { application } = (await a.get(`/api/admin/applications/${id}`)).body;
    expect(application.rfis[0].status).toBe('answered');
    expect(application.rfis[0].responses[0]).toMatchObject({ answer: '1 Test Street', decision: 'pending' });
    expect(application.rfisToReview).toBe(1);
    expect((await c.get('/api/application')).body.application.rfis[0]).toMatchObject({ status: 'answered', answer: '1 Test Street' });
  });

  it('can’t answer twice', async () => {
    const id = await addApplication();
    const a = await admin();
    const c = await customer();
    const rfiId = await ask(a, id);
    await answer(c, rfiId);
    expect((await answer(c, rfiId, 'Changed')).status).toBe(409);
  });

  it('can’t answer another customer’s request', async () => {
    const id = await addApplication();
    const rfiId = await ask(await admin(), id);
    const other = await customer('other@example.com');
    expect((await answer(other, rfiId)).status).toBe(409);
    expect((await ApplicationModel.findById(id))?.rfis[0]?.responses).toHaveLength(0);
  });

  it('needs a login, a valid answer and a real ID', async () => {
    const id = await addApplication();
    const rfiId = await ask(await admin(), id);
    const c = await customer();
    expect((await answer(agent(), rfiId)).status).toBe(401);
    expect((await answer(c, rfiId, '   ')).status).toBe(400);
    expect((await answer(c, rfiId, 'x'.repeat(2001))).status).toBe(400);
    expect((await answer(c, 'not-an-id')).status).toBe(404);
    expect((await answer(c, String(new mongoose.Types.ObjectId()))).status).toBe(409);
  });

  it('can’t answer once the application is decided', async () => {
    const id = await addApplication();
    const a = await admin();
    const rfiId = await ask(a, id);
    await a.post(`/api/admin/applications/${id}/reject`);
    expect((await answer(await customer(), rfiId)).status).toBe(409);
  });
});

describe('deciding a response', () => {
  async function answered() {
    const id = await addApplication();
    const a = await admin();
    const c = await customer();
    const rfiId = await ask(a, id);
    await answer(c, rfiId);
    return { id, a, c, rfiId };
  }

  it('accepts: the application can then be approved', async () => {
    const { id, a, c, rfiId } = await answered();
    expect((await a.post(`/api/admin/applications/${id}/rfis/${rfiId}/accept`)).status).toBe(200);
    const { rfis } = (await a.get(`/api/admin/applications/${id}`)).body.application;
    expect(rfis[0].status).toBe('accepted');
    expect(rfis[0].responses[0]).toMatchObject({ decision: 'accepted', decidedBy: 'staff' });
    expect((await c.get('/api/application')).body.application.rfis[0].status).toBe('accepted');
    expect((await a.post(`/api/admin/applications/${id}/approve`)).status).toBe(200);
  });

  it('rejects: the customer is asked again with no reason, and the old answer stays', async () => {
    const { id, a, c, rfiId } = await answered();
    vi.mocked(notifyInformationRequest).mockClear();
    await a.post(`/api/admin/applications/${id}/rfis/${rfiId}/reject`);
    expect(notifyInformationRequest).toHaveBeenCalledOnce();

    const mine = (await c.get('/api/application')).body.application.rfis[0];
    expect(mine).toMatchObject({ status: 'waiting', askedAgain: true });
    expect(mine.answer).toBeUndefined();
    expect(JSON.stringify(mine)).not.toMatch(/reason|staff/);

    expect((await answer(c, rfiId, 'A better answer')).status).toBe(204);
    const { rfis } = (await a.get(`/api/admin/applications/${id}`)).body.application;
    expect(rfis[0].responses.map((r: { answer: string; decision: string }) => [r.answer, r.decision])).toEqual([
      ['1 Test Street', 'rejected'],
      ['A better answer', 'pending'],
    ]);
  });

  it('can’t decide a response twice, or one not given yet', async () => {
    const { id, a, rfiId } = await answered();
    await a.post(`/api/admin/applications/${id}/rfis/${rfiId}/accept`);
    expect((await a.post(`/api/admin/applications/${id}/rfis/${rfiId}/reject`)).status).toBe(409);
    const waiting = await ask(a, id);
    expect((await a.post(`/api/admin/applications/${id}/rfis/${waiting}/accept`)).status).toBe(409);
  });

  it('decides only the question it was asked about', async () => {
    const { id, a, c, rfiId } = await answered();
    const second = await ask(a, id, 'Second question?');
    await answer(c, second, 'Second answer');
    await a.post(`/api/admin/applications/${id}/rfis/${second}/accept`);
    const { rfis } = (await a.get(`/api/admin/applications/${id}`)).body.application;
    expect(rfis.map((rfi: { status: string }) => rfi.status)).toEqual(['answered', 'accepted']);
    expect(rfiId).not.toBe(second);
  });

  it('needs an admin, and real IDs', async () => {
    const { id, a, c, rfiId } = await answered();
    expect((await c.post(`/api/admin/applications/${id}/rfis/${rfiId}/accept`)).status).toBe(401);
    expect((await a.post(`/api/admin/applications/${id}/rfis/not-an-id/accept`)).status).toBe(404);
    expect((await a.post(`/api/admin/applications/not-an-id/rfis/${rfiId}/accept`)).status).toBe(404);
  });
});

describe('deleting a question', () => {
  const remove = (a: Admin, id: string, rfiId: string) => a.delete(`/api/admin/applications/${id}/rfis/${rfiId}`);

  it('removes an unanswered question for the customer, who can no longer answer it', async () => {
    const id = await addApplication();
    const a = await admin();
    const c = await customer();
    const rfiId = await ask(a, id);
    expect((await remove(a, id, rfiId)).status).toBe(204);
    expect((await c.get('/api/application')).body.application.rfis).toEqual([]);
    expect((await answer(c, rfiId)).status).toBe(409);
  });

  it.each(['answered', 'accepted'])('removes an %s question and its answers', async (state) => {
    const id = await addApplication();
    const a = await admin();
    const c = await customer();
    const rfiId = await ask(a, id);
    await answer(c, rfiId);
    if (state === 'accepted') await a.post(`/api/admin/applications/${id}/rfis/${rfiId}/accept`);
    expect((await remove(a, id, rfiId)).status).toBe(204);
    expect((await ApplicationModel.findById(id))?.rfis).toHaveLength(0);
  });

  it('leaves other questions alone', async () => {
    const id = await addApplication();
    const a = await admin();
    const first = await ask(a, id, 'First question?');
    await ask(a, id, 'Second question?');
    await remove(a, id, first);
    const { rfis } = (await a.get(`/api/admin/applications/${id}`)).body.application;
    expect(rfis.map((rfi: { question: string }) => rfi.question)).toEqual(['Second question?']);
  });

  it('unblocks approval', async () => {
    const id = await addApplication();
    const a = await admin();
    const rfiId = await ask(a, id);
    expect((await a.post(`/api/admin/applications/${id}/approve`)).status).toBe(409);
    await remove(a, id, rfiId);
    expect((await a.post(`/api/admin/applications/${id}/approve`)).status).toBe(200);
  });

  it('keeps questions once the application is decided', async () => {
    const id = await addApplication();
    const a = await admin();
    const rfiId = await ask(a, id);
    await a.post(`/api/admin/applications/${id}/reject`);
    expect((await remove(a, id, rfiId)).status).toBe(409);
    expect((await ApplicationModel.findById(id))?.rfis).toHaveLength(1);
  });

  it('needs an admin and real IDs', async () => {
    const id = await addApplication();
    const a = await admin();
    const rfiId = await ask(a, id);
    const c = await customer();
    expect((await c.delete(`/api/admin/applications/${id}/rfis/${rfiId}`)).status).toBe(401);
    expect((await agent().delete(`/api/admin/applications/${id}/rfis/${rfiId}`)).status).toBe(401);
    expect((await remove(a, id, 'not-an-id')).status).toBe(404);
    expect((await remove(a, id, String(new mongoose.Types.ObjectId()))).status).toBe(409);
    expect((await ApplicationModel.findById(id))?.rfis).toHaveLength(1);
  });
});

describe('the application decision', () => {
  it('can’t be approved while a request is waiting or a response is undecided', async () => {
    const id = await addApplication();
    const a = await admin();
    const rfiId = await ask(a, id);
    const blocked = await a.post(`/api/admin/applications/${id}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('before approving');
    await answer(await customer(), rfiId);
    expect((await a.post(`/api/admin/applications/${id}/approve`)).status).toBe(409);
    expect((await ApplicationModel.findById(id))?.status).toBe('in_review');
  });

  it('can still be rejected with a request open', async () => {
    const id = await addApplication();
    const a = await admin();
    await ask(a, id);
    expect((await a.post(`/api/admin/applications/${id}/reject`)).status).toBe(200);
  });

  it('starts with no requests on a new application', async () => {
    const id = await addApplication();
    const a = await admin();
    await ask(a, id);
    await a.post(`/api/admin/applications/${id}/reject`);
    await addApplication();
    expect((await (await customer()).get('/api/application')).body.application.rfis).toEqual([]);
  });
});
