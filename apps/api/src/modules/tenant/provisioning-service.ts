import { PrismaClient } from "../../db/client.js";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import bcrypt from "bcrypt";
import { registryPrisma } from "../../db/prisma.js";
import { generateTenantCode } from "../../db/generateTenantCode.js";
import { sendWelcomeEmail } from "../../shared/email.js";
import {
  applyAccessMigration,
  ensureSystemCatalog,
  grantTenantAdministrator
} from "../access/setup.js";
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
      const tenantCode = await generateTenantCode(tenant.slug);
      const t = await tx.tenant.create({
        data: {
          name: tenant.name,
          slug: tenant.slug,
          tenantCode,
          databaseUrl: tenantDbUrl,
          domain: tenant.domain ?? null,
          adminEmail: tenant.adminEmail,
          countryCode: tenant.countryCode,
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
      execSync("npx prisma db push --schema src/db/schema-tenant.prisma --skip-generate", {
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
          // Split on semicolons but respect $$ dollar-quoted blocks (PL/pgSQL)
          const statements: string[] = [];
          let current = "";
          let inDollarBlock = false;
          for (const line of file.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("--") && !inDollarBlock) continue;
            if (trimmed.includes("$$")) {
              inDollarBlock = !inDollarBlock;
            }
            current += line + "\n";
            if (!inDollarBlock && trimmed.endsWith(";")) {
              const stmt = current.trim().replace(/;$/, "").trim();
              if (stmt.length > 0) statements.push(stmt);
              current = "";
            }
          }
          if (current.trim().length > 0) {
            const stmt = current.trim().replace(/;$/, "").trim();
            if (stmt.length > 0) statements.push(stmt);
          }
          for (const stmt of statements) {
            try {
              await tenantClient.$executeRawUnsafe(stmt);
            } catch (sqlErr: any) {
              // Skip statements referencing tables/relations that don't exist yet
              // or indexes/views that already exist. Prisma wraps PG errors in
              // different structures, so check message string as fallback.
              const msg = sqlErr?.message ?? "";
              const code = sqlErr?.code ?? sqlErr?.meta?.code ?? "";
              if (
                code === "42P01" ||
                code === "42P07" ||
                msg.includes("does not exist") ||
                msg.includes("already exists")
              )
                continue;
              throw sqlErr;
            }
          }
        }
        // Not skippable like the statements above: the grants table must be
        // constrained and protected before the first administrator is written.
        await applyAccessMigration(tenantClient);
      } finally {
        await tenantClient.$disconnect();
      }
    });

    await this.executeStep(tenantRecord.id, "creating_auth", sse, async () => {
      const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
      try {
        // The catalogue and the starting roles, then the first administrator.
        await ensureSystemCatalog(tenantClient);
        const passwordHash = await bcrypt.hash(adminUser.temporaryPassword, 12);
        const user = await tenantClient.user.upsert({
          where: { email: adminUser.email.toLowerCase() },
          update: {
            name: `${adminUser.firstName} ${adminUser.lastName}`,
            phone: adminUser.phone ?? null,
            passwordHash,
            mustChangePassword: true,
            isActive: true
          },
          create: {
            email: adminUser.email.toLowerCase(),
            name: `${adminUser.firstName} ${adminUser.lastName}`,
            phone: adminUser.phone ?? null,
            passwordHash,
            mustChangePassword: true,
            isActive: true
          }
        });

        await grantTenantAdministrator(tenantClient, user.id);
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
      const loginUrl = `${appUrl}/t/${tenantRecord.tenantCode}/login`;
      await sendWelcomeEmail({
        to: adminUser.email,
        userName: adminUser.firstName,
        tenantName: tenant.name,
        loginUrl,
        temporaryPassword: adminUser.temporaryPassword
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
      url: `${process.env.APP_BASE_URL ?? "http://localhost:3001"}/t/${tenantRecord.tenantCode}/login`
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
