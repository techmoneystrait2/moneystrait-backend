import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { APPLICATION_OPTIONS } from '../src/config/applicationOptions';
import { connectDb } from '../src/config/db';
import { CATALOGUE_SOURCE_CODES, PAYMENT_COUNTRIES } from '../src/config/paymentCountries';
import { AdminModel } from '../src/models/admin.model';
import { RemovedCountryModel } from '../src/models/removedCountry.model';
import { hashPassword } from '../src/services/password.service';

vi.mock('../src/services/email.service', () => ({
  isEmailConfigured: vi.fn(() => true),
  notifyAccountDeleted: vi.fn(async () => true),
  notifyInformationRequest: vi.fn(async () => true),
  sendPasswordResetCode: vi.fn(async () => undefined),
}));

const PASSWORD = 'test-pass-1';
let app: ReturnType<typeof createApp>;
let token: string;

const live = async () => (await request(app).get('/api/countries')).body.countries as { code: string }[];
const admin = (action: string, codes: string[]) => request(app).post(`/api/admin/countries/${action}`).set('Authorization', `Bearer ${token}`).send({ codes });

beforeAll(async () => {
  await connectDb();
  await Promise.all([AdminModel.init(), RemovedCountryModel.init()]);
  app = createApp({ authLimit: 1000 });
});

beforeEach(async () => {
  await Promise.all([AdminModel.deleteMany({}), RemovedCountryModel.deleteMany({})]);
  await AdminModel.create({ username: 'staff', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
  token = (await request(app).post('/api/mobile/admin/login').send({ username: 'staff', password: PASSWORD })).body.accessToken;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('the catalogue', () => {
  it('covers every country except the restricted ones, once each', () => {
    const codes = PAYMENT_COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(CATALOGUE_SOURCE_CODES.filter((code) => !['CU', 'IR', 'KP'].includes(code)).sort());
    expect(PAYMENT_COUNTRIES.map((country) => country.name).sort()).toEqual([...APPLICATION_OPTIONS.countries].sort());
  });

  it('gives each one a region and a currency', () => {
    expect(PAYMENT_COUNTRIES.every((country) => country.region && /^[A-Z]{3}$/.test(country.currency))).toBe(true);
    expect(PAYMENT_COUNTRIES.find((country) => country.code === 'PK')).toEqual({ code: 'PK', name: 'Pakistan', region: 'Asia', currency: 'PKR' });
  });
});

describe('managing countries', () => {
  it('starts with every country live, for anyone to read', async () => {
    expect(await live()).toHaveLength(PAYMENT_COUNTRIES.length);
  });

  it('needs an admin', async () => {
    expect((await request(app).get('/api/admin/countries')).status).toBe(401);
    expect((await request(app).post('/api/admin/countries/remove').set('Authorization', 'Bearer fake').send({ codes: ['PK'] })).status).toBe(401);
  });

  it('removes several at once, and adds them back', async () => {
    const removed = await admin('remove', ['PK', 'DE']);
    expect(removed.status).toBe(200);
    expect(removed.body.countries.filter((country: { live: boolean }) => !country.live).map((country: { code: string }) => country.code).sort()).toEqual(['DE', 'PK']);
    expect((await live()).map((country) => country.code)).not.toContain('PK');
    expect((await admin('add', ['PK'])).status).toBe(200);
    const codes = (await live()).map((country) => country.code);
    expect(codes).toContain('PK');
    expect(codes).not.toContain('DE');
  });

  it('copes with removing the same country twice', async () => {
    await admin('remove', ['PK']);
    expect((await admin('remove', ['PK'])).status).toBe(200);
    expect(await RemovedCountryModel.countDocuments()).toBe(1);
  });

  it('refuses a restricted country, an unknown code and an empty list', async () => {
    expect((await admin('add', ['IR'])).status).toBe(400);
    expect((await admin('remove', ['ZZ'])).status).toBe(400);
    expect((await admin('remove', [])).status).toBe(400);
  });

  it('never lists a restricted country', async () => {
    const codes = (await request(app).get('/api/admin/countries').set('Authorization', `Bearer ${token}`)).body.countries.map((country: { code: string }) => country.code);
    expect(codes).not.toEqual(expect.arrayContaining(['CU']));
    expect(codes).not.toContain('IR');
    expect(codes).not.toContain('KP');
  });
});
