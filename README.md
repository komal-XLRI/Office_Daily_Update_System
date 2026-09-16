# Office Daily Update & Milestone Management System

An internal web application for recording office-wise daily updates, milestones and visitors (with photos
and documents), generating daily, weekly, monthly and custom reports, and managing offices and users. Staff
sign in with a one-time password (OTP) sent by email.

The complete specification is the source of truth:
[docs/Office_Daily_Update_Milestone_System_COMPLETE_README.md](docs/Office_Daily_Update_Milestone_System_COMPLETE_README.md)
(referred to below as "the spec", sections as §N).

## Core rules

- **Four business collections only:** `offices`, `users`, `visitors`, `dailyMilestones`. Daily updates and
  milestones live inside `dailyMilestones` (one record per office per date). Photos and documents are
  `{ fileName, fileUrl }` arrays on those records. Reports are generated on demand and never stored.
- **Two roles only:** `admin` (all offices) and `user` (their assigned office only).
- **OTP-only authentication:** no passwords anywhere.
- **Authorization is enforced on the server** for every page, API, report and upload.

## Tech stack

| Area           | Technology                                                               |
| -------------- | ------------------------------------------------------------------------ |
| Framework      | Next.js 16 (App Router, Turbopack, `src/proxy.ts`), React 19, TypeScript |
| Data           | MongoDB, Mongoose 9                                                      |
| UI             | Tailwind CSS v4, shadcn/ui, React Hook Form, Sonner toasts               |
| Validation     | Zod 4 (the same schemas are used by forms and the server)                |
| Sessions       | Signed HS256 JWT in an httpOnly cookie (`jose`)                          |
| Email          | Nodemailer over SMTP                                                     |
| Files          | Cloudinary                                                               |
| Report exports | `@react-pdf/renderer` (PDF), ExcelJS (Excel), CSV                        |
| Tests          | Vitest, mongodb-memory-server                                            |

## Prerequisites

- Node.js **20.9 or later** and npm
- A MongoDB database (MongoDB Atlas or an approved deployment)
- An SMTP account for sending OTP emails
- A Cloudinary account for photo and document storage

## Setup

```bash
npm install
cp .env.example .env.local        # then fill in the values below
npm run seed                      # offices + initial admin (safe to re-run)
npm run dev                       # http://localhost:3000
```

Generate `AUTH_SECRET` (at least 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Environment variables

| Variable                                                               | Required    | Description                                                                   |
| ---------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `MONGODB_URI`                                                          | Yes         | MongoDB connection string                                                     |
| `AUTH_SECRET`                                                          | Yes         | Session signing secret, 32+ random characters. Rotating it signs everyone out |
| `SMTP_HOST`                                                            | Yes\*       | SMTP server for OTP emails                                                    |
| `SMTP_PORT`                                                            | No          | `587` (STARTTLS, default) or `465` (implicit TLS)                             |
| `SMTP_USER`, `SMTP_PASSWORD`                                           | Yes\*       | SMTP credentials                                                              |
| `OTP_EMAIL_FROM`                                                       | Yes\*       | Sender address for OTP emails                                                 |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | For uploads | Cloudinary credentials (server-side only)                                     |
| `MAX_FILE_SIZE_MB`                                                     | No          | Maximum size of each uploaded file (default `10`)                             |
| `NEXT_PUBLIC_APP_TIMEZONE`                                             | No          | Institutional timezone (default `Asia/Kolkata`). Inlined at build time        |
| `SEED_ADMIN_EMAIL`                                                     | For seed    | Email of the initial administrator                                            |
| `SEED_ADMIN_NAME`                                                      | No          | Name of the initial administrator (default `System Administrator`)            |

\* Required in production. See [Signing in](#signing-in-otp) for local development without SMTP.

Never commit `.env.local`. In production, set these variables in the hosting provider.

## npm scripts

| Script               | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `npm run dev`        | Development server                                  |
| `npm run build`      | Production build                                    |
| `npm start`          | Serve the production build                          |
| `npm run lint`       | ESLint                                              |
| `npm run typecheck`  | TypeScript (`tsc --noEmit`)                         |
| `npm test`           | Vitest suite (unit + in-memory MongoDB integration) |
| `npm run test:watch` | Vitest in watch mode                                |
| `npm run seed`       | Idempotent database seed                            |
| `npm run format`     | Prettier (`format:check` to verify only)            |

## Seeding

`npm run seed` (`scripts/seed.ts`) reads `.env.local`, then `.env`, and:

1. Creates the four collections and all schema indexes.
2. Creates the seven offices, in this order: Director Office (`DIRECTOR`), Dean Admin (`DEAN-ADMIN`),
   Dean Academics (`DEAN-ACA`), ADSA Office (`ADSA`), HR (`HR`), Other (`OTHER`), XLEAD Office (`XLEAD`).
3. Creates the initial administrator from `SEED_ADMIN_EMAIL`: role `admin`, no office, active.
4. Optionally creates staff accounts from `scripts/seed-data/staff.json`.

The seed is **idempotent**. It only inserts records that don't exist yet (matched by office code or user
email), and it never changes existing records. Renamed or deactivated offices stay as they are. Existing users
are never promoted, demoted or reactivated; the script prints a warning when, for example, `SEED_ADMIN_EMAIL`
already belongs to a normal user. On invalid configuration or a database error, it exits with a non-zero code.

**Staff accounts (optional).** Copy `scripts/seed-data/staff.example.json` to
`scripts/seed-data/staff.json` (gitignored). The example lists the people from spec §4. Replace the
`@example.invalid` placeholders with real registered emails. Set `"isActive": true` only for people who
should be able to sign in. `isActive` defaults to `false`. Staff are always created with role `user` in the
office given by `officeCode`, and the file must not contain passwords or roles. After seeding, manage people
in the app under **Users**. Accounts are database-driven, never hard-coded.

## Signing in (OTP)

1. Enter a registered email and choose **Send OTP**. Unknown and inactive accounts cannot sign in.
2. Enter the 6-digit code and choose **Verify OTP**.

OTP policy (spec §10):

- Codes expire after 5 minutes and work only once.
- A code allows at most 5 verification attempts.
- A new code can be requested after a 60-second cooldown, with per-email send rate limiting.
- The server stores only an HMAC of the code, in a hidden field on the user document.
- Codes are never returned by any API and never logged in production.

After verification, the server sets a signed, httpOnly, SameSite=Lax session cookie (Secure in production)
that lasts 8 hours. Every request reloads the user from MongoDB. Deactivating a user, or the office of a
normal user, takes effect immediately.

**Local development without SMTP:** if SMTP is not configured and `NODE_ENV` is `development`, the OTP is
written to the server console instead of being emailed. This fallback is never available in production.

## Roles and office access

| Capability                                   | admin              | user            |
| -------------------------------------------- | ------------------ | --------------- |
| Daily updates, milestones, visitors, uploads | All offices        | Own office only |
| Search and filters                           | All offices        | Own office only |
| Reports                                      | One or all offices | Own office only |
| Office and user management                   | Yes                | No              |
| Change own role or office                    | n/a                | No              |

All of these rules run on the server (spec §6, §38, §39):

- For normal users, the office always comes from the signed-in user's database record. An `officeId` in a
  query string, request body or URL is never trusted. Requesting another office returns **403 Forbidden**.
- Before a record is viewed, updated or deleted by id, its office is checked against the user's office.
- Admin-only pages and APIs reject normal users.
- Offices and users are deactivated rather than deleted, so historical records stay intact.

## Business dates and timezone

- A business date is a calendar day in `NEXT_PUBLIC_APP_TIMEZONE` (default Asia/Kolkata), written
  `YYYY-MM-DD`. It is stored as **UTC midnight** of that day, so a record never moves to the previous or
  next day because of server or browser timezones.
- Real instants (visitor arrival and departure, `createdAt`, `updatedAt`) are stored in UTC and displayed in
  the institutional timezone. "Today" is always computed in that timezone.
- Weeks run Monday to Sunday.
- All conversions live in `src/lib/utils/dates.ts`. The test suite runs with a US server timezone so that any
  accidental use of local time fails.

## Uploads

- **Photos:** JPG, JPEG, PNG, WEBP. **Documents:** PDF, DOC, DOCX, XLS, XLSX.
- The server checks each file's extension, MIME type and size (`MAX_FILE_SIZE_MB`) and the user's office
  access before uploading. Browser checks alone are never trusted.
- One request can upload multiple files (up to 10). A record's `photos` or `documents` field holds at most
  20 files.
- Files are stored in Cloudinary under the `office-daily-updates` folder. MongoDB stores only `fileName` and
  `fileUrl`, and records may only reference this application's Cloudinary files.
- Files removed from a record, or belonging to a deleted record, are deleted from Cloudinary on a best-effort
  basis.
- The Cloudinary API secret never reaches the browser.

## Reports

Report types: **Daily** (one date), **Weekly** (the Monday–Sunday week containing the selected date),
**Monthly** (a month) and **Custom** (From/To, inclusive, up to 366 days).

Each report has:

- A header with the system name, office (or "All Offices"), report type, date range and generation time.
- Daily updates, milestones, visitors (name, purpose, date, arrival, departure, importance, remarks), and
  attachment names with links.

Outputs: on-screen HTML, a print-friendly view, PDF, CSV and Excel (`.xlsx`). Admins can report on one office
or all offices; normal users are always limited to their own office. Reports are built from the live data
each time and never stored.

## Project structure

```text
src/
  app/
    (auth)/login/             OTP sign-in
    (dashboard)/              dashboard, daily-updates, visitors, reports, offices, users, profile
    api/                      auth, offices, users, visitors, daily-milestones, reports, uploads
  components/
    ui/                       shadcn/ui primitives
    layout/                   app shell and navigation
    shared/                   page header, empty states, badges, pagination, uploader, dialogs
    <module>/                 module-specific components
  lib/
    api/                      route handler wrapper ({ data } / { error }) and client fetch helper
    auth/                     OTP, session cookie and token
    cloudinary/               upload, URL validation and deletion helpers
    db/connect.ts             cached mongoose connection
    permissions/              getCurrentUser, requireAuth/requireAdmin, office-scope helpers
    reports/                  report generation and exports
    services/                 all data access + authorization, one file per module
    utils/                    dates, pagination, search params, strings, safe redirects
    validation/               Zod schemas shared by forms and the server
  models/                     Office, User, Visitor, DailyMilestone (the only four models)
  types/                      DTOs and shared types
  proxy.ts                    optimistic redirect to /login for pages without a session
scripts/
  seed.ts                     npm run seed
  seed-data/                  seed operations, staff.example.json (staff.json is gitignored)
tests/
  unit/                       pure helpers: dates, office scope, validation, redirects, Cloudinary URLs
  integration/                models and seed against an in-memory MongoDB
  setup/db.ts                 in-memory database lifecycle and factories
docs/                         full specification
```

Conventions for contributors are in [CLAUDE.md](CLAUDE.md). Pages and API routes call services in
`src/lib/services` and never query models directly. API responses use `{ data }` on success and
`{ error: { code, message, fieldErrors? } }` on failure, with no stack traces.

## Testing

```bash
npm test
```

- Test files are under `tests/**/*.test.ts` and run in separate processes.
- Database suites call `registerTestDatabase()` from `tests/setup/db.ts`. It starts a private in-memory
  MongoDB for the file, connects through the app's own `connectDB()`, builds indexes and clears data between
  tests.
- The same file provides factories (`createOffice`, `createUser`, `createDailyMilestone`, `createVisitor`,
  `makeCurrentUser`) and `createAuthorizationFixture()` (Admin, User A in Office A, User B in Office B;
  spec §56).
- The first run downloads a MongoDB binary for mongodb-memory-server. Offline or CI machines can pre-cache it
  or point `MONGOMS_SYSTEM_BINARY` at an installed `mongod`.

## Security notes

- Every server input is validated with Zod, and ObjectIds are validated before querying.
- Keyword search escapes user input before building a regular expression.
- Unsafe API methods reject cross-origin requests. The session cookie is also SameSite=Lax.
- Errors shown to users are generic and never include stack traces. Server logs never contain request bodies,
  secrets or OTPs.
- Security headers are set: `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions
  policy.
- Post-login redirects accept only same-origin relative paths.
- Secrets (`AUTH_SECRET`, SMTP password, Cloudinary secret) are read only on the server.

## Deployment

Recommended architecture: Next.js on Vercel or approved hosting, MongoDB Atlas, Cloudinary and an SMTP
provider (spec §61).

1. Configure every environment variable in the hosting provider, with `NODE_ENV=production` and HTTPS.
2. Allow the host to reach the database (MongoDB Atlas network access).
3. Run `npm run seed` once from a trusted machine using the production `MONGODB_URI` and `SEED_ADMIN_EMAIL`.
4. Run `npm run build`, then `npm start` (or deploy through the provider).

### Production checklist (spec §62)

- [ ] MongoDB production database configured
- [ ] Auth secret configured (32+ random characters, unique to production)
- [ ] SMTP configured (OTP emails are delivered; no console fallback)
- [ ] Cloudinary configured
- [ ] File size configured (`MAX_FILE_SIZE_MB`)
- [ ] Seed reviewed
- [ ] Admin account reviewed
- [ ] No test users accidentally active (review `staff.json` and the Users page)
- [ ] No secrets committed (`.env.local` and `staff.json` are gitignored)
- [ ] OTP not logged
- [ ] Authorization tested (admin, own office, other office returns 403)
- [ ] Mobile UI tested
- [ ] Reports tested
- [ ] PDF tested
- [ ] Error handling tested
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
