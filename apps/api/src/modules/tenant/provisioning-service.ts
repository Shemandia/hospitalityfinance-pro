import { PrismaClient } from "../../db/client.js";
import { registryPrisma } from "../../db/prisma.js";
import { generateTenantCode } from "../../db/generateTenantCode.js";
import { sendWelcomeEmail } from "../../shared/email.js";
import {
  createDatabase,
  migrateDatabase,
  planTenantDatabase,
  secureDatabase,
  tenantUrls
} from "./tenant-database.js";
import { ensureSystemCatalog, grantTenantAdministrator } from "../access/setup.js";
import {
  PROVISIONING_STEPS,
  type ProvisionTenantInput,
  type ProvisioningStepName
} from "./types.js";
import { hashPassword } from "../../services/password-policy.js";
import { appUrl } from "../../config.js";

type SSEWriter = (event: string, data: Record<string, unknown>) => void;

export class ProvisioningService {
  /**
   * Run full provisioning for a new tenant, streaming progress via SSE.
   * Each step updates the database and emits an SSE event.
   */
  async provision(input: ProvisionTenantInput, sse: SSEWriter): Promise<void> {
    const { tenant, entitlements, adminUser } = input;

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

    // The database's location and the two roles' passwords are fixed now, and
    // recorded sealed in the registry, so a retry uses the same ones.
    const tenantCode = await generateTenantCode(tenant.slug);
    const location = planTenantDatabase(tenant.slug, tenantCode);
    const urls = tenantUrls(location);

    // Create tenant record + entitlement + provisioning steps in one transaction
    const tenantRecord = await registryPrisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: tenant.name,
          slug: tenant.slug,
          tenantCode,
          ...location,
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
      // The owner and application roles, then the database, owned by the owner.
      await createDatabase(location);
    });

    await this.executeStep(tenantRecord.id, "running_migrations", sse, async () => {
      // The tenant baseline and every later migration, as the owner, recorded
      // in the database's own history (ARC-03). Security functions, policies,
      // constraints and the system user come with the migrations.
      const schemaVersion = await migrateDatabase(location);
      await registryPrisma.tenant.update({
        where: { id: tenantRecord.id },
        data: { schemaVersion }
      });
    });

    await this.executeStep(tenantRecord.id, "applying_security", sse, async () => {
      // The application role's data rights; then refuse to go on, rather than
      // create users, if a policy is missing or the role can do more.
      await secureDatabase(location);
    });

    await this.executeStep(tenantRecord.id, "creating_auth", sse, async () => {
      const tenantClient = new PrismaClient({ datasourceUrl: urls.app });
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
      const tenantClient = new PrismaClient({ datasourceUrl: urls.app });
      try {
        // Keyed by slug: the setup service and the access context read it so.
        await tenantClient.tenantSetupProgress.create({
          data: {
            tenantId: tenant.slug,
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
