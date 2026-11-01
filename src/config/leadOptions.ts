import { APPLICATION_OPTIONS } from './applicationOptions';

// The approved choices for the Talk to us form (brief section 6.1).
export const LEAD_OPTIONS = {
  roles: ['Owner or director', 'Finance', 'Operations', 'Other'],
  // Restricted places stay selectable, so a visitor is told at once that we can't serve them.
  countries: APPLICATION_OPTIONS.registrationCountries,
  restricted: APPLICATION_OPTIONS.restricted,
  businessTypes: ['Import, export and trade', 'Online selling', 'Payment company', 'Crypto business', 'Agency, IT or services', 'Manufacturing', 'Other'],
  uses: ['Pay suppliers', 'Pay staff or freelancers', 'Payouts for our clients', 'Buy or sell crypto', 'Deals over $25,000'],
  monthlyTotals: APPLICATION_OPTIONS.monthlyTotals,
  payToday: ['Through my bank', 'An exchange company or agent', 'A payment app', 'Crypto', 'Not paying abroad yet'],
  channels: ['Phone call', 'WhatsApp', 'Telegram'],
};

export const DESK_USE = 'Deals over $25,000';
export const DESK_TOTALS = ['$1 million to $5 million', 'Over $5 million'];
export const FREE_EMAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com'];
