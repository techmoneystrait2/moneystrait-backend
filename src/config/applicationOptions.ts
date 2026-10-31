import { RESTRICTED } from './restricted';

// The approved choices for every list in the application. The form shows these and the
// validators refuse anything else, so free text can't get into these fields.

const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');

const NAME_OVERRIDES: Record<string, string> = {
  CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo',
  HK: 'Hong Kong',
  MM: 'Myanmar',
  MO: 'Macao',
  PS: 'Palestine',
  TR: 'Turkey',
};

const regionNames = new Intl.DisplayNames('en', { type: 'region' });

const sortNames = (names: string[]) => names.sort((a, b) => a.localeCompare(b, 'en'));

const allowedCountries = sortNames(
  COUNTRY_CODES.map((code) => NAME_OVERRIDES[code] ?? regionNames.of(code) ?? code).filter(
    (name) => !RESTRICTED.includes(name),
  ),
);

export const APPLICATION_OPTIONS = {
  // Restricted places stay selectable here, so a customer is told at once that we can't serve them.
  registrationCountries: sortNames([...allowedCountries, ...RESTRICTED]),
  // Where money can go or be held: restricted places aren't offered at all.
  countries: allowedCountries,
  restricted: [...RESTRICTED],
  businessTypes: ['Wholesale and import', 'Export and trade', 'Online selling', 'Payment company', 'Crypto business', 'Agency, IT or services', 'Manufacturing', 'Other'],
  roles: ['Owner or director', 'Finance manager', 'Operations', 'Other'],
  services: ['Payments', 'Crypto', 'OTC desk'],
  currencies: ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'CHF', 'USDT', 'USDC', 'BTC', 'ETH'],
  paymentsPerMonth: ['1 to 10', '11 to 50', '51 to 200', 'Over 200'],
  monthlyTotals: ['Under $50,000', '$50,000 to $250,000', '$250,000 to $1 million', '$1 million to $5 million', 'Over $5 million'],
  largestPayments: ['Under $10,000', '$10,000 to $50,000', '$50,000 to $250,000', '$250,000 to $1 million', 'Over $1 million'],
  payees: ['Companies', 'People', 'Both'],
  sourcesOfFunds: ['Company revenue', 'Investment or funding', 'Clients’ money, under our licence', 'Other'],
  networks: ['TRON', 'Ethereum', 'BNB Smart Chain', 'Solana', 'Bitcoin'],
  licensed: ['Yes', 'No', 'Not applicable'],
};
