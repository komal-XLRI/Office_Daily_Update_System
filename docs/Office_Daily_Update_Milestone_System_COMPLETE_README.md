# Office Daily Update & Milestone Management System

## Complete Development Specification & Setup Guide

This README is the **source of truth** for building the Office Daily Update & Milestone Management System with Next.js and MongoDB.

---

## 1. Project Objective

Build an internal web application to record and manage:

- Office-wise daily updates
- Daily milestones
- Visitors
- Visitor photos/documents
- Daily activity photos/documents
- Date-wise reports
- Office-wise reports
- User and office management
- OTP-based login

The application must be simple, professional, secure, responsive, and easy for office staff to use.

---

# 2. Technology Stack

Use the latest stable versions available when development starts.

- Next.js
- TypeScript
- App Router
- MongoDB
- Mongoose
- Tailwind CSS
- shadcn/ui
- Zod
- React Hook Form
- Email OTP authentication
- Cloudinary for file storage
- ESLint
- Prettier if required

Use Server Components by default. Use Client Components only where interactivity requires them.

---

# 3. Mandatory Business Rules

There are exactly **two application roles**:

```text
admin
user
```

Do not create additional business roles.

There are exactly **four business collections**:

```text
offices
users
visitors
dailyMilestones
```

Do not create separate business collections for:

```text
reports
photos
documents
dailyUpdates
milestones
permissions
roles
```

Reports must be generated dynamically.

Photos/documents are stored as metadata arrays inside the relevant documents.

Daily updates and milestones are stored inside `dailyMilestones`.

Authentication is **OTP only**. There is no password login and no `passwordHash`.

---

# 4. Office Structure

Initial offices:

1. Director Office
   - Director
   - Ayushi — Assistant

2. Dean Admin
   - Alwyn
   - Dayal
   - Divya
   - Ashwani

3. Dean Academics
   - Munish
   - Rahul
   - Ambika
   - Abhijeet

4. ADSA Office
   - Shubham
   - Akanksha
   - Jyoti

5. HR

6. Other

7. XLEAD Office

People must be database-driven, not hard-coded in the UI.

---

# 5. Role and Access Control

## Admin

`role = "admin"`

Admin can:

- View all offices
- View all users
- Add/edit users
- Activate/deactivate users
- Add/edit offices
- Activate/deactivate offices
- View all daily updates
- Add/edit/delete daily records
- View all milestones
- Manage milestones
- View all visitors
- Add/edit/delete visitors
- Upload files
- Generate reports for one office
- Generate reports for all offices
- Search/filter all data
- View dashboard statistics

Admin may have:

```text
officeId = null
```

---

## Normal User

`role = "user"`

Normal user is assigned one office through `officeId`.

A normal user can:

- View own office records
- Add daily updates for own office
- Add/edit milestones for own office
- Add visitors for own office
- Upload files for own office
- Search own office records
- Generate reports for own office

A normal user cannot:

- View another office
- Add records to another office
- Change their office
- Change their role
- Access admin management
- Generate all-office reports

---

# 6. Critical Authorization Rule

Frontend restrictions are not sufficient.

Every protected server action/API must enforce authorization.

Conceptual logic:

```ts
if (user.role === "admin") {
  // all offices
} else {
  // only user's assigned office
  filter.officeId = user.officeId;
}
```

For normal users, never trust a client-supplied `officeId`.

Use the authenticated user's office:

```ts
const officeId =
  session.user.role === "admin"
    ? body.officeId
    : session.user.officeId;
```

This rule must apply to:

- GET
- POST
- PUT/PATCH
- DELETE
- Reports
- Uploads
- Search/filter endpoints

---

# 7. Database Design

## 7.1 offices

```ts
{
  _id: ObjectId,
  name: string,
  code: string,
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

Requirements:

- `name` required
- `code` required
- `code` unique
- `isActive` defaults to true
- timestamps enabled

Suggested office codes:

```text
DIRECTOR
DEAN-ADMIN
DEAN-ACA
ADSA
HR
OTHER
XLEAD
```

---

## 7.2 users

No password fields.

```ts
{
  _id: ObjectId,
  name: string,
  email: string,
  role: "admin" | "user",
  designation: string,
  officeId: ObjectId | null,
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

Requirements:

- Email unique
- Email normalized to lowercase
- Role only `admin | user`
- Normal users should have an office
- Admin can have `officeId: null`
- Inactive users cannot log in

---

## 7.3 visitors

```ts
{
  _id: ObjectId,
  officeId: ObjectId,
  name: string,
  purpose: string,
  date: Date,
  timeArrived: Date,
  timeDeparted: Date,
  importance: "HIGH" | "MEDIUM" | "LOW",

  photos: [
    {
      fileName: string,
      fileUrl: string
    }
  ],

  documents: [
    {
      fileName: string,
      fileUrl: string
    }
  ],

  remarks: string,
  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

Visitor form:

- Visitor Name
- Purpose
- Date
- Time Arrived
- Time Departed
- Importance
- Photos
- Documents
- Remarks

---

## 7.4 dailyMilestones

This is the main daily reporting collection.

```ts
{
  _id: ObjectId,
  officeId: ObjectId,
  date: Date,

  dailyUpdate: {
    title: string,
    description: string
  },

  milestones: [
    {
      title: string,
      description: string,
      remarks: string
    }
  ],

  photos: [
    {
      fileName: string,
      fileUrl: string
    }
  ],

  documents: [
    {
      fileName: string,
      fileUrl: string
    }
  ],

  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

Recommended rule:

> One `dailyMilestones` document per office per date.

Create a compound unique index:

```ts
{ officeId: 1, date: 1 }
```

This prevents duplicate daily records.

---

# 8. File Storage

Do not store binary files in MongoDB.

Use Cloudinary.

MongoDB stores only:

```text
fileName
fileUrl
```

Example:

```ts
{
  fileName: "meeting-photo.jpg",
  fileUrl: "https://res.cloudinary.com/..."
}
```

Cloudinary credentials:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Never expose the Cloudinary API secret to the browser.

---

# 9. Upload Requirements

Support at minimum:

### Images

- JPG
- JPEG
- PNG
- WEBP

### Documents

- PDF
- DOC
- DOCX
- XLS
- XLSX

Use a configurable file-size limit:

```env
MAX_FILE_SIZE_MB=10
```

Validate:

- MIME type
- File size
- Extension
- Upload authorization

Do not blindly trust file extensions.

Support multiple files.

---

# 10. OTP Authentication

There is no password login.

Login flow:

```text
Enter registered email
        ↓
Check user
        ↓
Check isActive
        ↓
Generate 6-digit OTP
        ↓
Send OTP by email
        ↓
Enter OTP
        ↓
Verify OTP
        ↓
Create secure session
        ↓
Dashboard
```

OTP requirements:

- 6 digits
- Random
- 5-minute expiry
- Single-use
- Maximum 5 verification attempts
- 60-second resend cooldown
- Rate limit OTP requests
- Never return OTP from an API
- Never log OTP in production

If persistence is required by the chosen authentication implementation, OTP secrets should be protected appropriately.

---

# 11. Email Environment Variables

Create `.env.local`:

```env
MONGODB_URI=""

AUTH_SECRET=""

SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASSWORD=""
OTP_EMAIL_FROM=""

CLOUDINARY_CLOUD_NAME=""
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""

MAX_FILE_SIZE_MB="10"
```

Create `.env.example` with the same keys but no real values.

Never commit `.env.local`.

---

# 12. Session

After successful OTP verification, authenticated session information should contain at least:

```ts
{
  userId,
  name,
  email,
  role,
  officeId
}
```

Authorization must always be checked server-side.

---

# 13. Login UI

Two-step UI.

### Step 1

```text
Email
[ Send OTP ]
```

### Step 2

```text
Enter OTP
[ Verify OTP ]

Resend OTP
Change Email
```

Show resend countdown.

Inactive users must be blocked.

---

# 14. Dashboard

## Admin Dashboard

Show:

- Total offices
- Active users
- Today's daily updates
- Today's visitors
- Recent milestones
- Office-wise activity
- Quick report action

Admin can select:

```text
All Offices
Director Office
Dean Admin
Dean Academics
ADSA Office
HR
Other
XLEAD Office
```

---

## User Dashboard

Show only the user's office:

- Office name
- Today's update
- Today's milestones
- Today's visitors
- Recent records
- Add visitor
- Add/update daily record
- Office report

Do not show all-office information.

---

# 15. Daily Update Module

Create pages for:

```text
/daily-updates
/daily-updates/new
/daily-updates/[id]
```

Daily update form:

```text
Date
Daily Update Title
Daily Update Description
Milestones
Photos
Documents
```

Milestones are dynamic.

UI:

```text
+ Add Milestone
```

Each milestone:

```text
Title
Description
Remarks
```

Multiple milestones can be added to one daily record.

---

# 16. Visitor Module

Pages:

```text
/visitors
/visitors/new
/visitors/[id]
```

Features:

- List
- Add
- View
- Edit
- Delete
- Search
- Date filter
- Importance filter
- Photos
- Documents

Recommended list columns:

```text
Visitor
Purpose
Date
Arrival
Departure
Importance
Office (admin only)
Actions
```

---

# 17. Reports

Do not create a reports collection.

Reports are dynamically generated.

Types:

- Daily
- Weekly
- Monthly
- Custom

---

## Daily Report

Selected date.

---

## Weekly Report

Selected date range/week.

---

## Monthly Report

Selected month.

---

## Custom Report

Fields:

```text
From Date
To Date
```

---

# 18. Report Permissions

## Admin

Can select:

```text
All Offices
or
One Office
```

## User

Office is automatically restricted to their assigned office.

Never trust:

```text
?officeId=anotherOffice
```

from a normal user.

---

# 19. Report Contents

Include:

### Header

```text
Office Daily Update & Milestone Management System
Office Name
Report Type
Date / Date Range
Generated Date
```

### Daily Updates

- Title
- Description

### Milestones

- Title
- Description
- Remarks

### Visitors

- Name
- Purpose
- Date
- Arrival
- Departure
- Importance
- Remarks

### Attachments

Include useful attachment information and links where appropriate.

---

# 20. Report Output

Provide:

- Print-friendly HTML
- PDF
- CSV/Excel if practical

PDF must be clean and professional for internal reporting.

---

# 21. Search and Filters

Daily updates:

- Date
- Office
- Keyword

Visitors:

- Date
- Office
- Name
- Importance
- Purpose

Milestones:

- Date
- Office
- Keyword

Normal users must never receive another office's records even if they manipulate filters or URLs.

---

# 22. Office Management

Admin only.

Features:

- List offices
- Add office
- Edit office
- Activate/deactivate office

Fields:

```text
Office Name
Office Code
Active Status
```

Prefer deactivation over deletion to protect historical data.

---

# 23. User Management

Admin only.

Features:

- List users
- Add user
- Edit user
- Assign office
- Assign role
- Designation
- Activate/deactivate
- Search/filter

Fields:

```text
Name
Email
Role
Designation
Office
Active Status
```

Normal users cannot change:

- Role
- Office

---

# 24. Profile

Display:

```text
Name
Email
Designation
Role
Office
```

Normal users cannot modify role/office.

---

# 25. Navigation

Admin:

```text
Dashboard
Daily Updates
Visitors
Reports
Offices
Users
Profile
Logout
```

User:

```text
Dashboard
Daily Updates
Visitors
Reports
Profile
Logout
```

---

# 26. UI Requirements

Design should be:

- Professional
- Clean
- Minimal
- Institutional
- Responsive
- Accessible
- Fast

Avoid:

- Excessive gradients
- Excessive animation
- Glassmorphism everywhere
- Flashy dashboards
- Unnecessary illustrations

Use:

- Clear cards
- Tables
- Forms
- Badges
- Dialogs
- Toasts
- Empty states
- Loading states

---

# 27. Accessibility

Use:

- Proper labels
- Keyboard navigation
- Visible focus states
- Good contrast
- Accessible dialogs
- Meaningful errors
- Alt text where appropriate

---

# 28. Validation

Use Zod on the server.

Validate:

- Email
- Dates
- Required fields
- ObjectIds
- Role
- Importance
- File type
- File size

Never depend only on browser validation.

---

# 29. Error Handling

Handle:

```text
Unauthorized
Forbidden
Not found
Invalid input
Invalid office
Invalid user
OTP expired
Invalid OTP
Too many attempts
File too large
Unsupported file
Upload failed
Database error
```

Do not expose stack traces to users.

---

# 30. Recommended Project Structure

```text
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   ├── daily-updates/
│   │   ├── visitors/
│   │   ├── reports/
│   │   ├── offices/
│   │   ├── users/
│   │   └── profile/
│   ├── api/
│   │   ├── auth/
│   │   ├── offices/
│   │   ├── users/
│   │   ├── visitors/
│   │   ├── daily-milestones/
│   │   ├── reports/
│   │   └── uploads/
│   ├── layout.tsx
│   └── page.tsx
│
├── components/
│   ├── ui/
│   ├── layout/
│   ├── dashboard/
│   ├── daily-updates/
│   ├── visitors/
│   ├── reports/
│   ├── offices/
│   └── users/
│
├── lib/
│   ├── db/
│   ├── auth/
│   ├── cloudinary/
│   ├── permissions/
│   ├── validation/
│   ├── reports/
│   └── utils/
│
├── models/
│   ├── Office.ts
│   ├── User.ts
│   ├── Visitor.ts
│   └── DailyMilestone.ts
│
├── types/
│
└── middleware.ts
```

A `permissions` utility folder is allowed. **Do not create a permissions database collection or permissions object.**

---

# 31. Setup

## Create project

```bash
npx create-next-app@latest office-daily-update-system
```

Recommended choices:

```text
TypeScript: Yes
ESLint: Yes
Tailwind: Yes
src directory: Yes
App Router: Yes
Import alias: Yes
```

Install core dependencies:

```bash
npm install mongoose zod react-hook-form @hookform/resolvers
```

Install/configure authentication, email, Cloudinary and UI libraries according to the selected implementation.

---

# 32. MongoDB Setup

Use MongoDB Atlas or an approved MongoDB deployment.

Set:

```env
MONGODB_URI="your-connection-string"
```

Create a reusable database connection utility.

Use connection caching appropriate for Next.js server environments.

Do not create a fresh unnecessary connection for every request.

---

# 33. Mongoose Models

Create exactly:

```text
Office
User
Visitor
DailyMilestone
```

Each model should include:

- TypeScript types
- Schema validation
- timestamps
- appropriate indexes
- Next.js hot-reload-safe model initialization

---

# 34. Required Indexes

### offices

```text
code: unique
```

### users

```text
email: unique
officeId
role
isActive
```

### visitors

```text
officeId + date
officeId + name
officeId + importance
```

### dailyMilestones

```text
officeId + date: unique
```

Add other indexes only when justified by actual query requirements.

---

# 35. Seed Data

Create a seed script.

Seed offices:

```text
Director Office
Dean Admin
Dean Academics
ADSA Office
HR
Other
XLEAD Office
```

Use unique office codes.

Seed one initial admin:

```text
role = admin
officeId = null
isActive = true
```

The admin authenticates through OTP.

Do not hard-code passwords.

Seed operations must be idempotent.

---

# 36. Date and Time

Store timestamps consistently, preferably UTC.

Display dates/times in the institutional timezone.

When generating daily reports, ensure records do not move to the previous/next date due to timezone conversion.

The business date and timestamp handling must be deliberate and tested.

---

# 37. API Rules

Recommended API groups:

```text
/api/auth/...
/api/offices
/api/users
/api/visitors
/api/daily-milestones
/api/reports
/api/uploads
```

Every protected endpoint must:

1. Authenticate user.
2. Load/verify current user.
3. Check role.
4. Determine office scope.
5. Validate input.
6. Perform database operation.
7. Return safe output.

---

# 38. Authorization Example

Request:

```text
GET /api/visitors?officeId=ABC
```

Admin:

```text
Allowed
```

User assigned to ABC:

```text
Allowed
```

User assigned to XYZ:

```text
Forbidden
```

Changing URL parameters must never bypass authorization.

---

# 39. Update/Delete Authorization

Before updating or deleting:

```text
Find record
      ↓
Admin?
  Yes → allowed
  No
      ↓
Compare record.officeId with session.user.officeId
      ↓
Match → allowed
Different → Forbidden
```

Apply this to visitors and daily records.

---

# 40. Loading and Empty States

Use loading states for data-heavy screens.

Examples:

```text
Loading updates...
Loading visitors...
Generating report...
Uploading files...
```

Empty states:

```text
No daily update has been recorded for this date.
```

```text
No visitors found.
```

```text
No milestones have been added yet.
```

---

# 41. Confirmation Dialogs

For destructive operations:

```text
Delete this visitor?

This action cannot be undone.

[Cancel] [Delete]
```

---

# 42. Audit Information

The business collections use:

```text
createdBy
createdAt
updatedAt
```

Do not create a separate audit collection unless explicitly approved.

---

# 43. Data Integrity

Do not physically delete offices/users unnecessarily.

Prefer:

```text
isActive = false
```

Historical records must remain intact.

Deactivating a user prevents login but should not destroy their historical records.

---

# 44. Performance

Use:

- Server-side data fetching where appropriate
- Pagination for large lists
- MongoDB indexes
- Selective database fields
- Optimized Cloudinary images
- Lazy loading where useful
- Minimal client-side JavaScript

Do not load large attachment files unnecessarily.

---

# 45. Security

Mandatory:

1. Never trust browser data.
2. Validate all server inputs.
3. Enforce office access server-side.
4. Keep secrets in environment variables.
5. Never expose Cloudinary secret.
6. Never return OTP.
7. Never log OTP.
8. Rate-limit OTP.
9. Validate uploaded files.
10. Use secure sessions/cookies.
11. Protect admin pages.
12. Prevent stack-trace leakage.
13. Validate MongoDB ObjectIds.
14. Protect against unauthorized record access.

---

# 46. Development Phases

Build in this order.

## Phase 1 — Foundation

- Next.js
- TypeScript
- Tailwind
- UI setup
- Layout
- Environment setup
- Folder structure

Run:

```bash
npm run lint
npx tsc --noEmit
```

---

## Phase 2 — MongoDB

- MongoDB connection
- Mongoose
- Four models
- Indexes
- Seed

---

## Phase 3 — OTP Authentication

- Login UI
- OTP email
- OTP verification
- Expiry
- Attempt limit
- Resend cooldown
- Session
- Logout
- Inactive-user handling

---

## Phase 4 — Authorization

Create reusable server-side authorization helpers.

Conceptual helpers:

```ts
requireAuth()
requireAdmin()
requireOfficeAccess(officeId)
getCurrentUser()
```

---

## Phase 5 — Dashboard

- Admin dashboard
- User dashboard
- Statistics
- Recent activities
- Quick actions

---

## Phase 6 — Daily Updates

- List
- Add
- Edit
- View
- Milestones
- Photos
- Documents
- One office/date record

---

## Phase 7 — Visitors

- List
- Add
- View
- Edit
- Delete
- Search
- Filters
- Attachments

---

## Phase 8 — Cloudinary

- Upload
- Multiple files
- Validation
- Preview
- Remove
- URL persistence

---

## Phase 9 — Reports

- Daily
- Weekly
- Monthly
- Custom
- Office filters
- PDF
- Print
- Optional Excel/CSV

---

## Phase 10 — User Management

Admin-only:

- List
- Add
- Edit
- Activate/deactivate
- Assign office
- Assign role

---

## Phase 11 — Office Management

Admin-only:

- List
- Add
- Edit
- Activate/deactivate

---

## Phase 12 — Security Review

Test:

- OTP
- Session
- Role access
- Office access
- Query manipulation
- Body officeId manipulation
- Unauthorized edit/delete
- Upload security
- Secret exposure

---

## Phase 13 — UI Polish

- Mobile layout
- Empty states
- Loading states
- Accessibility
- Tables
- Forms
- Report styling

---

# 47. Claude Code Instructions

Claude Code must first inspect the repository before changing anything.

Use this prompt:

```text
Read README.md completely.

Do not write code yet.

First inspect the existing repository and report:

1. Current project structure
2. Current Next.js version
3. Existing dependencies
4. Existing authentication
5. Existing MongoDB/Mongoose setup
6. Existing environment configuration
7. Existing UI/component setup
8. What is already implemented
9. What is missing according to README.md
10. Any conflicts between the repository and README.md

Then provide a phased implementation plan.

Do not implement anything until the plan is shown.
```

---

# 48. Claude Code Phase Prompt

```text
Proceed with Phase 1 only.

Follow README.md strictly.

Before changing anything:
- Inspect relevant existing files.
- Reuse working code where possible.
- Do not unnecessarily rewrite the project.
- Do not create extra business collections.
- Do not create extra application roles.
- Do not create a permissions object.

After implementation:

1. Run lint.
2. Run TypeScript typecheck.
3. Fix all errors.
4. Summarize files changed.
5. Explain what was implemented.
6. List anything pending.

Do not proceed to the next phase.
```

Repeat phase-by-phase.

---

# 49. Claude Code — Database Prompt

```text
Implement the MongoDB/Mongoose layer according to README.md.

Exactly four business collections:

1. offices
2. users
3. visitors
4. dailyMilestones

Do not create reports, photos, documents, milestones, dailyUpdates, permissions or roles collections.

Users must not contain passwordHash because authentication is OTP based.

dailyMilestones must support one office/date record with embedded milestones, photos and documents.

Add validation and appropriate indexes.

Run lint and typecheck.
```

---

# 50. Claude Code — OTP Prompt

```text
Implement OTP email authentication according to README.md.

Requirements:

- No password login.
- No passwordHash.
- Only registered active users can log in.
- Six-digit OTP.
- Five-minute expiry.
- Single-use OTP.
- Maximum verification attempts.
- Resend cooldown.
- Rate limiting.
- Never return OTP from API.
- Never log OTP.
- Secure authenticated session.
- Session must expose userId, role and officeId safely.

Inspect existing authentication before changing it.

Run lint and typecheck after implementation.
```

---

# 51. Claude Code — Authorization Prompt

```text
Implement authorization according to README.md.

Rules:

1. admin can access all offices.
2. user can access only session.user.officeId.
3. Normal users cannot override officeId through request payloads.
4. Normal users cannot change role.
5. Normal users cannot access admin pages.
6. Query parameters cannot bypass office restrictions.
7. Update/delete must verify office ownership.
8. Do not create a permissions object.
9. Do not create additional roles.

Implement reusable authorization helpers and test them.
```

---

# 52. Claude Code — Daily Updates Prompt

```text
Implement the Daily Updates module according to README.md.

Requirements:

- One dailyMilestones record per office/date.
- Daily update title and description.
- Multiple milestones.
- Each milestone has title, description and remarks.
- Multiple photos.
- Multiple documents.
- Cloudinary URLs stored in MongoDB.
- Server-side office authorization.
- Admin can access any office.
- Normal user can access only assigned office.

Implement create, read and update first.

Do not implement visitors or reports in this phase.
```

---

# 53. Claude Code — Visitors Prompt

```text
Implement Visitor Management according to README.md.

Fields:

- name
- purpose
- date
- timeArrived
- timeDeparted
- importance
- photos
- documents
- remarks
- officeId
- createdBy

Support:

- create
- list
- view
- edit
- delete
- search
- date filter
- importance filter

Admin can access all offices.

Normal users can access only their assigned office.

Enforce this on the server.
```

---

# 54. Claude Code — Reports Prompt

```text
Implement Reports according to README.md.

Report types:

- Daily
- Weekly
- Monthly
- Custom date range

Admin:
- Can select one office.
- Can select all offices.

Normal user:
- Only assigned office.
- Never trust officeId from browser.

Reports should combine:
- Daily updates
- Milestones
- Visitors
- Relevant attachment information

Provide print-friendly output and PDF generation.

Do not create a reports collection.
```

---

# 55. Claude Code — Security Review Prompt

```text
Perform a complete security and authorization review against README.md.

Check:

1. OTP expiry
2. OTP reuse
3. OTP brute force
4. OTP resend abuse
5. Inactive users
6. Session security
7. Admin authorization
8. Office authorization
9. Query parameter manipulation
10. Request body officeId manipulation
11. Role manipulation
12. Unauthorized edit/delete
13. File upload validation
14. File size validation
15. Secret exposure
16. Error leakage
17. MongoDB query safety

Run:

npm run lint
npx tsc --noEmit
npm run build

Fix issues found and provide a concise security review.
```

---

# 56. Testing

## Authentication

Test:

```text
Registered active email → OTP sent
Unregistered email → rejected
Inactive user → rejected
Correct OTP → login
Wrong OTP → rejected
Expired OTP → rejected
Used OTP → rejected
Too many attempts → rejected
Resend during cooldown → rejected
```

## Authorization

Create:

```text
Admin
User A → Office A
User B → Office B
```

Verify:

```text
Admin → all offices
User A → Office A only
User A → Office B → Forbidden
```

Also test manually changing:

```text
officeId
role
query parameters
URL IDs
```

---

# 57. Daily Record Testing

Create:

```text
Office A + 08 Sep 2026
```

Try duplicate creation for the same office/date.

Expected:

```text
Duplicate must be prevented.
```

Office B should independently have a record for the same date.

---

# 58. Visitor Testing

Test:

- Create visitor
- Edit visitor
- Delete visitor
- Search
- Date filter
- Importance filter
- Multiple photos
- Multiple documents
- Unauthorized office access

---

# 59. Report Testing

Test:

```text
Daily
Weekly
Monthly
Custom
```

And:

```text
Admin + All Offices
Admin + Single Office
User + Own Office
User + Other Office
```

Last case must be blocked.

---

# 60. Upload Testing

Test:

```text
JPG
PNG
WEBP
PDF
DOCX
XLSX
```

Also:

```text
Oversized file
Unsupported file
Wrong MIME type
Multiple files
Unauthorized upload
```

---

# 61. Production Architecture

Recommended:

```text
Next.js
   ↓
Vercel / approved hosting
   ↓
MongoDB Atlas
   ↓
Cloudinary
   ↓
SMTP / email provider
```

Production secrets must be configured through the hosting provider.

Never commit `.env.local`.

---

# 62. Production Checklist

```text
[ ] MongoDB production database configured
[ ] Auth secret configured
[ ] SMTP configured
[ ] Cloudinary configured
[ ] File size configured
[ ] Seed reviewed
[ ] Admin account reviewed
[ ] No test users accidentally active
[ ] No secrets committed
[ ] OTP not logged
[ ] Authorization tested
[ ] Mobile UI tested
[ ] Reports tested
[ ] PDF tested
[ ] Error handling tested
[ ] npm run lint passes
[ ] npx tsc --noEmit passes
[ ] npm run build passes
```

---

# 63. Final Data Model

```text
OFFICES
├── _id
├── name
├── code
├── isActive
├── createdAt
└── updatedAt

USERS
├── _id
├── name
├── email
├── role
├── designation
├── officeId
├── isActive
├── createdAt
└── updatedAt

VISITORS
├── _id
├── officeId
├── name
├── purpose
├── date
├── timeArrived
├── timeDeparted
├── importance
├── photos[]
├── documents[]
├── remarks
├── createdBy
├── createdAt
└── updatedAt

DAILY MILESTONES
├── _id
├── officeId
├── date
├── dailyUpdate
│   ├── title
│   └── description
├── milestones[]
│   ├── title
│   ├── description
│   └── remarks
├── photos[]
├── documents[]
├── createdBy
├── createdAt
└── updatedAt
```

---

# 64. Complete User Flow

```text
Application
    ↓
Login
    ↓
Registered Email
    ↓
OTP
    ↓
Verify OTP
    ↓
Secure Session
    ↓
Dashboard
    ↓
┌──────────────────┬──────────────────┬──────────────────┐
│ Daily Updates    │ Visitors         │ Reports          │
│                  │                  │                  │
│ Daily update     │ Visitor details  │ Daily            │
│ Milestones       │ Photos           │ Weekly           │
│ Photos           │ Documents        │ Monthly          │
│ Documents        │ Search           │ Custom           │
└──────────────────┴──────────────────┴──────────────────┘
```

---

# 65. Definition of Done

The system is complete when:

```text
[ ] Next.js application works
[ ] MongoDB works
[ ] Four required models work
[ ] Office management works
[ ] User management works
[ ] OTP login works
[ ] Inactive users are blocked
[ ] Admin access works
[ ] User office restriction works
[ ] Daily updates work
[ ] Multiple milestones work
[ ] Multiple photos work
[ ] Multiple documents work
[ ] Visitor management works
[ ] Cloudinary works
[ ] Daily reports work
[ ] Weekly reports work
[ ] Monthly reports work
[ ] Custom reports work
[ ] Admin all-office reports work
[ ] User own-office reports work
[ ] PDF/print works
[ ] Search/filter works
[ ] Responsive UI works
[ ] Server-side authorization works
[ ] Secrets are protected
[ ] OTP is never exposed/logged
[ ] Lint passes
[ ] Typecheck passes
[ ] Production build passes
```

---

# 66. Final Development Principle

Keep the application **simple and maintainable**.

The final business architecture must remain:

```text
4 Collections
    ↓
offices
users
visitors
dailyMilestones
```

The final roles:

```text
admin
user
```

The final authentication:

```text
Email OTP
```

The final access model:

```text
admin → all offices
user → own office only
```

Do not over-engineer the project. Build the required functionality first, then improve UI/performance/security after the core workflow is stable.
