import type { RequestHandler } from 'express';
import { PAYMENT_COUNTRIES } from '../config/paymentCountries';
import { RESTRICTED } from '../config/restricted';
import { RemovedCountryModel } from '../models/removedCountry.model';

async function removedCodes(): Promise<Set<string>> {
  const removed = await RemovedCountryModel.find().lean();
  return new Set(removed.map((country) => country.code));
}

// Public: the Countries page lists only what admins have left live.
export const listLiveCountries: RequestHandler = async (_req, res) => {
  const removed = await removedCodes();
  res.json({ countries: PAYMENT_COUNTRIES.filter((country) => !removed.has(country.code)), restricted: RESTRICTED });
};

async function sendAdminList(res: Parameters<RequestHandler>[1]) {
  const removed = await removedCodes();
  res.json({ countries: PAYMENT_COUNTRIES.map((country) => ({ ...country, live: !removed.has(country.code) })) });
}

export const listAdminCountries: RequestHandler = async (_req, res) => {
  await sendAdminList(res);
};

export const removeCountries: RequestHandler = async (req, res) => {
  const codes: string[] = req.body.codes;
  await RemovedCountryModel.bulkWrite(codes.map((code) => ({ updateOne: { filter: { code }, update: { $setOnInsert: { code } }, upsert: true } })));
  await sendAdminList(res);
};

export const addCountries: RequestHandler = async (req, res) => {
  await RemovedCountryModel.deleteMany({ code: { $in: req.body.codes } });
  await sendAdminList(res);
};
