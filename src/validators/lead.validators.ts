import { z } from 'zod';
import { LEAD_OPTIONS as OPTIONS } from '../config/leadOptions';

const text = z.string().trim().min(1).max(200);
const oneOf = (list: string[]) => z.string().refine((value) => list.includes(value));

export const leadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  role: oneOf(OPTIONS.roles),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{6,25}$/),
  company: text,
  registeredIn: oneOf(OPTIONS.countries),
  website: text,
  business: oneOf(OPTIONS.businessTypes),
  uses: z
    .array(oneOf(OPTIONS.uses))
    .min(1)
    .max(OPTIONS.uses.length)
    .refine((values) => new Set(values).size === values.length),
  monthlyTotal: oneOf(OPTIONS.monthlyTotals),
  payToday: oneOf(OPTIONS.payToday),
  channel: oneOf(OPTIONS.channels),
  telegram: z.string().trim().max(100).optional(),
  // Hidden from people. Bots fill it in.
  nickname: z.string().max(200).optional(),
});
