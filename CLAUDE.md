# Moneystrait backend

The API behind `moneystrait.com` for Halvern LLC, trading as Moneystrait: the Talk to us form, Open an account, Sumsub checks, emails and the staff page's data. It is built like a small financial product, not a brochure. The frontend is a separate repo and reaches this one only through `/api/*`. This file stands alone.

## Stack

Node.js with Express, written in TypeScript, and MongoDB. Sumsub is decided. Suggested, each behind an interface so a vendor can be swapped: Cal.com or Calendly (booking), HubSpot or Pipedrive (CRM), Postmark or Amazon SES (email), Cloudflare Turnstile (bots), Sentry and an uptime monitor. Hosting: Vercel or Cloudflare with a web application firewall.

## Commands

Copy `.env.example` to `.env` first. Tests need MongoDB on `127.0.0.1:27017` and use a throwaway database.

```bash
npm run dev
npm run build && npm start
npm run seed
npm run lint
npm run typecheck
npm test
```

## Structure (MVC)

`src/config` (env, db, session) · `src/models` · `src/controllers` · `src/routes` · `src/middleware` · `src/validators` · `src/services` (vendor clients).

- Deny by default: `requireAuth` runs in `src/app.ts` before every route except signup, login and Google sign-in. Add new routes below it. A new public route needs an explicit reason. Admins are a separate `Admin` model with their own login and `/api/admin/*` routes behind `requireAdmin`; `requireSuperadmin` guards creating and deleting admins and changing credentials. API responses never include password hashes. Customers apply through `/api/application`: each submission is its own `Application` record, one can be in review or approved at a time, an admin approves or rejects it, and a rejected customer can apply again. Admins can remove an application at any time: it becomes `removed`, the customer gets a blank form, and the record stays for compliance. Admins can send requests for information (RFIs) on an application in review: a rejected response reopens the question with no reason, and approval waits until every response is accepted. Deleting a customer removes the login, keeps their applications as removed, and emails them. List fields accept only values from `src/config/applicationOptions.ts`, which the form loads from `/api/application/options`. Rejections never carry a reason, and `src/config/restricted.ts` stands in for the CMS restricted list. `npm run seed` creates the one super admin from `SEED_SUPERADMIN_*` and changes nothing if one exists.
- Password reset emails a 6-digit code, stored hashed, valid 5 minutes, 5 tries, one email a minute; replies never reveal whether an account exists. Email uses `SMTP_*` and `EMAIL_FROM`, required in production. Customers sign in two ways: the website uses a cookie through `/api/auth/*`, and the mobile app (React Native + Expo) uses bearer tokens from `/api/mobile/auth/*`. Protected customer routes accept both, so build every new one for both, with logic here and not in the Next.js frontend. Admin routes accept the website's cookie or an admin bearer token from `/api/mobile/admin/*`. Admin tokens live in their own `AdminMobileSession` collection, end after 60 minutes without activity, and are never interchangeable with customer tokens. Passwords are bcrypt hashes (12 rounds). Sessions live in MongoDB in an HttpOnly cookie. Non-GET requests must come from `FRONTEND_ORIGIN`.
- Google sign-in verifies the ID token on the server. Only a verified Google email is accepted; the first time it links to an existing email, it removes that password and ends its sessions. Google accounts start with no password and can set one once at `POST /api/auth/password/set`; after that they change it like anyone else, and a later Google login leaves it alone.

## Hard rules (also in the frontend repo; change both)

- No public prices: no Moneystrait price, rate, fee, margin, range or saving figure in pages, metadata, structured data, ad landing pages or emails. Rates appear only in the rate letter, sent to approved companies.
- Registered businesses only, funded only from their own bank accounts or verified wallets. They can pay companies or people. Never offer "get paid", payment links, invoicing or collecting from third parties.
- Name a regulator only while its licence row is published and its evidence is on file. Never "licensed in [country]". FinCEN and FINTRAC are registrations: never call them licences.
- Name MiCA only with a MiCA CASP authorisation. USDT is not offered to EU or EEA companies.
- Restricted at launch: Cuba, Iran, North Korea, and the Crimea, Donetsk and Luhansk regions of Ukraine. The list lives in the CMS and is never hard-coded.
- Messages about checks stay neutral. A refused application never gets a reason.
- No ID images, company documents or ID numbers on our side; Sumsub keeps them. No personal data in logs or analytics.
- Nothing goes live with a [bracket] placeholder. Sample names and amounts are never presented as real.
- Never hard-code anything private: keys, tokens, passwords, connection strings, signing secrets or webhook secrets. Not in code, tests, docs, comments, logs or fixtures. Read them from environment variables.
- Local values live in an untracked `.env`; production values live in the host's secret store. Commit only `.env.example`, with blank values, and add every new variable to it in the same change.
- If a secret is ever committed, rotate it at once; deleting it from the code is not enough.
- Add no CI, GitHub Actions, Docker or other DevOps files. The owner deploys the frontend to Vercel and the backend to Render.

## Talk to us

Built so far: the form saves a `Lead` through `POST /api/leads` (website) or `POST /api/mobile/leads` (app), both public on purpose, with the honeypot, the restricted list and 5 forms an hour per IP address. `submittedBy` is `customer` only when the session or token proves it, never from the form. Admins read, search by name or email, and delete leads at `/api/admin/leads`. Booking, CRM, Turnstile and the emails below are still to come.

1. Re-check every field on the server, plus Turnstile, a honeypot, the restricted list and a limit of 5 submissions per hour per IP address.
2. If "Registered in" is restricted, create no lead and log only the country and time.
3. Book the slot through the scheduling API. If it was taken, return the next free slots so the form keeps every answer.
4. Create the CRM lead with every answer and UTM data; the booked manager owns it. Refuse disposable email; allow free email but flag the lead. Store phones as E.164.
5. Send the emails. Flag the lead "Desk" and tell desk@ when "Deals over $25,000" is picked or volume is $1 million or more.

## Open an account

- Invitation only: a single-use link, `/open-account?invite=[token]`, valid 7 days, tied to the lead's email. Expired or used links are refused.
- "Save and finish later" sends a one-time link valid 30 minutes. Sessions end after 60 minutes without activity. No passwords until the app.
- Step 1 Continue creates or updates the Sumsub company applicant. Step 5 can't be sent until every person is Verified.
- Company bank accounts from step 4 are the only accounts money may come from; the holder must be the company.
- Staff Approve works only after Sumsub GREEN. RED with RETRY sends "We need one more thing"; RED with FINAL sends a neutral email with no reason.
- Remind after 2 and 5 days. Log every application event with time and actor.
- Staff endpoints: company Google or Microsoft sign-in with two-step, an allowed list of staff, every action logged, and an "Open in Sumsub" link instead of documents.

## Sumsub and webhooks

- Sandbox for development; production keys only in the secret store. Two levels, named in config: company and person.
- The server requests short-lived tokens (`POST /resources/accessTokens/sdk`) and gives the browser only that token. Refresh through our server on expiry.
- A person already verified is linked with "add existing applicant as beneficiary", not checked again. Match on email, then confirm name and date of birth in Sumsub.
- Owners get Sumsub verification links in our own branded email. The QR hand-off uses the WebSDK move-to-phone feature or a verification link.
- One endpoint, for example `/api/sumsub/webhook`. Compute the HMAC of the raw body with the webhook secret using the `X-Payload-Digest-Alg` algorithm (choose SHA-256), compare with `x-payload-digest`, and reject on mismatch.
- Sumsub resends failed deliveries up to five times, so handlers must be idempotent. Statuses must reach step 2 within 10 seconds.
- Main events: `applicantCreated`, `applicantPending`, `applicantOnHold`, `applicantReviewed`, `applicantActionPending`, `companyStructureChanged`.

## Data

May store:
- Lead: Talk to us answers, UTM data, time zone, booking ID, CRM ID, flags, created at. The CRM is the main copy.
- Invitation: hashed token, email, lead, manager, expires at, used at.
- Application: step 1 fields, step 3 answers, the company's own bank accounts, status, Sumsub company ID, timestamps.
- Person: name, email, role, share, Sumsub applicant ID, status, link sent at.
- Event (append-only): application, actor, action, before and after, time, IP address.
- Restricted attempt: country and time only. From Sumsub: applicant IDs, level names, statuses, review answers, timestamps.

May not store: ID images, company documents, ID numbers, or personal data in logs or analytics. Delete leads that never become customers after [24] months. Keep applications and events as the compliance policy says, at least five years under US rules; counsel sets the period.

## Security

- HTTPS only, HSTS with preload, TLS 1.2 or later.
- CSP allows only our origin, Sumsub, Turnstile, the scheduling tool and analytics. `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Permissions-Policy allows the camera only on `/open-account`.
- Server-side checks, Turnstile, honeypot, rate limits, CSRF protection and request size limits on forms and API.
- Sumsub, CRM, email and scheduling keys live only on the server, in the host's secret store. Rotate yearly and whenever staff leave.
- Load all config through one module that validates the variables at startup. If a required value is missing or empty, the server refuses to start; there are no fallback or default secrets. Never log or return config values.
- Tokens are random, single-use, hashed and short-lived. Session cookies are Secure, HttpOnly, SameSite=Lax. Encrypt lead and application data at rest.
- Daily backups with a tested restore. Error tracking and uptime alerts. `/.well-known/security.txt` points to security@moneystrait.com. Penetration test before phase 1b (SHOULD).

## Compliance

- No sign-up for individuals; both forms require a company. Money from anyone but the company is sent back. One restricted list serves the Countries page, both forms and later the app; changes need no deploy.
- Keep leads, invitations, application events and staff actions with timestamps, plus CMS history of licences, the restricted list and legal pages.
- Emails follow every hard rule above, are sent from hello@moneystrait.com with SPF, DKIM and DMARC, and take their copy from the CMS. These are product requirements, not legal advice; compliance and counsel own the policies.
