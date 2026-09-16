@AGENTS.md

# Office Daily Update & Milestone Management System

Spec (source of truth): `docs/Office_Daily_Update_Milestone_System_COMPLETE_README.md` ("the spec", sections referenced as §N).
Stack: Next.js 16 App Router (Turbopack, `src/proxy.ts` instead of middleware), React 19, TypeScript strict, MongoDB + Mongoose 9,
Tailwind v4 + shadcn/ui (radix-nova, `src/components/ui`), Zod 4, React Hook Form, jose sessions, Nodemailer, Cloudinary.

## Non-negotiable rules
- Exactly FOUR business collections/models: `offices`, `users`, `visitors`, `dailyMilestones` (`src/models`). Never add models or
  collections for reports, photos, documents, dailyUpdates, milestones, permissions, roles, sessions or audit.
- Exactly TWO roles: `admin`, `user`. No permissions object, no extra roles.
- OTP-only email auth. No passwords/passwordHash. OTP state lives in the hidden `users.otp` sub-document (`select: false`, HMAC only).
  Never return an OTP from any API, never log it in production, never put `otp` in a DTO.
- Authorization is ALWAYS server-side. admin → all offices; user → only `user.officeId`. A normal user's client-supplied `officeId`
  (query, body, URL) is never used; a different office → 403 Forbidden. Update/delete/view by id must check record office (§39).
- Validate every server input with the Zod schemas in `src/lib/validation`. Validate ObjectIds before querying.
- Never expose stack traces or secrets (Cloudinary secret, AUTH_SECRET, SMTP password) to clients.

## Architecture & conventions
- `src/lib/permissions` — `getCurrentUser()` (fresh DB load, null if inactive/office inactive), `requireAuth()` / `requireAdmin()`
  (API: throw 401/403), `requirePageUser()` (pages: redirect to /login), and pure scope helpers `resolveReadOfficeScope(user, requestedOfficeId)`
  (returns office id or null = all offices, admin only), `resolveWriteOfficeId(user, requestedOfficeId)`, `assertRecordAccess(user, record)`,
  `requireOfficeAccess`, `canAccessOffice`, `isAdmin`.
- `src/lib/services/<module>.ts` — ALL data access + authorization lives here (`import "server-only"`). Every exported function takes
  `user: CurrentUser` first, calls `await connectDB()`, parses its input with the module's Zod schema, applies office scope, queries with
  `.lean()` + explicit `.select()`, and returns DTOs from `src/lib/serializers.ts` (types in `src/types`). Pages and API routes both call
  services — never query models directly from pages/routes. Throw `AppError` subclasses from `src/lib/errors.ts`.
  Use `requireActiveOffice(officeId)` (`src/lib/services/office-options.ts`) before creating records; `listOfficeOptions()` for selects.
- API routes (`src/app/api/**/route.ts`): wrap with `withApi` from `src/lib/api/handler.ts`; use `requireAuth`/`requireAdmin`, `parseQuery`,
  `parseJsonBody`, `getRouteId`, and return `jsonOk(data)` (`{ data }`; errors are `{ error: { code, message, fieldErrors?, details? } }`).
  Type context with the global `RouteContext<'/api/x/[id]'>`. Mutations use JSON bodies (POST create, PATCH update, DELETE).
- Pages: Server Components by default. Each page calls `requirePageUser()` itself (layouts don't re-run on navigation). Wrap service
  calls with `try { ... } catch (e) { return renderPageError(e); }` from `src/lib/page-errors.tsx` (404 → notFound, 403 → AccessDenied).
  `params`/`searchParams` are Promises; normalize with `normalizeSearchParams` (`src/lib/utils/search-params.ts`) and `safeParse` list
  queries (fall back to defaults on invalid filters). Admin-only pages render `<AccessDenied />` for non-admins.
- Client forms: React Hook Form + `zodResolver` with the shared schema; submit via `apiRequest` (`src/lib/api/client.ts`), map server
  errors with `applyFieldErrors`, show `toast` (sonner) on success/failure, then `router.push()` + `router.refresh()`. Use shadcn `Field`,
  `FieldLabel`, `FieldError`, `FieldDescription` (`src/components/ui/field.tsx`), proper `htmlFor`/`id`, `aria-invalid` on invalid inputs.
- Filters on list pages: native `<form method="get">` with inputs that have `name`s (Radix `Select` supports `name`), plus Apply/Reset.
- Shared UI in `src/components/shared`: `PageHeader`, `EmptyState`, `AccessDenied`, `ImportanceBadge`/`StatusBadge`/`RoleBadge`,
  `PaginationNav`, `OfficeSelect` (+ `ALL_OFFICES_VALUE = "all"`), `FileUploader` (photos/documents → `/api/uploads`),
  `PhotoGallery`/`DocumentList`, `DeleteRecordButton` (confirmation dialog). Reuse these; don't re-create them.
- Dates (`src/lib/utils/dates.ts`, spec §36): business dates are `"YYYY-MM-DD"` strings in APP_TIMEZONE (Asia/Kolkata) and are stored as
  UTC midnight. Use `businessDateToUtc`, `utcToBusinessDate`, `businessDateFilter`, `businessDateRangeFilter`, `todayBusinessDate`,
  `combineDateAndTime` (visitor times), `toTimeInputValue`, `formatBusinessDate`, `formatTime`, `formatDateTime`, `weekRange`, `monthRange`.
  Never use `new Date("YYYY-MM-DD")` with local getters or `toLocaleDateString` for business dates.
- Attachments: records store `{ fileName, fileUrl }[]`. Services must call `assertAllowedAttachments(photos, documents)` before saving and
  best-effort `deleteCloudinaryFiles(removedAttachmentUrls(old, new))` after updates / all files after deletes (`src/lib/cloudinary`).
- Keyword search: always `containsRegex(q)` / `escapeRegex` from `src/lib/utils/strings.ts` (never raw user regex).
- Pagination: `paginationWindow` / `toPaginated` (`src/lib/utils/pagination.ts`) and the `page`/`pageSize` query params.
- Styling: professional, minimal, institutional. shadcn Card/Table/Badge/Dialog/Field; no gradients, glassmorphism or flashy animation.
  Every list has empty + loading states (spec §40 wording); tables go inside `overflow-x-auto` containers for mobile.
- Accessibility: labels on every control, visible focus, `aria-label` on icon-only buttons, meaningful alt text.

## Commands
`npm run lint` · `npm run typecheck` · `npm run build` · `npm test` (Vitest + mongodb-memory-server) · `npm run seed`
