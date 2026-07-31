import { randomUUID } from "crypto";
import { PrismaClient } from "../../db/client.js";
import { prisma, registryPrisma } from "../../db/prisma.js";
import { resolveTenant } from "../../db/tenantRegistry.js";
import { stepSchemas } from "./types.js";
import { USALI_ACCOUNTS, SYSTEM_ACCOUNT_TYPES } from "./usali-template.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

// No longer need RLS_TABLES — bypass is now via session variable, not ALTER TABLE

export class SetupService {
  async getProgress(tenantId: string) {
    let progress = await (prisma as any).tenantSetupProgress.findFirst({
      where: { tenantId }
    });
    if (!progress) {
      progress = await (prisma as any).tenantSetupProgress.create({
        data: {
          tenantId,
          currentStep: 1,
          isCompleted: false,
          stepData: {},
          completedSteps: []
        }
      });
    }

    // Fetch tenant info from registry for pre-filling step 1
    const tenant = await registryPrisma.tenant.findFirst({
      where: { slug: tenantId },
      select: { name: true, adminEmail: true, countryCode: true, maxProperties: true }
    });

    return {
      ...progress,
      tenantInfo: tenant
        ? {
            name: tenant.name,
            adminEmail: tenant.adminEmail,
            countryCode: tenant.countryCode,
            maxProperties: tenant.maxProperties
          }
        : null
    };
  }

  async saveStep(tenantId: string, step: number, data: unknown, saveOnly: boolean) {
    const schema = stepSchemas[step];
    if (!schema) throw new Error(`Invalid step: ${step}`);
    const validated = schema.parse(data);

    const progress = await this.getProgress(tenantId);
    const stepData = (progress.stepData as Record<string, unknown>) ?? {};
    stepData[String(step)] = validated;

    const completedSteps = [...new Set([...(progress.completedSteps as number[]), step])].sort();
    const nextStep = saveOnly ? progress.currentStep : Math.min(step + 1, 7);

    await (prisma as any).tenantSetupProgress.update({
      where: { id: progress.id },
      data: { stepData, completedSteps, currentStep: nextStep }
    });

    return { step, status: "saved" };
  }

  async complete(tenantId: string) {
    const progress = await this.getProgress(tenantId);
    const completed = progress.completedSteps as number[];
    const allDone = [1, 2, 3, 4, 5, 6].every((s) => completed.includes(s));
    if (!allDone) {
      throw new Error("All 6 steps must be completed before finishing setup.");
    }

    // Create a raw PrismaClient connected directly to the tenant DB.
    // The pooled/extended clients have issues with $executeRawUnsafe routing
    // through the Proxy and extension layers, so we use a direct connection.
    const tenant = await resolveTenant(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found in registry.`);
    const db = new PrismaClient({ datasourceUrl: tenant.databaseUrl }) as any;

    const stepData = progress.stepData as Record<string, any>;

    try {
      // Bypass RLS via transaction-local session variable to bootstrap records
      // without entity context. The bypass reverts automatically when the txn ends.
      await db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe("SELECT set_config('app.bypass_rls', 'true', true)");

        // Materialize all step data into actual database records
        await this.materialize(tx, stepData);

        // Validate that essential data was created
        const [{ cnt: entityCount }] = (await tx.$queryRawUnsafe(
          "SELECT count(*)::int as cnt FROM entities"
        )) as { cnt: number }[];
        if (!entityCount) {
          throw new Error("At least one entity (property) must exist before completing setup.");
        }

        const [{ cnt: periodCount }] = (await tx.$queryRawUnsafe(
          "SELECT count(*)::int as cnt FROM periods"
        )) as { cnt: number }[];
        if (!periodCount) {
          throw new Error("At least one fiscal period must exist before completing setup.");
        }

        const [{ cnt: accountCount }] = (await tx.$queryRawUnsafe(
          "SELECT count(*)::int as cnt FROM accounts"
        )) as { cnt: number }[];
        if (!accountCount) {
          throw new Error("A chart of accounts must be imported before completing setup.");
        }
      });
    } finally {
      await db.$disconnect().catch(() => {});
    }

    await (prisma as any).tenantSetupProgress.update({
      where: { id: progress.id },
      data: { isCompleted: true, completedAt: new Date() }
    });

    return { completed: true };
  }

  // ── Materialize step data into database records ──────────────────────────

  private async materialize(db: any, stepData: Record<string, any>) {
    const step1 = stepData["1"];
    const step3 = stepData["3"];
    const step4 = stepData["4"];

    if (!step1) throw new Error("Step 1 (Organization Structure) data is missing.");
    if (!step3) throw new Error("Step 3 (Chart of Accounts) data is missing.");
    if (!step4) throw new Error("Step 4 (Fiscal Periods) data is missing.");

    // ── 1. Create entities ──────────────────────────────────────────────

    const corporateId = randomUUID();
    const corporate = step1.corporate;

    // Upsert corporate group (idempotent by checking existing)
    const existingCorporate = (await db.$queryRawUnsafe(
      `SELECT id FROM entities WHERE type = 'GROUP'::"EntityType" AND code = $1 LIMIT 1`,
      corporate.code
    )) as { id: string }[];

    let actualCorporateId: string;
    if (existingCorporate.length > 0) {
      actualCorporateId = existingCorporate[0].id;
    } else {
      await db.$executeRawUnsafe(
        `INSERT INTO entities (id, name, code, type, country_code, functional_currency, reporting_currency, timezone, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, 'GROUP'::"EntityType", $4, $5, $6, $7, true, NOW(), NOW())`,
        corporateId,
        corporate.name,
        corporate.code,
        corporate.countryCode,
        corporate.functionalCurrency,
        corporate.reportingCurrency,
        corporate.timezone
      );
      actualCorporateId = corporateId;
    }

    // Create property entities
    const propertyIds: string[] = [];
    for (const prop of step1.properties) {
      const existingProp = (await db.$queryRawUnsafe(
        `SELECT id FROM entities WHERE type = 'PROPERTY'::"EntityType" AND code = $1 LIMIT 1`,
        prop.code
      )) as { id: string }[];

      if (existingProp.length > 0) {
        propertyIds.push(existingProp[0].id);
      } else {
        const propId = randomUUID();
        await db.$executeRawUnsafe(
          `INSERT INTO entities (id, name, code, type, country_code, functional_currency, reporting_currency, timezone, is_active, parent_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'PROPERTY'::"EntityType", $4, $5, $6, $7, true, $8, NOW(), NOW())`,
          propId,
          prop.name,
          prop.code,
          prop.countryCode,
          prop.currency || corporate.functionalCurrency,
          corporate.reportingCurrency,
          prop.timezone || corporate.timezone,
          actualCorporateId
        );
        propertyIds.push(propId);
      }
    }

    // ── 2. Seed account type definitions ────────────────────────────────

    const typeDefMap = new Map<string, string>();
    for (const atd of SYSTEM_ACCOUNT_TYPES) {
      const existing = await db.accountTypeDefinition.findFirst({
        where: { code: atd.code, entityId: null }
      });
      if (existing) {
        typeDefMap.set(atd.code, existing.id);
      } else {
        const row = await db.accountTypeDefinition.create({
          data: {
            id: atd.id,
            code: atd.code,
            name: atd.name,
            category: atd.category,
            normalBalance: atd.normalBalance,
            isSystem: true,
            sortOrder: atd.sortOrder
          }
        });
        typeDefMap.set(atd.code, row.id);
      }
    }

    // ── 3. Create accounts (USALI template) ─────────────────────────────

    if (step3.importMethod === "usali_template") {
      for (const entityId of propertyIds) {
        const byCode = new Map<string, string>();

        for (const account of USALI_ACCOUNTS) {
          const existing = (await db.$queryRawUnsafe(
            `SELECT id FROM accounts WHERE entity_id = $1 AND code = $2 LIMIT 1`,
            entityId,
            account.code
          )) as { id: string }[];

          if (existing.length > 0) {
            byCode.set(account.code, existing[0].id);
            continue;
          }

          const accountId = randomUUID();
          const parentId = account.parentCode ? (byCode.get(account.parentCode) ?? null) : null;

          await db.$executeRawUnsafe(
            `INSERT INTO accounts (id, entity_id, code, name, type, account_type_def_id, normal_balance, usali_category, usali_department, level, allow_posting, parent_id, is_active, is_control_account, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::"NormalBalance", $8, $9, $10, $11, $12, true, $13, NOW(), NOW())`,
            accountId,
            entityId,
            account.code,
            account.name,
            account.type,
            typeDefMap.get(account.type) ?? null,
            account.normalBalance,
            account.usaliCategory ?? null,
            account.usaliDepartment ?? null,
            account.level,
            account.allowPosting,
            parentId,
            !account.allowPosting // control accounts = non-posting
          );

          byCode.set(account.code, accountId);
        }
      }
    }
    // "upload" and "blank" methods don't create accounts during setup

    // ── 4. Create fiscal periods ────────────────────────────────────────

    const { fiscalYearStartMonth, years } = step4;

    for (const entityId of propertyIds) {
      for (const year of years) {
        for (let i = 0; i < 12; i++) {
          const month = ((fiscalYearStartMonth - 1 + i) % 12) + 1;
          const calendarYear = month < fiscalYearStartMonth ? year + 1 : year;
          const name = `${MONTH_NAMES[month - 1]} ${calendarYear}`;

          // Skip if period already exists
          const existingPeriod = (await db.$queryRawUnsafe(
            `SELECT id FROM periods WHERE entity_id = $1 AND year = $2 AND month = $3 LIMIT 1`,
            entityId,
            calendarYear,
            month
          )) as { id: string }[];

          if (existingPeriod.length > 0) continue;

          await db.$executeRawUnsafe(
            `INSERT INTO periods (id, entity_id, year, month, name, status, opened_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'OPEN'::"PeriodStatus", NOW(), NOW(), NOW())`,
            randomUUID(),
            entityId,
            calendarYear,
            month,
            name
          );
        }
      }
    }
  }
}
