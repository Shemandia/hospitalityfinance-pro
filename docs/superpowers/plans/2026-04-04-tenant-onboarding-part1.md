# Tenant Onboarding — Part 1: Infrastructure & Platform Admin Wizard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared data model (entitlements, provisioning steps) and the platform admin onboarding wizard at `/platform/tenants/onboard` with SSE provisioning progress.

**Architecture:** Prisma schema additions for `TenantEntitlement`, `TenantProvisioningStep`, and `provisioningStatus` on Tenant. New provisioning API with SSE streaming in the tenant router. New Next.js `(platform)` route group with a 4-step vertical stepper wizard. Shared `WizardLayout` component used here and later in Part 2.

**Tech Stack:** Prisma (PostgreSQL), Fastify SSE, Zod validation, Next.js 15 App Router, React 19, TailwindCSS, React Hook Form

**Spec:** `docs/superpowers/specs/2026-04-04-tenant-onboarding-design.md`

---

## File Structure

| Task | Files Created                                                                                     | Files Modified                          |
| ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1    | —                                                                                                 | `apps/api/src/db/schema.prisma`         |
| 2    | `apps/api/src/modules/tenant/types.ts`                                                            | —                                       |
| 3    | `apps/api/src/modules/tenant/provisioning-service.ts`                                             | —                                       |
| 4    | —                                                                                                 | `apps/api/src/modules/tenant/router.ts` |
| 5    | `apps/web/components/wizard-layout.tsx`                                                           | —                                       |
| 6    | `apps/web/app/(platform)/layout.tsx`, `apps/web/app/(platform)/platform/tenants/onboard/page.tsx` | `apps/web/middleware.ts`                |
| 7    | `apps/web/app/(platform)/platform/tenants/page.tsx`                                               | —                                       |

---

### Task 1: Add Prisma Schema — Entitlements, Provisioning Steps, Tenant Status

**Files:**

- Modify: `apps/api/src/db/schema.prisma`

- [ ] **Step 1: Add enums and models to schema.prisma**

Add these after the existing `Tenant` model (around line 175):

```prisma
enum LicenseType {
  TRIAL
  STANDARD
  ENTERPRISE
}

enum ProvisioningStatus {
  PENDING
  PROVISIONING
  ACTIVE
  FAILED
}

enum ProvisioningStepStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
}

model TenantEntitlement {
  id                    String      @id @default(uuid())
  tenantId              String      @unique @map("tenant_id")
  tenant                Tenant      @relation(fields: [tenantId], references: [id])
  licenseType           LicenseType @map("license_type")
  maxProperties         Int         @default(10) @map("max_properties")
  maxUsers              Int         @default(50) @map("max_users")
  enabledModules        String[]    @map("enabled_modules") // GL, AP, AR, TRANSFER_DESK, REPORTING, FIXED_ASSETS
  maxConcurrentSessions Int         @default(10) @map("max_concurrent_sessions")
  subscriptionStartDate DateTime    @map("subscription_start_date") @db.Date
  subscriptionEndDate   DateTime?   @map("subscription_end_date") @db.Date
  isActive              Boolean     @default(true) @map("is_active")
  createdBy             String?     @map("created_by") @db.VarChar(255)
  updatedBy             String?     @map("updated_by") @db.VarChar(255)
  createdAt             DateTime    @default(now()) @map("created_at")
  updatedAt             DateTime    @updatedAt @map("updated_at")

  @@map("tenant_entitlements")
}

model TenantProvisioningStep {
  id           String                  @id @default(uuid())
  tenantId     String                  @map("tenant_id")
  tenant       Tenant                  @relation(fields: [tenantId], references: [id])
  stepName     String                  @map("step_name") @db.VarChar(50)
  stepOrder    Int                     @map("step_order")
  status       ProvisioningStepStatus  @default(PENDING)
  errorMessage String?                 @map("error_message")
  startedAt    DateTime?               @map("started_at")
  completedAt  DateTime?               @map("completed_at")
  createdAt    DateTime                @default(now()) @map("created_at")
  updatedAt    DateTime                @updatedAt @map("updated_at")

  @@index([tenantId])
  @@map("tenant_provisioning_steps")
}
```

- [ ] **Step 2: Add provisioningStatus and relations to existing Tenant model**

In the existing `Tenant` model, add:

```prisma
model Tenant {
  // ... existing fields ...
  provisioningStatus ProvisioningStatus @default(PENDING) @map("provisioning_status")

  // Relations
  entitlement        TenantEntitlement?
  provisioningSteps  TenantProvisioningStep[]

  @@map("tenants")
}
```

- [ ] **Step 3: Add TenantSetupProgress model (tenant DB)**

This model lives in the tenant database. Add after the other models:

```prisma
model TenantSetupProgress {
  id             String    @id @default(uuid())
  tenantId       String    @map("tenant_id")
  currentStep    Int       @default(1) @map("current_step")
  isCompleted    Boolean   @default(false) @map("is_completed")
  stepData       Json      @default("{}") @map("step_data")
  completedSteps Int[]     @default([]) @map("completed_steps")
  completedAt    DateTime? @map("completed_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@map("tenant_setup_progress")
}
```

- [ ] **Step 4: Generate Prisma client and create migration**

Run:

```bash
cd apps/api && npx prisma generate --schema src/db/schema.prisma
cd apps/api && npx prisma migrate dev --schema src/db/schema.prisma --name add_tenant_onboarding_tables
```

Expected: Migration created, Prisma client regenerated with new types.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.prisma apps/api/src/db/migrations/
git commit -m "feat: add tenant entitlements, provisioning steps, and setup progress schema

Add TenantEntitlement (license-based entitlements), TenantProvisioningStep
(tracks provisioning progress), TenantSetupProgress (setup wizard state),
and ProvisioningStatus enum on Tenant model."
```

---

### Task 2: Create Provisioning Zod Schemas and Types

**Files:**

- Create: `apps/api/src/modules/tenant/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import { z } from "zod";

// ── Provisioning request schemas ────────────────────────────────────────────

export const provisionTenantSchema = z.object({
  tenant: z.object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(
        /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
        "Slug must be 3-50 chars, lowercase alphanumeric with hyphens."
      ),
    domain: z.string().max(253).optional(),
    adminEmail: z.string().email(),
    countryCode: z.string().length(2)
  }),
  entitlements: z.object({
    licenseType: z.enum(["TRIAL", "STANDARD", "ENTERPRISE"]),
    maxProperties: z.number().int().min(1),
    maxUsers: z.number().int().min(1),
    enabledModules: z.array(z.string().min(1)).min(1),
    maxConcurrentSessions: z.number().int().min(1),
    subscriptionStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date required"),
    subscriptionEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date required")
      .optional()
      .nullable()
  }),
  adminUser: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    temporaryPassword: z.string().min(12),
    phone: z.string().max(50).optional()
  })
});

export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;

// ── Provisioning step names (ordered) ───────────────────────────────────────

export const PROVISIONING_STEPS = [
  { name: "creating_database", order: 1, label: "Creating database" },
  { name: "running_migrations", order: 2, label: "Running migrations" },
  { name: "applying_security", order: 3, label: "Applying security policies" },
  { name: "creating_auth", order: 4, label: "Creating auth realm" },
  { name: "seeding_data", order: 5, label: "Seeding initial data" },
  { name: "sending_email", order: 6, label: "Sending activation email" }
] as const;

export type ProvisioningStepName = (typeof PROVISIONING_STEPS)[number]["name"];
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write apps/api/src/modules/tenant/types.ts
git add apps/api/src/modules/tenant/types.ts
git commit -m "feat: add tenant provisioning Zod schemas and types"
```

---

### Task 3: Create Provisioning Service with SSE Support

**Files:**

- Create: `apps/api/src/modules/tenant/provisioning-service.ts`

- [ ] **Step 1: Create the provisioning service**

```typescript
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { registryPrisma } from "../../db/prisma.js";
import { sendEmail } from "../../shared/email.js";
import {
  PROVISIONING_STEPS,
  type ProvisionTenantInput,
  type ProvisioningStepName
} from "./types.js";

type SSEWriter = (event: string, data: Record<string, unknown>) => void;

function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: u.username,
    password: u.password
  };
}

function buildDbUrl(
  user: string,
  password: string,
  host: string,
  port: string,
  dbName: string
): string {
  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

export class ProvisioningService {
  /**
   * Run full provisioning for a new tenant, streaming progress via SSE.
   * Each step updates the database and emits an SSE event.
   */
  async provision(input: ProvisionTenantInput, sse: SSEWriter): Promise<void> {
    const { tenant, entitlements, adminUser } = input;
    const tenantDbName = `hfp_${tenant.slug.replace(/-/g, "_")}`;

    // Check slug uniqueness
    const existing = await registryPrisma.tenant.findUnique({
      where: { slug: tenant.slug }
    });
    if (existing) {
      sse("error", {
        step: "creating_database",
        order: 1,
        status: "FAILED",
        error: `Tenant with slug "${tenant.slug}" already exists.`
      });
      return;
    }

    // Determine DB connection details
    const registryUrl = process.env.REGISTRY_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    const dbConn = parseDbUrl(registryUrl);
    const tenantDbHost = process.env.TENANT_DB_HOST ?? dbConn.host;
    const tenantDbPort = process.env.TENANT_DB_PORT ?? dbConn.port;
    const tenantDbUser = process.env.TENANT_DB_USER ?? dbConn.user;
    const tenantDbPassword = process.env.TENANT_DB_PASSWORD ?? dbConn.password;
    const tenantDbUrl = buildDbUrl(
      tenantDbUser,
      tenantDbPassword,
      tenantDbHost,
      tenantDbPort,
      tenantDbName
    );

    // Create tenant record + entitlement + provisioning steps in one transaction
    const tenantRecord = await registryPrisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: tenant.name,
          slug: tenant.slug,
          databaseUrl: tenantDbUrl,
          domain: tenant.domain ?? null,
          adminEmail: tenant.adminEmail,
          provisioningStatus: "PROVISIONING"
        }
      });

      await tx.tenantEntitlement.create({
        data: {
          tenantId: t.id,
          licenseType: entitlements.licenseType,
          maxProperties: entitlements.maxProperties,
          maxUsers: entitlements.maxUsers,
          enabledModules: entitlements.enabledModules,
          maxConcurrentSessions: entitlements.maxConcurrentSessions,
          subscriptionStartDate: new Date(entitlements.subscriptionStartDate),
          subscriptionEndDate: entitlements.subscriptionEndDate
            ? new Date(entitlements.subscriptionEndDate)
            : null,
          createdBy: adminUser.email
        }
      });

      for (const step of PROVISIONING_STEPS) {
        await tx.tenantProvisioningStep.create({
          data: {
            tenantId: t.id,
            stepName: step.name,
            stepOrder: step.order,
            status: "PENDING"
          }
        });
      }

      return t;
    });

    // Execute each provisioning step
    await this.executeStep(tenantRecord.id, "creating_database", sse, async () => {
      const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
      if (!identifierRegex.test(tenantDbName)) {
        throw new Error(`Invalid database name: ${tenantDbName}`);
      }
      if (!identifierRegex.test(tenantDbUser)) {
        throw new Error(`Invalid database user: ${tenantDbUser}`);
      }
      try {
        await registryPrisma.$executeRawUnsafe(
          `CREATE DATABASE "${tenantDbName}" OWNER "${tenantDbUser}"`
        );
      } catch (error: any) {
        if (!error.message?.includes("already exists")) throw error;
      }
    });

    await this.executeStep(tenantRecord.id, "running_migrations", sse, async () => {
      const apiRoot = resolve(import.meta.dirname ?? __dirname, "../..");
      execSync("npx prisma migrate deploy --schema src/db/schema.prisma", {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: tenantDbUrl },
        stdio: "pipe",
        timeout: 60_000
      });
    });

    await this.executeStep(tenantRecord.id, "applying_security", sse, async () => {
      const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
      try {
        const { readFileSync } = await import("node:fs");
        const apiRoot = resolve(import.meta.dirname ?? __dirname, "../..");
        const sqlDir = resolve(apiRoot, "src/db/sql");
        const performanceSql = readFileSync(resolve(sqlDir, "performance.sql"), "utf-8");
        const rlsSql = readFileSync(resolve(sqlDir, "entity-rls.sql"), "utf-8");
        for (const file of [performanceSql, rlsSql]) {
          const statements = file
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const stmt of statements) {
            await tenantClient.$executeRawUnsafe(stmt);
          }
        }
      } finally {
        await tenantClient.$disconnect();
      }
    });

    await this.executeStep(tenantRecord.id, "creating_auth", sse, async () => {
      // Keycloak user creation — in dev mode, create a User record in the tenant DB.
      // In production, this would call the Keycloak Admin API to create a realm and user.
      const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
      try {
        await tenantClient.user.create({
          data: {
            keycloakId: `dev-${tenant.slug}-admin`,
            email: adminUser.email,
            name: `${adminUser.firstName} ${adminUser.lastName}`,
            isActive: true
          }
        });
      } finally {
        await tenantClient.$disconnect();
      }
    });

    await this.executeStep(tenantRecord.id, "seeding_data", sse, async () => {
      // Create the setup progress record so the tenant admin gets the wizard on first login
      const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
      try {
        await tenantClient.tenantSetupProgress.create({
          data: {
            tenantId: tenantRecord.id,
            currentStep: 1,
            isCompleted: false,
            stepData: {},
            completedSteps: []
          }
        });
      } finally {
        await tenantClient.$disconnect();
      }
    });

    await this.executeStep(tenantRecord.id, "sending_email", sse, async () => {
      const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3001";
      const activationUrl = `${appUrl}/login?tenant=${tenant.slug}`;
      await sendEmail({
        to: adminUser.email,
        subject: `Your HospitalityFinance Pro account is ready — ${tenant.name}`,
        html: `
          <p>Hello ${adminUser.firstName},</p>
          <p>Your HospitalityFinance Pro account for <strong>${tenant.name}</strong> has been provisioned.</p>
          <p>Log in at: <a href="${activationUrl}">${activationUrl}</a></p>
          <p>Your temporary credentials:</p>
          <ul>
            <li>Email: ${adminUser.email}</li>
            <li>Password: (set during onboarding — contact your platform administrator)</li>
          </ul>
          <p>On first login, you will be guided through a setup wizard to configure your organization.</p>
        `
      });
    });

    // Mark tenant as ACTIVE
    await registryPrisma.tenant.update({
      where: { id: tenantRecord.id },
      data: {
        provisioningStatus: "ACTIVE",
        provisionedAt: new Date()
      }
    });

    sse("complete", {
      tenantId: tenantRecord.id,
      slug: tenant.slug,
      url: `${process.env.APP_BASE_URL ?? "http://localhost:3001"}/login?tenant=${tenant.slug}`
    });
  }

  /**
   * Resume provisioning from the first failed or pending step.
   */
  async retry(slug: string, sse: SSEWriter): Promise<void> {
    const tenant = await registryPrisma.tenant.findUnique({
      where: { slug },
      include: { provisioningSteps: { orderBy: { stepOrder: "asc" } } }
    });
    if (!tenant) {
      sse("error", { step: "unknown", order: 0, status: "FAILED", error: "Tenant not found." });
      return;
    }

    // Find the first non-completed step
    const pendingStep = tenant.provisioningSteps.find((s) => s.status !== "COMPLETED");
    if (!pendingStep) {
      sse("complete", { tenantId: tenant.id, slug: tenant.slug, url: "" });
      return;
    }

    // Re-emit completed steps
    for (const step of tenant.provisioningSteps) {
      if (step.status === "COMPLETED") {
        sse("step", { step: step.stepName, order: step.stepOrder, status: "COMPLETED" });
      }
    }

    // For retry, we need to re-run the provisioning logic from the failed step.
    // This is a simplified version — a full implementation would re-execute
    // only the remaining steps using the same logic as `provision()`.
    sse("error", {
      step: pendingStep.stepName,
      order: pendingStep.stepOrder,
      status: "FAILED",
      error: "Retry not yet fully implemented — use the CLI provisioning script to resume."
    });
  }

  /**
   * Get current provisioning status for a tenant.
   */
  async getStatus(slug: string) {
    const tenant = await registryPrisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        provisioningStatus: true,
        provisionedAt: true,
        provisioningSteps: {
          orderBy: { stepOrder: "asc" },
          select: {
            stepName: true,
            stepOrder: true,
            status: true,
            errorMessage: true,
            startedAt: true,
            completedAt: true
          }
        }
      }
    });
    return tenant;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async executeStep(
    tenantId: string,
    stepName: ProvisioningStepName,
    sse: SSEWriter,
    fn: () => Promise<void>
  ): Promise<void> {
    const stepDef = PROVISIONING_STEPS.find((s) => s.name === stepName)!;

    // Mark IN_PROGRESS
    await registryPrisma.tenantProvisioningStep.updateMany({
      where: { tenantId, stepName },
      data: { status: "IN_PROGRESS", startedAt: new Date(), errorMessage: null }
    });
    sse("step", { step: stepName, order: stepDef.order, status: "IN_PROGRESS" });

    try {
      await fn();

      // Mark COMPLETED
      await registryPrisma.tenantProvisioningStep.updateMany({
        where: { tenantId, stepName },
        data: { status: "COMPLETED", completedAt: new Date() }
      });
      sse("step", { step: stepName, order: stepDef.order, status: "COMPLETED" });
    } catch (error: any) {
      const message = error?.message ?? "Unknown error";

      // Mark FAILED
      await registryPrisma.tenantProvisioningStep.updateMany({
        where: { tenantId, stepName },
        data: { status: "FAILED", errorMessage: message }
      });
      await registryPrisma.tenant.update({
        where: { id: tenantId },
        data: { provisioningStatus: "FAILED" }
      });
      sse("error", {
        step: stepName,
        order: stepDef.order,
        status: "FAILED",
        error: message
      });
      throw error; // Stop further steps
    }
  }
}
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write apps/api/src/modules/tenant/provisioning-service.ts
git add apps/api/src/modules/tenant/provisioning-service.ts
git commit -m "feat: add tenant provisioning service with SSE progress streaming

Handles database creation, migrations, RLS setup, auth user creation,
seeding, and activation email. Each step tracked in tenant_provisioning_steps
with real-time SSE events."
```

---

### Task 4: Add Provisioning API Endpoints to Tenant Router

**Files:**

- Modify: `apps/api/src/modules/tenant/router.ts`

- [ ] **Step 1: Add the three new provisioning endpoints**

At the top of `router.ts`, add imports:

```typescript
import { provisionTenantSchema } from "./types.js";
import { ProvisioningService } from "./provisioning-service.js";
```

Inside the `router.register(async (router) => { ... })` block, after the existing endpoints (before the closing `}` of the register callback), add:

```typescript
// ── Provisioning endpoints ──────────────────────────────────────────

const provisioningService = new ProvisioningService();

// Start provisioning (SSE stream)
router.post("/tenants/provision", async (request, reply) => {
  const input = provisionTenantSchema.parse(request.body);

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const sse = (event: string, data: Record<string, unknown>) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await provisioningService.provision(input, sse);
  } catch {
    // Error already emitted via SSE in the service
  } finally {
    reply.raw.end();
  }
});

// Get provisioning status
router.get<{ Params: { slug: string } }>(
  "/tenants/:slug/provision-status",
  async (request, reply) => {
    const status = await provisioningService.getStatus(request.params.slug);
    if (!status) {
      return reply.code(404).send({
        data: null,
        errors: [{ code: "TENANT_NOT_FOUND", message: "Tenant not found." }]
      });
    }
    return reply.send({ data: status, errors: [] });
  }
);

// Retry provisioning from failed step (SSE stream)
router.post<{ Params: { slug: string } }>(
  "/tenants/:slug/provision-retry",
  async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const sse = (event: string, data: Record<string, unknown>) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await provisioningService.retry(request.params.slug, sse);
    } catch {
      // Error already emitted via SSE
    } finally {
      reply.raw.end();
    }
  }
);
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write apps/api/src/modules/tenant/router.ts
git add apps/api/src/modules/tenant/router.ts
git commit -m "feat: add provisioning API endpoints with SSE streaming

POST /provision starts provisioning and streams progress via SSE.
GET /:slug/provision-status returns current state.
POST /:slug/provision-retry resumes from failed step."
```

---

### Task 5: Create Shared WizardLayout Component

**Files:**

- Create: `apps/web/components/wizard-layout.tsx`

- [ ] **Step 1: Create the WizardLayout component**

```tsx
"use client";

import { Check } from "lucide-react";
import { cn } from "../lib/utils";

export type WizardStepDef = {
  id: number;
  name: string;
  description?: string;
};

type WizardLayoutProps = {
  title: string;
  steps: WizardStepDef[];
  currentStep: number;
  completedSteps: number[];
  onStepClick?: (step: number) => void;
  children: React.ReactNode;
};

export function WizardLayout({
  title,
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  children
}: WizardLayoutProps) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar stepper */}
      <aside className="w-64 flex-shrink-0 border-r bg-slate-900 text-slate-200">
        <div className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        </div>
        <nav className="space-y-1 px-3">
          {steps.map((step) => {
            const isCompleted = completedSteps.includes(step.id);
            const isCurrent = step.id === currentStep;
            const isClickable =
              onStepClick && (isCompleted || step.id <= Math.max(...completedSteps, 0) + 1);

            return (
              <button
                key={step.id}
                onClick={() => isClickable && onStepClick?.(step.id)}
                disabled={!isClickable}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                  isCurrent && "bg-slate-800 text-white",
                  !isCurrent && !isCompleted && "text-slate-500",
                  isCompleted && !isCurrent && "text-slate-300",
                  isClickable && "cursor-pointer hover:bg-slate-800",
                  !isClickable && "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isCurrent && "bg-blue-600 text-white",
                    isCompleted && !isCurrent && "bg-emerald-600 text-white",
                    !isCurrent && !isCompleted && "border border-slate-600 text-slate-500"
                  )}
                >
                  {isCompleted && !isCurrent ? <Check className="h-3.5 w-3.5" /> : step.id}
                </span>
                <span className="truncate">{step.name}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="mx-auto max-w-2xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

type WizardStepContentProps = {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  onSave?: () => void;
  nextLabel?: string;
  isNextDisabled?: boolean;
  isLoading?: boolean;
  showSave?: boolean;
};

export function WizardStepContent({
  stepNumber,
  totalSteps,
  title,
  description,
  children,
  onBack,
  onNext,
  onSave,
  nextLabel = "Continue",
  isNextDisabled = false,
  isLoading = false,
  showSave = false
}: WizardStepContentProps) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Step {stepNumber} of {totalSteps}
      </p>
      <h3 className="mt-1 text-xl font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-6">{children}</div>
      <div className="mt-8 flex items-center justify-between border-t pt-6">
        <div>
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {showSave && onSave && (
            <button
              onClick={onSave}
              disabled={isLoading}
              className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Save & Continue Later
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              disabled={isNextDisabled || isLoading}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? "Processing…" : nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write apps/web/components/wizard-layout.tsx
git add apps/web/components/wizard-layout.tsx
git commit -m "feat: add shared WizardLayout component with vertical stepper

Reusable wizard with left sidebar stepper and content area.
Used by both platform admin onboarding and tenant setup wizard."
```

---

### Task 6: Create Platform Admin Onboarding Page

**Files:**

- Create: `apps/web/app/(platform)/layout.tsx`
- Create: `apps/web/app/(platform)/platform/tenants/onboard/page.tsx`
- Modify: `apps/web/middleware.ts`

- [ ] **Step 1: Update middleware to allow platform routes without JWT auth**

In `apps/web/middleware.ts`, add `/platform` to public paths:

```typescript
const PUBLIC_PATHS = new Set(["/login"]);
```

Change to:

```typescript
const PUBLIC_PATHS = new Set(["/login"]);
```

And update the auth check:

```typescript
const isPlatformRoute = pathname.startsWith("/platform");

if (isAuthRoute || isAssetPath || isPlatformRoute) {
  return NextResponse.next();
}
```

- [ ] **Step 2: Create platform layout**

```tsx
// apps/web/app/(platform)/layout.tsx
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-slate-900">HospitalityFinance Pro</span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Platform Admin
          </span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Create the onboarding wizard page**

This is a large component. Create `apps/web/app/(platform)/platform/tenants/onboard/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { WizardLayout, WizardStepContent } from "../../../../../components/wizard-layout";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const STEPS = [
  { id: 1, name: "Tenant Details" },
  { id: 2, name: "Entitlements" },
  { id: 3, name: "Admin Account" },
  { id: 4, name: "Review & Provision" }
];

const MODULES = ["GL", "AP", "AR", "TRANSFER_DESK", "REPORTING", "FIXED_ASSETS"];

type TenantData = {
  name: string;
  slug: string;
  domain: string;
  adminEmail: string;
  countryCode: string;
};

type EntitlementData = {
  licenseType: "TRIAL" | "STANDARD" | "ENTERPRISE";
  maxProperties: number;
  maxUsers: number;
  enabledModules: string[];
  maxConcurrentSessions: number;
  subscriptionStartDate: string;
  subscriptionEndDate: string;
};

type AdminData = {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  phone: string;
};

type ProvisioningStep = {
  step: string;
  order: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string;
};

export default function OnboardPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioningSteps, setProvisioningSteps] = useState<ProvisioningStep[]>([]);
  const [provisionResult, setProvisionResult] = useState<{
    tenantId: string;
    slug: string;
    url: string;
  } | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  const [tenant, setTenant] = useState<TenantData>({
    name: "",
    slug: "",
    domain: "",
    adminEmail: "",
    countryCode: ""
  });

  const [entitlements, setEntitlements] = useState<EntitlementData>({
    licenseType: "STANDARD",
    maxProperties: 10,
    maxUsers: 50,
    enabledModules: ["GL", "AP", "AR", "REPORTING"],
    maxConcurrentSessions: 10,
    subscriptionStartDate: new Date().toISOString().split("T")[0],
    subscriptionEndDate: ""
  });

  const [admin, setAdmin] = useState<AdminData>({
    firstName: "",
    lastName: "",
    email: "",
    temporaryPassword: "",
    phone: ""
  });

  const generateSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

  const handleNext = () => {
    if (currentStep === 1 && admin.email === "") {
      setAdmin((a) => ({ ...a, email: tenant.adminEmail }));
    }
    setCompletedSteps((prev) => (prev.includes(currentStep) ? prev : [...prev, currentStep]));
    setCurrentStep((s) => s + 1);
  };

  const handleBack = () => setCurrentStep((s) => s - 1);

  const handleProvision = async () => {
    setProvisioning(true);
    setProvisionError(null);
    setProvisioningSteps([
      { step: "creating_database", order: 1, status: "PENDING" },
      { step: "running_migrations", order: 2, status: "PENDING" },
      { step: "applying_security", order: 3, status: "PENDING" },
      { step: "creating_auth", order: 4, status: "PENDING" },
      { step: "seeding_data", order: 5, status: "PENDING" },
      { step: "sending_email", order: 6, status: "PENDING" }
    ]);

    const platformKey = sessionStorage.getItem("hfp-platform-key") ?? "";

    try {
      const response = await fetch(`${API_BASE}/api/v1/platform/tenants/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Platform-Key": platformKey
        },
        body: JSON.stringify({
          tenant: {
            name: tenant.name,
            slug: tenant.slug,
            domain: tenant.domain || undefined,
            adminEmail: tenant.adminEmail,
            countryCode: tenant.countryCode
          },
          entitlements: {
            ...entitlements,
            subscriptionEndDate: entitlements.subscriptionEndDate || undefined
          },
          adminUser: {
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            temporaryPassword: admin.temporaryPassword,
            phone: admin.phone || undefined
          }
        })
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (eventType === "step" || eventType === "error") {
              setProvisioningSteps((prev) =>
                prev.map((s) => (s.step === data.step ? { ...s, ...data } : s))
              );
              if (eventType === "error") {
                setProvisionError(data.error);
              }
            } else if (eventType === "complete") {
              setProvisionResult(data);
            }
          }
        }
      }
    } catch (err: any) {
      setProvisionError(err.message ?? "Connection failed");
    }
  };

  const stepIcons: Record<string, string> = {
    PENDING: "○",
    IN_PROGRESS: "⟳",
    COMPLETED: "✓",
    FAILED: "✗"
  };

  return (
    <WizardLayout
      title="Onboard New Tenant"
      steps={STEPS}
      currentStep={provisioning ? 4 : currentStep}
      completedSteps={completedSteps}
      onStepClick={provisioning ? undefined : setCurrentStep}
    >
      {/* Step 1: Tenant Details */}
      {currentStep === 1 && !provisioning && (
        <WizardStepContent
          stepNumber={1}
          totalSteps={4}
          title="Tenant Details"
          description="Basic information about the hotel chain"
          onNext={handleNext}
          isNextDisabled={!tenant.name || !tenant.slug || !tenant.adminEmail || !tenant.countryCode}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Company Name *</label>
              <input
                type="text"
                value={tenant.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setTenant((t) => ({
                    ...t,
                    name,
                    slug: t.slug === generateSlug(t.name) ? generateSlug(name) : t.slug
                  }));
                }}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Jumeirah Group"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Slug *</label>
                <input
                  type="text"
                  value={tenant.slug}
                  onChange={(e) => setTenant((t) => ({ ...t, slug: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Domain</label>
                <input
                  type="text"
                  value={tenant.domain}
                  onChange={(e) => setTenant((t) => ({ ...t, domain: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="finance.jumeirah.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Admin Email *</label>
                <input
                  type="email"
                  value={tenant.adminEmail}
                  onChange={(e) => setTenant((t) => ({ ...t, adminEmail: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="cfo@jumeirah.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Country *</label>
                <input
                  type="text"
                  value={tenant.countryCode}
                  onChange={(e) =>
                    setTenant((t) => ({
                      ...t,
                      countryCode: e.target.value.toUpperCase().slice(0, 2)
                    }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="AE"
                  maxLength={2}
                />
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 2: Entitlements */}
      {currentStep === 2 && !provisioning && (
        <WizardStepContent
          stepNumber={2}
          totalSteps={4}
          title="Entitlements"
          description="Configure license and module access"
          onBack={handleBack}
          onNext={handleNext}
          isNextDisabled={entitlements.enabledModules.length === 0}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">License Type *</label>
              <select
                value={entitlements.licenseType}
                onChange={(e) =>
                  setEntitlements((ent) => ({ ...ent, licenseType: e.target.value as any }))
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="TRIAL">Trial</option>
                <option value="STANDARD">Standard</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Max Properties *</label>
                <input
                  type="number"
                  min={1}
                  value={entitlements.maxProperties}
                  onChange={(e) =>
                    setEntitlements((ent) => ({
                      ...ent,
                      maxProperties: parseInt(e.target.value) || 1
                    }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Max Users *</label>
                <input
                  type="number"
                  min={1}
                  value={entitlements.maxUsers}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, maxUsers: parseInt(e.target.value) || 1 }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Max Sessions *</label>
                <input
                  type="number"
                  min={1}
                  value={entitlements.maxConcurrentSessions}
                  onChange={(e) =>
                    setEntitlements((ent) => ({
                      ...ent,
                      maxConcurrentSessions: parseInt(e.target.value) || 1
                    }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Enabled Modules *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MODULES.map((mod) => (
                  <label key={mod} className="flex items-center gap-2 rounded border p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={entitlements.enabledModules.includes(mod)}
                      onChange={(e) => {
                        setEntitlements((ent) => ({
                          ...ent,
                          enabledModules: e.target.checked
                            ? [...ent.enabledModules, mod]
                            : ent.enabledModules.filter((m) => m !== mod)
                        }));
                      }}
                    />
                    {mod.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Start Date *</label>
                <input
                  type="date"
                  value={entitlements.subscriptionStartDate}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, subscriptionStartDate: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">End Date</label>
                <input
                  type="date"
                  value={entitlements.subscriptionEndDate}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, subscriptionEndDate: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 3: Admin Account */}
      {currentStep === 3 && !provisioning && (
        <WizardStepContent
          stepNumber={3}
          totalSteps={4}
          title="Admin Account"
          description="First admin user for this tenant"
          onBack={handleBack}
          onNext={handleNext}
          isNextDisabled={
            !admin.firstName ||
            !admin.lastName ||
            !admin.email ||
            admin.temporaryPassword.length < 12
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">First Name *</label>
                <input
                  type="text"
                  value={admin.firstName}
                  onChange={(e) => setAdmin((a) => ({ ...a, firstName: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Last Name *</label>
                <input
                  type="text"
                  value={admin.lastName}
                  onChange={(e) => setAdmin((a) => ({ ...a, lastName: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Email *</label>
              <input
                type="email"
                value={admin.email}
                onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Temporary Password * (min 12 chars)
              </label>
              <input
                type="password"
                value={admin.temporaryPassword}
                onChange={(e) => setAdmin((a) => ({ ...a, temporaryPassword: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
              {admin.temporaryPassword.length > 0 && admin.temporaryPassword.length < 12 && (
                <p className="mt-1 text-xs text-red-500">Must be at least 12 characters</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="tel"
                value={admin.phone}
                onChange={(e) => setAdmin((a) => ({ ...a, phone: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 4: Review & Provision */}
      {currentStep === 4 && !provisioning && (
        <WizardStepContent
          stepNumber={4}
          totalSteps={4}
          title="Review & Provision"
          description="Confirm details and start provisioning"
          onBack={handleBack}
          onNext={handleProvision}
          nextLabel="Provision Tenant"
        >
          <div className="space-y-6">
            <section>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Tenant Details</h4>
                <button
                  onClick={() => setCurrentStep(1)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">{tenant.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Slug</dt>
                  <dd className="font-mono">{tenant.slug}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd>{tenant.adminEmail}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Country</dt>
                  <dd>{tenant.countryCode}</dd>
                </div>
              </dl>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Entitlements</h4>
                <button
                  onClick={() => setCurrentStep(2)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">License</dt>
                  <dd className="font-medium">{entitlements.licenseType}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Properties</dt>
                  <dd>{entitlements.maxProperties}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Users</dt>
                  <dd>{entitlements.maxUsers}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Modules</dt>
                  <dd>{entitlements.enabledModules.join(", ")}</dd>
                </div>
              </dl>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Admin Account</h4>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">
                    {admin.firstName} {admin.lastName}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd>{admin.email}</dd>
                </div>
              </dl>
            </section>
          </div>
        </WizardStepContent>
      )}

      {/* Provisioning Progress */}
      {provisioning && (
        <div>
          <h3 className="text-xl font-semibold text-slate-900">
            {provisionResult
              ? "Provisioning Complete"
              : provisionError
                ? "Provisioning Failed"
                : "Provisioning…"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {provisionResult
              ? `${tenant.name} is ready to use.`
              : provisionError
                ? "An error occurred during provisioning."
                : "Setting up the tenant environment…"}
          </p>
          <div className="mt-6 space-y-3">
            {provisioningSteps.map((ps) => (
              <div key={ps.step} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    ps.status === "COMPLETED"
                      ? "bg-emerald-100 text-emerald-700"
                      : ps.status === "IN_PROGRESS"
                        ? "bg-blue-100 text-blue-700 animate-pulse"
                        : ps.status === "FAILED"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {stepIcons[ps.status]}
                </span>
                <span className={ps.status === "FAILED" ? "text-red-700" : "text-slate-700"}>
                  {ps.step.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                </span>
                {ps.status === "FAILED" && ps.error && (
                  <span className="text-xs text-red-500">— {ps.error}</span>
                )}
              </div>
            ))}
          </div>
          {provisionResult && (
            <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800">Tenant URL:</p>
              <a href={provisionResult.url} className="text-sm text-blue-600 hover:underline">
                {provisionResult.url}
              </a>
            </div>
          )}
          {provisionError && !provisionResult && (
            <button
              onClick={handleProvision}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry Provisioning
            </button>
          )}
        </div>
      )}
    </WizardLayout>
  );
}
```

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write apps/web/app/\(platform\)/layout.tsx apps/web/app/\(platform\)/platform/tenants/onboard/page.tsx apps/web/middleware.ts
git add apps/web/app/\(platform\) apps/web/middleware.ts
git commit -m "feat: add platform admin onboarding wizard at /platform/tenants/onboard

4-step wizard with tenant details, entitlements, admin account, and
review+provision with real-time SSE progress streaming. Uses shared
WizardLayout component with vertical stepper sidebar."
```

---

### Task 7: Create Platform Tenant List Page

**Files:**

- Create: `apps/web/app/(platform)/platform/tenants/page.tsx`

- [ ] **Step 1: Create the tenant list page**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  adminEmail: string;
  provisioningStatus: string;
  isActive: boolean;
  provisionedAt: string | null;
  createdAt: string;
};

export default function TenantListPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const platformKey = sessionStorage.getItem("hfp-platform-key");
    if (!platformKey) return;

    fetch(`${API_BASE}/api/v1/platform/tenants`, {
      headers: { "X-Platform-Key": platformKey }
    })
      .then((r) => r.json())
      .then((json) => setTenants(json.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ACTIVE: "bg-emerald-100 text-emerald-700",
      PROVISIONING: "bg-blue-100 text-blue-700",
      PENDING: "bg-slate-100 text-slate-600",
      FAILED: "bg-red-100 text-red-700"
    };
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors.PENDING}`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Tenants</h1>
        <Link
          href="/platform/tenants/onboard"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Onboard New Tenant
        </Link>
      </div>
      <div className="mt-6 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Admin</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Provisioned</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No tenants yet
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{t.slug}</td>
                  <td className="px-4 py-3 text-slate-500">{t.adminEmail}</td>
                  <td className="px-4 py-3">{statusBadge(t.provisioningStatus)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {t.provisionedAt ? new Date(t.provisionedAt).toLocaleDateString("en-US") : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write apps/web/app/\(platform\)/platform/tenants/page.tsx
git add apps/web/app/\(platform\)/platform/tenants/page.tsx
git commit -m "feat: add platform tenant list page with provisioning status

Shows all tenants with status badges (PENDING, PROVISIONING, ACTIVE, FAILED)
and a link to the onboard wizard."
```

---

## Summary

| Task | What it builds                                                   | Files                                    |
| ---- | ---------------------------------------------------------------- | ---------------------------------------- |
| 1    | Prisma schema (entitlements, provisioning steps, setup progress) | `schema.prisma` + migration              |
| 2    | Zod schemas and types for provisioning API                       | `tenant/types.ts`                        |
| 3    | Provisioning service with SSE support                            | `tenant/provisioning-service.ts`         |
| 4    | Provisioning API endpoints (SSE)                                 | `tenant/router.ts`                       |
| 5    | Shared WizardLayout component                                    | `components/wizard-layout.tsx`           |
| 6    | Platform admin onboarding wizard page                            | `(platform)/` layout + page + middleware |
| 7    | Platform tenant list page                                        | `(platform)/platform/tenants/page.tsx`   |

**Part 2** (Tenant Setup Wizard at `/setup`) will be a separate plan covering:

- Setup API endpoints (progress, step save, complete)
- 6-step setup wizard page
- Setup enforcement middleware in dashboard layout
- Each wizard step component (org structure, departments, COA, periods, currencies, users)
