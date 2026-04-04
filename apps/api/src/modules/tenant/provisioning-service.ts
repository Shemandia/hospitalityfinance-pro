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
      const apiRoot = resolve(import.meta.dirname ?? __dirname, "../../..");
      execSync("npx prisma db push --schema src/db/schema.prisma --skip-generate", {
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
        const apiRoot = resolve(import.meta.dirname ?? __dirname, "../../..");
        const sqlDir = resolve(apiRoot, "src/db/sql");
        const performanceSql = readFileSync(resolve(sqlDir, "performance.sql"), "utf-8");
        const rlsSql = readFileSync(resolve(sqlDir, "entity-rls.sql"), "utf-8");
        for (const file of [performanceSql, rlsSql]) {
          const statements = file
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.startsWith("--"));
          for (const stmt of statements) {
            try {
              await tenantClient.$executeRawUnsafe(stmt);
            } catch (sqlErr: any) {
              // Skip statements referencing tables that don't exist yet (42P01)
              // or indexes/views that already exist (42P07)
              const code = sqlErr?.code ?? sqlErr?.meta?.code ?? "";
              if (code === "42P01" || code === "42P07") continue;
              throw sqlErr;
            }
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
      sse("error", {
        step: "unknown",
        order: 0,
        status: "FAILED",
        error: "Tenant not found."
      });
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
        sse("step", {
          step: step.stepName,
          order: step.stepOrder,
          status: "COMPLETED"
        });
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
    sse("step", {
      step: stepName,
      order: stepDef.order,
      status: "IN_PROGRESS"
    });

    try {
      await fn();

      // Mark COMPLETED
      await registryPrisma.tenantProvisioningStep.updateMany({
        where: { tenantId, stepName },
        data: { status: "COMPLETED", completedAt: new Date() }
      });
      sse("step", {
        step: stepName,
        order: stepDef.order,
        status: "COMPLETED"
      });
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
