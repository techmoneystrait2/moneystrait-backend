import { z } from 'zod';
import { PAYMENT_COUNTRY_CODES } from '../config/paymentCountries';

// Restricted countries aren't in the catalogue, so they can never be added.
export const countryCodesSchema = z.object({
  codes: z
    .array(z.string().refine((code) => PAYMENT_COUNTRY_CODES.includes(code)))
    .min(1)
    .max(PAYMENT_COUNTRY_CODES.length),
});
