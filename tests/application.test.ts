import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/config/db';
import { AdminModel } from '../src/models/admin.model';
import { ApplicationModel } from '../src/models/application.model';
import { UserModel } from '../src/models/user.model';
import { hashPassword } from '../src/services/password.service';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'test-pass-1';

const form = {
  company: {
    country: 'Switzerland',
    legalName: 'Test Imports GmbH',
    registrationNumber: 'CHE-123.456.789',
    business: 'Wholesale and import',
    address: '1 Test Street, Zug',
    role: 'Finance manager',
    authorised: true,
  },
  people: [{ name: 'Test Person', email: 'person@example.com', role: 'both', share: 60 }],
  usage: {
    services: ['Payments'],
    currencies: ['USD'],
    countries: ['China'],
    paymentsPerMonth: '1 to 10',
    monthlyTotal: '$50,000 to $250,000',
    largestPayment: '$10,000 to $50,000',
    payees: 'Companies',
    paymentPurpose: 'Paying suppliers',
    sourceOfFunds: 'Company revenue',
    networks: [],
    licensed: 'Not applicable',
  },
  bankAccounts: [{ bank: 'Test Bank', country: 'Switzerland', holder: 'Test Imports GmbH', accountNumber: 'CH9300762011623852957' }],
  declarations: { trueAndComplete: true, actsForItself: true, agreesToTerms: true },
};

let app: ReturnType<typeof createApp>;
let hash: string;

function agent() {
  const a = request.agent(app);
  return {
    get: (path: string) => a.get(path),
    post: (path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body),
  };
}

async function customer(email = 'person@example.com') {
  const a = agent();
  await a.post('/api/auth/login', { email, password: PASSWORD });
  return a;
}

async function admin() {
  const a = agent();
  await a.post('/api/admin/login', { username: 'staff', password: PASSWORD });
  return a;
}

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), UserModel.init(), ApplicationModel.init()]);
  hash = await hashPassword(PASSWORD);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), UserModel.deleteMany({}), ApplicationModel.deleteMany({})]);
  await AdminModel.create({ username: 'staff', passwordHash: hash, role: 'admin' });
  await UserModel.create([
    { name: 'Test Person', email: 'person@example.com', passwordHash: hash },
    { name: 'Other Person', email: 'other@example.com', passwordHash: hash },
  ]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function submitAs(a: Awaited<ReturnType<typeof customer>>) {
  const res = await a.post('/api/application', form);
  return res.body.application?.id as string;
}

describe('customer application', () => {
  it('gives a logged-in customer the approved lists', async () => {
    expect((await agent().get('/api/application/options')).status).toBe(401);
    const { options } = (await (await customer()).get('/api/application/options')).body;
    expect(options.countries).toContain('Switzerland');
    expect(options.countries).toContain('Hong Kong');
    expect(options.countries).not.toContain('Iran');
    expect(options.registrationCountries).toContain('Iran');
    expect(options.countries.length).toBeGreaterThan(230);
    expect(new Set(options.countries).size).toBe(options.countries.length);
    expect(options.countries.every((name: string) => !/^[A-Z]{2}$/.test(name))).toBe(true);
    expect(options.currencies).toContain('USDT');
  });

  it('needs a customer login', async () => {
    expect((await agent().get('/api/application')).status).toBe(401);
    expect((await agent().post('/api/application', form)).status).toBe(401);
  });

  it('starts empty, then shows in review after submitting', async () => {
    const c = await customer();
    expect((await c.get('/api/application')).body.application).toBeNull();
    expect((await c.post('/api/application', form)).status).toBe(201);
    const { application } = (await c.get('/api/application')).body;
    expect(application.status).toBe('in_review');
    expect(application.answers.company.legalName).toBe('Test Imports GmbH');
  });

  it('refuses a second application while one is in review', async () => {
    const c = await customer();
    await submitAs(c);
    expect((await c.post('/api/application', form)).status).toBe(409);
    expect(await ApplicationModel.countDocuments()).toBe(1);
  });

  it('allows only one when two arrive together', async () => {
    const c = await customer();
    const results = await Promise.all([c.post('/api/application', form), c.post('/api/application', form)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ApplicationModel.countDocuments()).toBe(1);
  });

  it.each(['Iran', 'North Korea', 'Cuba', 'Crimea'])('refuses a company registered in %s', async (country) => {
    const c = await customer();
    const res = await c.post('/api/application', { ...form, company: { ...form.company, country } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at the moment');
    expect(await ApplicationModel.countDocuments()).toBe(0);
  });

  it.each([
    ['no company', { ...form, company: undefined }],
    ['no owners', { ...form, people: [] }],
    ['no bank account', { ...form, bankAccounts: [] }],
    ['an unticked declaration', { ...form, declarations: { ...form.declarations, agreesToTerms: false } }],
    ['an owner with no share', { ...form, people: [{ name: 'A B', email: 'a@example.com', role: 'owner' }] }],
    ['licensed with no number', { ...form, usage: { ...form.usage, licensed: 'Yes' } }],
    ['the authorised box unticked', { ...form, company: { ...form.company, authorised: false } }],
    ['a typed country', { ...form, company: { ...form.company, country: 'Atlantis' } }],
    ['a different spelling of a country', { ...form, company: { ...form.company, country: 'switzerland' } }],
    ['a country that isn’t a string', { ...form, company: { ...form.company, country: { $ne: '' } } }],
    ['an unknown bank country', { ...form, bankAccounts: [{ ...form.bankAccounts[0], country: 'Atlantis' }] }],
    ['a bank in a restricted country', { ...form, bankAccounts: [{ ...form.bankAccounts[0], country: 'Iran' }] }],
    ['an unknown currency', { ...form, usage: { ...form.usage, currencies: ['XXX'] } }],
    ['the same currency twice', { ...form, usage: { ...form.usage, currencies: ['USD', 'USD'] } }],
    ['an unknown pay country', { ...form, usage: { ...form.usage, countries: ['Atlantis'] } }],
    ['a restricted pay country', { ...form, usage: { ...form.usage, countries: ['China', 'Iran'] } }],
    ['no pay countries', { ...form, usage: { ...form.usage, countries: [] } }],
    ['an unknown service', { ...form, usage: { ...form.usage, services: ['Loans'] } }],
    ['an unknown network', { ...form, usage: { ...form.usage, networks: ['Dogechain'] } }],
    ['an unknown business type', { ...form, company: { ...form.company, business: 'Typed text' } }],
    ['a typed payment count', { ...form, usage: { ...form.usage, paymentsPerMonth: '10' } }],
  ])('refuses %s', async (_label, body) => {
    const c = await customer();
    expect((await c.post('/api/application', body)).status).toBe(400);
  });

  it('drops fields it does not know', async () => {
    const c = await customer();
    await c.post('/api/application', { ...form, status: 'approved', user: 'someone', extra: { $gt: '' } });
    const stored = await ApplicationModel.findOne();
    expect(stored?.status).toBe('in_review');
    expect(stored?.answers.extra).toBeUndefined();
  });

  it('never shows one customer another customer’s application', async () => {
    await submitAs(await customer());
    const other = await customer('other@example.com');
    expect((await other.get('/api/application')).body.application).toBeNull();
  });
});

describe('admin review', () => {
  it('needs an admin login, not a customer one', async () => {
    const c = await customer();
    const id = await submitAs(c);
    expect((await agent().get('/api/admin/applications')).status).toBe(401);
    expect((await c.get('/api/admin/applications')).status).toBe(401);
    expect((await c.get(`/api/admin/applications/${id}`)).status).toBe(401);
    expect((await c.post(`/api/admin/applications/${id}/approve`)).status).toBe(401);
    expect((await ApplicationModel.findById(id))?.status).toBe('in_review');
  });

  it('lists a new entry with the customer, and shows every answer', async () => {
    const id = await submitAs(await customer());
    const a = await admin();
    const list = (await a.get('/api/admin/applications')).body;
    expect(list.inReview).toBe(1);
    expect(list.applications[0]).toMatchObject({ company: 'Test Imports GmbH', status: 'in_review' });
    expect(list.applications[0].customer.email).toBe('person@example.com');
    const detail = (await a.get(`/api/admin/applications/${id}`)).body.application;
    expect(detail.answers.bankAccounts[0].bank).toBe('Test Bank');
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|\$2b\$/);
  });

  it('filters by status and counts in the overview', async () => {
    await submitAs(await customer());
    const a = await admin();
    expect((await a.get('/api/admin/applications?status=approved')).body.total).toBe(0);
    expect((await a.get('/api/admin/applications?status=in_review')).body.total).toBe(1);
    expect((await a.get('/api/admin/overview')).body.stats.applicationsInReview).toBe(1);
  });

  it('approves: the customer sees approved and can’t apply again', async () => {
    const c = await customer();
    const id = await submitAs(c);
    const res = await (await admin()).post(`/api/admin/applications/${id}/approve`);
    expect(res.body.application).toMatchObject({ status: 'approved', reviewedBy: 'staff' });
    expect((await c.get('/api/application')).body.application.status).toBe('approved');
    expect((await c.post('/api/application', form)).status).toBe(409);
  });

  it('rejects with no reason, and the customer can apply again with history kept', async () => {
    const c = await customer();
    const id = await submitAs(c);
    const a = await admin();
    await a.post(`/api/admin/applications/${id}/reject`);
    const { application } = (await c.get('/api/application')).body;
    expect(application.status).toBe('rejected');
    expect(application.reason).toBeUndefined();
    expect(application.reviewedBy).toBeUndefined();

    const second = await submitAs(c);
    expect(second).not.toBe(id);
    expect((await c.get('/api/application')).body.application.status).toBe('in_review');
    expect(await ApplicationModel.countDocuments()).toBe(2);
    expect((await a.get(`/api/admin/applications/${second}`)).body.application.attempts).toBe(2);
  });

  it('can’t decide the same application twice', async () => {
    const id = await submitAs(await customer());
    const a = await admin();
    await a.post(`/api/admin/applications/${id}/approve`);
    expect((await a.post(`/api/admin/applications/${id}/reject`)).status).toBe(409);
    expect((await ApplicationModel.findById(id))?.status).toBe('approved');
  });

  it('handles an unknown or bad ID', async () => {
    const a = await admin();
    expect((await a.get('/api/admin/applications/not-an-id')).status).toBe(404);
    expect((await a.post(`/api/admin/applications/${new mongoose.Types.ObjectId()}/approve`)).status).toBe(404);
  });

  it('ignores an unknown status filter', async () => {
    await submitAs(await customer());
    const res = await (await admin()).get('/api/admin/applications?status[$ne]=x');
    expect(res.body.total).toBe(1);
  });
});
