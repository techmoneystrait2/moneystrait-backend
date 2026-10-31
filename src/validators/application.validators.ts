import { z } from 'zod';
import { APPLICATION_OPTIONS as OPTIONS } from '../config/applicationOptions';

const text = z.string().trim().min(1).max(200);
const optionalText = z.string().trim().max(200).optional();
const longText = z.string().trim().min(1).max(1000);

// A value from an approved list; anything else is refused, even if the form is bypassed.
const oneOf = (list: string[]) => z.string().refine((value) => list.includes(value));

// One or more distinct values from an approved list.
const someOf = (list: string[], min = 1) =>
  z
    .array(oneOf(list))
    .min(min)
    .max(list.length)
    .refine((values) => new Set(values).size === values.length);

const person = z
  .object({
    name: text,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    role: z.enum(['director', 'owner', 'both']),
    share: z.number().min(0).max(100).optional(),
  })
  .refine((value) => value.role === 'director' || value.share !== undefined);

const bankAccount = z.object({
  bank: text,
  country: oneOf(OPTIONS.countries),
  holder: text,
  accountNumber: z.string().trim().min(4).max(40),
});

export const applicationSchema = z.object({
  company: z.object({
    country: oneOf(OPTIONS.registrationCountries),
    legalName: text,
    registrationNumber: text,
    business: oneOf(OPTIONS.businessTypes),
    address: longText,
    website: optionalText,
    role: oneOf(OPTIONS.roles),
    authorised: z.literal(true),
  }),
  people: z.array(person).min(1).max(20),
  usage: z
    .object({
      services: someOf(OPTIONS.services),
      currencies: someOf(OPTIONS.currencies),
      countries: someOf(OPTIONS.countries),
      paymentsPerMonth: oneOf(OPTIONS.paymentsPerMonth),
      monthlyTotal: oneOf(OPTIONS.monthlyTotals),
      largestPayment: oneOf(OPTIONS.largestPayments),
      payees: oneOf(OPTIONS.payees),
      paymentPurpose: longText,
      sourceOfFunds: oneOf(OPTIONS.sourcesOfFunds),
      sourceDetails: z.string().trim().max(1000).optional(),
      networks: someOf(OPTIONS.networks, 0),
      licensed: oneOf(OPTIONS.licensed),
      regulator: optionalText,
      licenceNumber: optionalText,
    })
    .refine((value) => value.licensed !== 'Yes' || Boolean(value.regulator && value.licenceNumber)),
  bankAccounts: z.array(bankAccount).min(1).max(5),
  declarations: z.object({
    trueAndComplete: z.literal(true),
    actsForItself: z.literal(true),
    agreesToTerms: z.literal(true),
  }),
});
