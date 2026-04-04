# Tenant Onboarding & Setup Wizard — Design Spec

## Overview

Two separate features that together cover the full tenant lifecycle from platform provisioning to first-use configuration:

1. **Platform Admin Onboarding Wizard** (`/platform/tenants/onboard`) — HFP operations team provisions a new tenant (database, auth, entitlements) via a 4-step wizard with real-time SSE provisioning progress.

2. **Tenant Setup Wizard** (`/setup`) — After provisioning, the tenant admin receives an activation email and on first login is redirected to a 6-step mandatory setup wizard to configure their organization before accessing the main dashboard.

---

## Architecture

### URL Structure

| Feature                   | URL                         | Auth Mechanism                  | User                |
| ------------------------- | --------------------------- | ------------------------------- | ------------------- |
| Platform Admin Onboarding | `/platform/tenants/onboard` | X-Platform-Key (session cookie) | HFP operations team |
| Tenant Setup Wizard       | `/setup`                    | JWT (Keycloak / dev auth)       | Tenant admin        |

### Next.js Route Groups

```
apps/web/app/
├── (platform)/                        # Platform admin layout (logo header, no sidebar)
│   └── platform/
│       └── tenants/
│           ├── page.tsx               # Tenant list (enhanced with status column)
│           └── onboard/
│               └── page.tsx           # 4-step onboarding wizard
├── (setup)/                           # Setup layout (minimal chrome, no sidebar)
│   └── setup/
│       └── page.tsx                   # 6-step setup wizard
├── (dashboard)/                       # Existing app (add setup-completion check)
│   └── ...existing routes
```

### Shared Components

- **`WizardLayout`** — Vertical stepper sidebar (left) + content area (right). Props: `steps[]`, `currentStep`, `completedSteps[]`, `onStepClick`. Used by both wizards.
- **`WizardStep`** — Content wrapper with title, description, Next/Back/Save buttons. Validates before navigation.
- **`ProvisioningProgress`** — SSE-powered progress display with step status indicators and retry. Platform admin wizard step 4 only.

### Layout Differences

- **(platform)** — Simple layout with HFP logo header, no sidebar. Platform key auth via session cookie.
- **(setup)** — Minimal layout with tenant name in header, no sidebar, no navigation. Just the wizard.
- **(dashboard)** — Existing layout. Adds setup completion check: if `is_completed === false`, redirect to `/setup?step={currentStep}`.

---

## Data Model

### Registry Database — New Tables

#### `tenant_entitlements`

| Column                  | Type         | Constraints             | Description                                                      |
| ----------------------- | ------------ | ----------------------- | ---------------------------------------------------------------- |
| id                      | UUID         | PK, default uuid        |                                                                  |
| tenant_id               | UUID         | FK → tenants.id, UNIQUE | One entitlement record per tenant                                |
| license_type            | ENUM         | NOT NULL                | TRIAL, STANDARD, ENTERPRISE                                      |
| max_properties          | INT          | NOT NULL, default 10    | Property count limit                                             |
| max_users               | INT          | NOT NULL, default 50    | User count limit                                                 |
| enabled_modules         | TEXT[]       | NOT NULL                | Module codes: GL, AP, AR, TRANSFER_DESK, REPORTING, FIXED_ASSETS |
| max_concurrent_sessions | INT          | NOT NULL, default 10    |                                                                  |
| subscription_start_date | DATE         | NOT NULL                |                                                                  |
| subscription_end_date   | DATE         | nullable                | null = no expiry                                                 |
| is_active               | BOOLEAN      | NOT NULL, default true  |                                                                  |
| created_by              | VARCHAR(255) |                         | Platform admin who created                                       |
| updated_by              | VARCHAR(255) |                         | Last modifier for audit trail                                    |
| created_at              | TIMESTAMP    | NOT NULL, default now() |                                                                  |
| updated_at              | TIMESTAMP    | NOT NULL, auto-update   |                                                                  |

#### `tenant_provisioning_steps`

| Column        | Type        | Constraints               | Description                                                                                          |
| ------------- | ----------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| id            | UUID        | PK, default uuid          |                                                                                                      |
| tenant_id     | UUID        | FK → tenants.id           |                                                                                                      |
| step_name     | VARCHAR(50) | NOT NULL                  | creating_database, running_migrations, applying_security, creating_auth, seeding_data, sending_email |
| step_order    | INT         | NOT NULL                  | 1-6                                                                                                  |
| status        | ENUM        | NOT NULL, default PENDING | PENDING, IN_PROGRESS, COMPLETED, FAILED                                                              |
| error_message | TEXT        | nullable                  | Error details on failure                                                                             |
| started_at    | TIMESTAMP   | nullable                  |                                                                                                      |
| completed_at  | TIMESTAMP   | nullable                  |                                                                                                      |
| created_at    | TIMESTAMP   | NOT NULL, default now()   |                                                                                                      |
| updated_at    | TIMESTAMP   | NOT NULL, auto-update     |                                                                                                      |

### Tenant Database — New Table

#### `tenant_setup_progress`

| Column          | Type      | Constraints             | Description                               |
| --------------- | --------- | ----------------------- | ----------------------------------------- |
| id              | UUID      | PK, default uuid        |                                           |
| tenant_id       | UUID      | NOT NULL                | Tenant identifier (from JWT)              |
| current_step    | INT       | NOT NULL, default 1     | Step the admin is currently on (1-6)      |
| is_completed    | BOOLEAN   | NOT NULL, default false | Setup finished                            |
| step_data       | JSONB     | NOT NULL, default {}    | Form state per step, keyed by step number |
| completed_steps | INT[]     | NOT NULL, default {}    | Steps fully validated (e.g., [1,2,3])     |
| completed_at    | TIMESTAMP | nullable                | When setup was marked complete            |
| created_at      | TIMESTAMP | NOT NULL, default now() |                                           |
| updated_at      | TIMESTAMP | NOT NULL, auto-update   |                                           |

**`step_data` structure example:**

```json
{
  "1": {
    "corporate": {
      "name": "Jumeirah Group",
      "code": "JUM",
      "countryCode": "AE",
      "functionalCurrency": "AED",
      "reportingCurrency": "USD",
      "timezone": "Asia/Dubai"
    },
    "properties": [
      {
        "name": "Jumeirah Beach Hotel",
        "code": "JBH",
        "countryCode": "AE",
        "currency": "AED",
        "timezone": "Asia/Dubai"
      },
      {
        "name": "Jumeirah Al Naseem",
        "code": "JAN",
        "countryCode": "AE",
        "currency": "AED",
        "timezone": "Asia/Dubai"
      }
    ]
  },
  "2": {
    "departments": ["ROOMS", "F_AND_B", "SPA", "ADMIN_GENERAL", "SALES_MARKETING", "PROPERTY_OPS"]
  },
  "3": { "importMethod": "usali_template", "accountCount": 142 },
  "4": { "fiscalYearStartMonth": 1, "years": [2026, 2027] },
  "5": { "additionalCurrencies": ["USD", "EUR"], "autoImportEcb": true },
  "6": {
    "invitations": [
      {
        "email": "controller@jumeirah.com",
        "name": "Sarah K",
        "role": "CONTROLLER",
        "entityIds": ["uuid1"]
      }
    ]
  }
}
```

### Changes to Existing Tenant Model

- Deprecate `plan` field (keep column, stop writing new values)
- Add `provisioning_status` field: `PENDING | PROVISIONING | ACTIVE | FAILED` (default `PENDING`)

---

## Platform Admin Onboarding Wizard

### Steps

#### Step 1: Tenant Details

| Field        | Type   | Validation                                                                       | Notes                                |
| ------------ | ------ | -------------------------------------------------------------------------------- | ------------------------------------ |
| Company Name | text   | required, 1-200 chars                                                            |                                      |
| Slug         | text   | required, 3-50 chars, lowercase alphanumeric + hyphens, auto-generated from name | Editable, uniqueness checked via API |
| Domain       | text   | optional, valid domain format                                                    | e.g., finance.jumeirah.com           |
| Admin Email  | email  | required, valid email                                                            | Pre-fills step 3                     |
| Country      | select | required                                                                         | Country code picker                  |

#### Step 2: Entitlements

| Field                   | Type          | Validation      | Notes                                              |
| ----------------------- | ------------- | --------------- | -------------------------------------------------- |
| License Type            | select        | required        | TRIAL, STANDARD, ENTERPRISE                        |
| Max Properties          | number        | required, min 1 |                                                    |
| Max Users               | number        | required, min 1 |                                                    |
| Enabled Modules         | checkbox grid | min 1 selected  | GL, AP, AR, TRANSFER_DESK, REPORTING, FIXED_ASSETS |
| Max Concurrent Sessions | number        | required, min 1 |                                                    |
| Subscription Start      | date          | required        | defaults to today                                  |
| Subscription End        | date          | optional        | null = no expiry                                   |

#### Step 3: Admin Account

| Field              | Type     | Validation                       | Notes                |
| ------------------ | -------- | -------------------------------- | -------------------- |
| First Name         | text     | required                         |                      |
| Last Name          | text     | required                         |                      |
| Email              | email    | required, pre-filled from step 1 |                      |
| Temporary Password | password | required, min 12 chars           | Shown in review step |
| Phone              | text     | optional                         |                      |

#### Step 4: Review & Provision

- Read-only summary of all data from steps 1-3
- "Edit" links per section to jump back to that step
- "Provision Tenant" button triggers `POST /api/v1/platform/tenants/provision`
- Transitions to provisioning progress view (SSE)

### Provisioning Progress (SSE)

**6 provisioning steps displayed:**

1. Creating database
2. Running migrations
3. Applying security policies (RLS + indexes)
4. Creating auth realm (Keycloak)
5. Seeding initial data
6. Sending activation email

**Step status transitions:** `PENDING → IN_PROGRESS → COMPLETED` or `FAILED`

**SSE event format:**

```
event: step
data: {"step":"creating_database","order":1,"status":"IN_PROGRESS"}

event: step
data: {"step":"creating_database","order":1,"status":"COMPLETED"}

event: error
data: {"step":"running_migrations","order":2,"status":"FAILED","error":"Connection refused"}

event: complete
data: {"tenantId":"uuid","slug":"jumeirah","url":"https://jumeirah.hospitalityfinancepro.com"}
```

**On success:** "Tenant provisioned successfully" with tenant URL and "Go to Tenant List" button.

**On failure:** Error message with "Retry from [failed step]" button → calls `POST /api/v1/platform/tenants/:slug/provision-retry` → resumes SSE from the failed step.

**Database state:** Each provisioning step updates `tenant_provisioning_steps` table. Tenant's `provisioning_status` transitions: `PENDING → PROVISIONING → ACTIVE` (or `FAILED`).

---

## Tenant Setup Wizard

### Steps

#### Step 1: Organization Structure

- Create corporate entity: name, code, country, functional currency, reporting currency, timezone
- Add properties (min 1): name, code, country, currency, timezone per property
- Dynamic list — "Add Property" button, remove button per property
- **step_data stores full properties array for resume**

#### Step 2: Department Structure

- USALI standard departments presented as toggleable list:
  - Rooms, Food & Beverage, Spa, Golf, Parking, Telecommunications, Admin & General, Sales & Marketing, Property Operations & Maintenance, Utilities, Management Fees, Non-Operating
- All toggled ON by default
- "Add Custom Department" button for non-standard departments
- Each department: name, code, is_active

#### Step 3: Chart of Accounts

- Three options:
  - **Import USALI Template** — Pre-built COA loaded from server (recommended for hospitality)
  - **Upload Custom Excel** — Uses existing `/gl/accounts/import` infrastructure
  - **Start Blank** — Empty COA, admin adds accounts manually later
- For template/upload: show preview table of accounts before confirming
- Validates minimum control accounts exist: 1200 (AR), 2100 (AP), 1000 (Cash)

#### Step 4: Fiscal Periods

- Select fiscal year start month (January default, dropdown 1-12)
- Auto-generates 12 monthly periods for current year
- Option: "Also generate next year" checkbox
- Preview table showing period names, start/end dates before confirming

#### Step 5: Currencies & FX

- Functional currency displayed (read-only, from entity created in step 1)
- Add additional operating currencies from a searchable list
- "Auto-import ECB exchange rates" toggle (calls existing ECB import)

#### Step 6: Invite Users

- Add team members (0 or more):
  - Email, first name, last name
  - Role: VIEWER, CONTROLLER, ADMIN (dropdown)
  - Entity access: checkboxes for properties created in step 1
- "Send Invitation" per user (calls existing invite endpoint)
- **Even with 0 users added, admin must click "Complete Setup"**
- "Complete Setup" button calls `POST /api/v1/setup/complete`

### Save & Resume

- Each step validates and saves via `PUT /api/v1/setup/steps/:step`
- "Save & Continue Later" button on every step: saves current form state (even if not fully valid), shows confirmation message
- On login: middleware checks `GET /api/v1/setup/progress` → if `is_completed === false`, redirect to `/setup?step={currentStep}`
- Form state restored from `step_data` JSONB on page load

### Completion

- `POST /api/v1/setup/complete` sets `is_completed = true`, `completed_at = now()`
- Redirects to `/dashboard`
- Subsequent logins skip setup, go straight to dashboard

---

## API Endpoints

### Platform Admin Onboarding

| Method | Endpoint                                          | Auth           | Request                               | Response                              |
| ------ | ------------------------------------------------- | -------------- | ------------------------------------- | ------------------------------------- |
| `POST` | `/api/v1/platform/tenants/provision`              | X-Platform-Key | `{ tenant, entitlements, adminUser }` | SSE stream                            |
| `GET`  | `/api/v1/platform/tenants/:slug/provision-status` | X-Platform-Key | —                                     | `{ data: { tenant, steps[] } }`       |
| `POST` | `/api/v1/platform/tenants/:slug/provision-retry`  | X-Platform-Key | —                                     | SSE stream (resumes from failed step) |

### Tenant Setup Wizard

| Method | Endpoint                    | Auth | Request                                      | Response                                                           |
| ------ | --------------------------- | ---- | -------------------------------------------- | ------------------------------------------------------------------ |
| `GET`  | `/api/v1/setup/progress`    | JWT  | —                                            | `{ data: { currentStep, isCompleted, stepData, completedSteps } }` |
| `PUT`  | `/api/v1/setup/steps/:step` | JWT  | Step-specific payload (see step definitions) | `{ data: { step, status: "saved" } }`                              |
| `POST` | `/api/v1/setup/complete`    | JWT  | —                                            | `{ data: { completed: true } }`                                    |

### Provision Request Schema

```typescript
{
  tenant: {
    name: string;
    slug: string;
    domain?: string;
    adminEmail: string;
    countryCode: string;
  },
  entitlements: {
    licenseType: "TRIAL" | "STANDARD" | "ENTERPRISE";
    maxProperties: number;
    maxUsers: number;
    enabledModules: string[];
    maxConcurrentSessions: number;
    subscriptionStartDate: string; // ISO date
    subscriptionEndDate?: string;  // ISO date, nullable
  },
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;
    temporaryPassword: string;
    phone?: string;
  }
}
```

---

## State Management

### Platform Wizard

- **Local React state** (useState/useReducer) — no server persistence needed
- Single-session flow: admin fills form, provisions, done
- If page is refreshed during provisioning, `GET /provision-status` restores the progress view

### Setup Wizard

- **React state initialized from** `GET /api/v1/setup/progress`
- Each "Next" calls `PUT /api/v1/setup/steps/:step` to persist
- "Save & Continue Later" calls the same endpoint without advancing `currentStep`
- On page load, form fields are populated from `step_data` JSONB

---

## Setup Enforcement Middleware

In the `(dashboard)` layout server component or middleware:

1. Fetch `GET /api/v1/setup/progress`
2. If `is_completed === false` → redirect to `/setup?step={currentStep}`
3. If `is_completed === true` → render dashboard normally

This runs on every dashboard page load. The setup progress endpoint should be fast (single row lookup by tenant_id).

---

## Error Handling

### Platform Wizard

- Slug uniqueness: real-time check on blur (debounced API call)
- Provisioning failure: show error, enable retry from failed step
- Network errors during SSE: auto-reconnect with exponential backoff, show "Reconnecting..." indicator

### Setup Wizard

- Step validation: inline errors per field, "Next" disabled until valid
- Save failures: toast notification with retry
- Session expiry: redirect to login, resume at current step after re-auth

---

## Security Considerations

- Platform admin wizard requires `X-Platform-Key` — not accessible to regular users
- Setup wizard is JWT-protected — only the tenant admin (first user) can access
- Temporary password in step 3 is transmitted over HTTPS only, not stored in frontend state after provisioning
- `tenant_setup_progress.step_data` may contain sensitive data (emails, names) — access restricted to the tenant's own admin via entity scoping
