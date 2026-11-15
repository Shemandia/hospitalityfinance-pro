import { PrismaClient } from "../../db/client.js";
import { registryPrisma } from "../../db/prisma.js";
import { generateTenantCode } from "../../db/generateTenantCode.js";
import { sendWelcomeEmail } from "../../shared/email.js";
import { assertTenantSecurity, deployMigrations } from "../../db/migrate.js";
import { ensureSystemCatalog, grantTenantAdministrator } from "../access/setup.js";
import {
  PROVISIONING_STEPS,
  type ProvisionTenantInput,
  type ProvisioningStepName
} from "./types.js";
import { hashPassword } from "../../services/password-policy.js";
import { appUrl, config, registryDatabaseUrl } from "../../config.js";

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
    const registryUrl = registryDatabaseUrl();
    const dbConn = parseDbUrl(registryUrl);
    const settings = config();
    const tenantDbHost = settings.TENANT_DB_HOST ?? dbConn.host;
    const tenantDbPort = settings.TENANT_DB_PORT ?? dbConn.port;
    const tenantDbUser = settings.TENANT_DB_USER ?? dbConn.user;
    const tenantDbPassword = settings.TENANT_DB_PASSWORD ?? dbConn.password;
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
      // The tenant baseline and every later migration, recorded in the
      // database's own migration history (ARC-03). Security functions,
      // policies and constraints are part of the migrations.
      await deployMigrations("tenant", tenantDbUrl);
    });

    await this.executeStep(tenantRecord.id, "applying_security", sse, async () => {
      // The policies came with the migrations; refuse to continue if they are
      // missing, rather than create users in an unprotected database.
      const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
      try {
        await assertTenantSecurity(tenantClient);
      } finally {
        await tenantClient.$disconnect();
      }
    });

    await this.executeStep(tenantRecord.id, "creating_auth", sse, async () => {
      const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
      try {
        // The catalogue and the starting roles, then the first administrator.
        await ensureSystemCatalog(tenantClient);
        const passwordHash = await hashPassword(adminUser.temporaryPassword);
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
      const loginUrl = appUrl(`t/${tenantRecord.tenantCode}/login`);
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
      url: appUrl(`t/${tenantRecord.tenantCode}/login`)
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
