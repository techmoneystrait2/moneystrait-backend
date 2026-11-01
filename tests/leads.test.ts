import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { LeadModel } from '../src/models/lead.model';
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
const form = {
  name: 'Pat Doe',
  role: 'Finance',
  email: 'pat@kestrel.example',
  phone: '+49 30 123456',
  company: 'Kestrel GmbH',
  registeredIn: 'Germany',
  website: 'kestrel.example',
  business: 'Online selling',
  uses: ['Pay suppliers'],
  monthlyTotal: 'Under $50,000',
  payToday: 'Through my bank',
  channel: 'WhatsApp',
};

let app: ReturnType<typeof createApp>;

const website = (body: object) => request(app).post('/api/leads').set('Origin', ORIGIN).send(body);
const mobile = (body: object, token?: string) => {
  const r = request(app).post('/api/mobile/leads');
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};

async function adminToken() {
  await AdminModel.create({ username: 'staff', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
  return (await request(app).post('/api/mobile/admin/login').send({ username: 'staff', password: PASSWORD })).body.accessToken as string;
}
const adminGet = (path: string, token: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);

async function signUp() {
  return (await request(app).post('/api/mobile/auth/signup').send({ name: 'Real Customer', email: 'real@example.com', password: PASSWORD })).body as { accessToken: string; user: { id: string } };
}

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init(), MobileSessionModel.init(), LeadModel.init()]);
  app = createApp({ authLimit: 1000, leadLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), UserModel.deleteMany({}), MobileSessionModel.deleteMany({}), LeadModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('sending the form', () => {
  it('serves the lists to anyone', async () => {
    const res = await request(app).get('/api/leads/options');
    expect(res.status).toBe(200);
    expect(res.body.options.roles).toContain('Finance');
  });

  it('saves a logged-out visitor from the website', async () => {
    expect((await website(form)).status).toBe(201);
    const lead = await LeadModel.findOne();
    expect(lead).toMatchObject({ submittedBy: 'visitor', source: 'website', company: 'Kestrel GmbH' });
    expect(lead?.customer).toBeUndefined();
  });

  it('marks a logged-in website customer', async () => {
    await UserModel.deleteMany({});
    const web = request.agent(app);
    await web.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Web Customer', email: 'web@example.com', password: PASSWORD });
    expect((await web.post('/api/leads').set('Origin', ORIGIN).send(form)).status).toBe(201);
    const user = await UserModel.findOne({ email: 'web@example.com' });
    const lead = await LeadModel.findOne();
    expect(lead?.submittedBy).toBe('customer');
    expect(String(lead?.customer)).toBe(user?.id);
  });

  it('saves a logged-out visitor from the app, and marks a logged-in one', async () => {
    expect((await mobile(form)).status).toBe(201);
    const { accessToken, user } = await signUp();
    expect((await mobile(form, accessToken)).status).toBe(201);
    const leads = await LeadModel.find().sort({ createdAt: 1 });
    expect(leads.map((lead) => lead.submittedBy)).toEqual(['visitor', 'customer']);
    expect(leads.every((lead) => lead.source === 'app')).toBe(true);
    expect(String(leads[1]?.customer)).toBe(user.id);
  });

  it('never trusts the form to say who sent it', async () => {
    const { user } = await signUp();
    await website({ ...form, submittedBy: 'customer', customer: user.id });
    const lead = await LeadModel.findOne();
    expect(lead?.submittedBy).toBe('visitor');
    expect(lead?.customer).toBeUndefined();
  });

  it('refuses an expired app token, so the app can refresh and try again', async () => {
    expect((await mobile(form, 'stale-token')).status).toBe(401);
    expect(await LeadModel.countDocuments()).toBe(0);
  });

  it('refuses another site', async () => {
    expect((await request(app).post('/api/leads').set('Origin', 'https://evil.example').send(form)).status).toBe(403);
  });

  it('creates no lead for a restricted country', async () => {
    const res = await website({ ...form, registeredIn: 'Iran' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Iran');
    expect(await LeadModel.countDocuments()).toBe(0);
  });

  it('refuses bad fields and values outside the lists', async () => {
    const res = await website({ ...form, email: 'nope', role: 'CEO', uses: [] });
    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual(expect.arrayContaining(['email', 'role', 'uses']));
  });

  it('quietly drops a bot that fills the hidden field', async () => {
    expect((await website({ ...form, nickname: 'bot' })).status).toBe(201);
    expect(await LeadModel.countDocuments()).toBe(0);
  });

  it('flags desk deals and free email addresses', async () => {
    await website({ ...form, email: 'pat@gmail.com', uses: ['Deals over $25,000'] });
    expect(await LeadModel.findOne()).toMatchObject({ desk: true, freeEmail: true });
  });

  it('limits each address', async () => {
    const limited = createApp({ authLimit: 1000, leadLimit: 1 });
    const send = () => request(limited).post('/api/leads').set('Origin', ORIGIN).send(form);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });
});

describe('forms in the admin panel', () => {
  it('needs an admin, and a customer token is not enough', async () => {
    const { accessToken } = await signUp();
    expect((await request(app).get('/api/admin/leads')).status).toBe(401);
    expect((await adminGet('/api/admin/leads', accessToken)).status).toBe(401);
  });

  it('shows who sent each form', async () => {
    const token = await adminToken();
    const { accessToken } = await signUp();
    await website(form);
    await mobile(form, accessToken);

    const all = await adminGet('/api/admin/leads', token);
    expect(all.body.total).toBe(2);
    const [newest, oldest] = all.body.leads;
    expect(newest).toMatchObject({ submittedBy: 'customer', customer: { name: 'Real Customer', email: 'real@example.com' }, accountDeleted: false });
    expect(oldest).toMatchObject({ submittedBy: 'visitor', customer: null, accountDeleted: false });
  });

  it('finds forms by name or email, in any case, and treats the search as plain text', async () => {
    const token = await adminToken();
    await website(form);
    await website({ ...form, name: 'Lee Other', email: 'lee@other.example' });
    const search = async (text: string) => (await adminGet(`/api/admin/leads?search=${encodeURIComponent(text)}`, token)).body.leads.map((lead: { name: string }) => lead.name);
    expect(await search('PAT')).toEqual(['Pat Doe']);
    expect(await search('lee@other')).toEqual(['Lee Other']);
    expect(await search('example')).toHaveLength(2);
    expect(await search('.*')).toEqual([]);
    expect(await search('nobody')).toEqual([]);
  });

  it('still marks a customer whose account was deleted', async () => {
    const token = await adminToken();
    const { accessToken, user } = await signUp();
    await mobile(form, accessToken);
    await UserModel.findByIdAndDelete(user.id);
    const res = await adminGet('/api/admin/leads', token);
    expect(res.body.leads[0]).toMatchObject({ submittedBy: 'customer', customer: null, accountDeleted: true });
  });

  it('opens one form, and answers 404 for an unknown one', async () => {
    const token = await adminToken();
    await website(form);
    const lead = await LeadModel.findOne();
    expect((await adminGet(`/api/admin/leads/${lead?.id}`, token)).body.lead.company).toBe('Kestrel GmbH');
    expect((await adminGet('/api/admin/leads/not-an-id', token)).status).toBe(404);
    expect((await adminGet(`/api/admin/leads/${new mongoose.Types.ObjectId()}`, token)).status).toBe(404);
  });

  it('deletes a form', async () => {
    const token = await adminToken();
    await website(form);
    const lead = await LeadModel.findOne();
    const remove = () => request(app).delete(`/api/admin/leads/${lead?.id}`).set('Authorization', `Bearer ${token}`);
    expect((await remove()).status).toBe(204);
    expect(await LeadModel.countDocuments()).toBe(0);
    expect((await remove()).status).toBe(404);
  });
});
