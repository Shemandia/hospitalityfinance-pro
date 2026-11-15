import crypto from "node:crypto";
import { Prisma, PrismaClient } from "./client.js";
import { PrismaClient as RegistryPrismaClient } from "./registry-client.js";
import { USALI_ACCOUNTS, SYSTEM_ACCOUNT_TYPES } from "../modules/setup/usali-template.js";
import { seedTransferDeskSystemData } from "./seed-transfer-desk.js";
import { hashPassword, passwordPolicyErrors } from "../services/password-policy.js";
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES } from "../modules/access/system-catalog.js";
import {
  applyAccessMigration,
  ensureSystemCatalog,
  grantRoleAtEntity,
  grantTenantAdministrator
} from "../modules/access/setup.js";
import { config, registryDatabaseUrl, requireConfig } from "../config.js";

// Demo data and demo users with a known password. Never on a live system:
// production tenants get their roles and permissions from tenant provisioning.
if (config().NODE_ENV === "production") {
  throw new Error("The demo seed does not run with NODE_ENV=production.");
}

// DATABASE_URL is the demo tenant's database. SEED_USER_PASSWORD becomes the
// demo users' password: never a value in the code, and it must meet the same
// rules as any password a user sets.
const { DATABASE_URL: databaseUrl, SEED_USER_PASSWORD: seedPassword } = requireConfig(
  ["DATABASE_URL", "SEED_USER_PASSWORD"],
  "the seed"
);
const passwordProblems = passwordPolicyErrors(seedPassword);
if (passwordProblems.length > 0) {
  throw new Error(
    `SEED_USER_PASSWORD does not meet the password rules: ${passwordProblems.join("; ")}.`
  );
}

// The seed writes rows for several entities and rows that belong to none, so
// it runs with the row-level security bypass set for its whole session. One
// connection only: a session setting lives on the connection that set it.
const seedUrl = new URL(databaseUrl);
seedUrl.searchParams.set("connection_limit", "1");
const prisma = new PrismaClient({ datasourceUrl: seedUrl.toString() });
const registryPrisma = new RegistryPrismaClient({
  datasourceUrl: registryDatabaseUrl()
});

const DEMO_TENANT_SLUG = "demo-hotels";

/**
 * A demo user who can sign in. A new user gets SEED_USER_PASSWORD. A user who
 * already has a password keeps it: running the seed again never resets a
 * password someone has changed.
 */
async function seedUser(email: string, keycloakId: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash) {
    console.log(`${email}: exists with a password; password kept.`);
    return existing;
  }
  const passwordHash = await hashPassword(seedPassword);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    create: {
      email,
      keycloakId,
      name,
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false
    }
  });
  console.log(`${email}: password set from SEED_USER_PASSWORD.`);
  return user;
}

async function main(): Promise<void> {
  await prisma.$executeRaw`SELECT set_config('app.bypass_rls', 'true', false)`;
  // Idempotent; also makes the seed usable on a database built with `db push`.
  await applyAccessMigration(prisma);

  // ── System Account Type Definitions ──────────────────────────────────────
  const typeDefMap = new Map<string, string>();
  for (const atd of SYSTEM_ACCOUNT_TYPES) {
    // System types have null entityId — use findFirst + create/update instead of upsert
    // since Prisma doesn't support null in composite unique constraints for upsert
    const existing = await prisma.accountTypeDefinition.findFirst({
      where: { code: atd.code, entityId: null }
    });
    let row;
    if (existing) {
      row = await prisma.accountTypeDefinition.update({
        where: { id: existing.id },
        data: {
          name: atd.name,
          category: atd.category,
          normalBalance: atd.normalBalance,
          sortOrder: atd.sortOrder
        }
      });
    } else {
      row = await prisma.accountTypeDefinition.create({
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
    }
    typeDefMap.set(atd.code, row.id);
  }
  console.log(`Seeded ${SYSTEM_ACCOUNT_TYPES.length} system account type definitions.`);

  // ── Demo Tenant ─────────────────────────────────────────────────────────
  await registryPrisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: {},
    create: {
      slug: DEMO_TENANT_SLUG,
      name: "HFP Demo Hotels",
      tenantCode: crypto
        .createHash("sha256")
        .update(DEMO_TENANT_SLUG)
        .digest("hex")
        .substring(0, 8),
      databaseUrl,
      adminEmail: "admin@hfp.local",
      plan: "enterprise",
      maxProperties: 10,
      isActive: true,
      provisionedAt: new Date()
    }
  });
  console.log("Seeded demo-hotels tenant.");

  const group = await (prisma.entity as any).upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: { maxProperties: 10 },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "HFP Demo Group",
      code: "HFP",
      type: "GROUP",
      functionalCurrency: "USD",
      timezone: "UTC",
      countryCode: "AE",
      maxProperties: 10 // Licensed for 10 properties
    }
  });

  const propertyA = await (prisma.entity as any).upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: { code: "JUM" },
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "HFP Demo Resort - Jumeirah",
      code: "JUM",
      type: "PROPERTY",
      parentId: group.id,
      functionalCurrency: "AED",
      timezone: "Asia/Dubai",
      countryCode: "AE"
    }
  });

  const propertyB = await (prisma.entity as any).upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: { code: "DOH" },
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      name: "HFP Demo City Hotel - Doha",
      code: "DOH",
      type: "PROPERTY",
      parentId: group.id,
      functionalCurrency: "QAR",
      timezone: "Asia/Qatar",
      countryCode: "QA"
    }
  });

  const admin = await seedUser("admin@hfp.local", "kc-admin-001", "Demo Admin");
  const controller = await seedUser("controller@hfp.local", "kc-controller-001", "Demo Controller");
  const viewer = await seedUser("viewer@hfp.local", "kc-viewer-001", "Demo Viewer");

  for (const entityId of [propertyA.id, propertyB.id]) {
    await prisma.supplier.upsert({
      where: {
        entityId_code: {
          entityId,
          code: "SUP-001"
        }
      },
      update: {
        name: "Demo Hospitality Supplies",
        taxId: "TAX-DEMO-001",
        currency: "USD",
        paymentTermsDays: 30,
        bankDetails: {
          bankName: "Demo Bank",
          accountNumber: "000123456789",
          swift: "DEMOBANKXXX"
        },
        isActive: true
      },
      create: {
        entityId,
        name: "Demo Hospitality Supplies",
        code: "SUP-001",
        taxId: "TAX-DEMO-001",
        currency: "USD",
        paymentTermsDays: 30,
        bankDetails: {
          bankName: "Demo Bank",
          accountNumber: "000123456789",
          swift: "DEMOBANKXXX"
        },
        isActive: true
      }
    });
  }

  for (const entityId of [propertyA.id, propertyB.id]) {
    const existingRule = await prisma.approvalRule.findFirst({
      where: {
        entityId,
        module: "GL",
        minAmount: new Prisma.Decimal("5000.0000"),
        maxAmount: null
      }
    });

    if (existingRule) {
      await prisma.approvalRule.update({
        where: { id: existingRule.id },
        data: {
          requiredApprovers: [admin.id, controller.id],
          requireAll: true,
          isActive: true
        }
      });
    } else {
      await prisma.approvalRule.create({
        data: {
          entityId,
          module: "GL",
          minAmount: new Prisma.Decimal("5000.0000"),
          maxAmount: null,
          requiredApprovers: [admin.id, controller.id],
          requireAll: true,
          isActive: true
        }
      });
    }
  }

  // ── Default Journal Types ───────────────────────────────────────────────
  const defaultJournalTypes = [
    {
      code: "RV",
      name: "Revenue Journal",
      numberPrefix: "RV",
      allowedSources: ["PMS", "POS"],
      allowedAccountTypes: ["REVENUE", "ASSET"],
      autoReverse: false,
      requireBalance: true
    },
    {
      code: "AP",
      name: "Payables Journal",
      numberPrefix: "AP",
      allowedSources: ["AP"],
      allowedAccountTypes: ["EXPENSE", "LIABILITY"],
      autoReverse: false,
      requireBalance: true
    },
    {
      code: "PR",
      name: "Payroll Journal",
      numberPrefix: "PR",
      allowedSources: ["PAYROLL"],
      allowedAccountTypes: ["EXPENSE", "LIABILITY"],
      autoReverse: false,
      requireBalance: true
    },
    {
      code: "GJ",
      name: "General Journal",
      numberPrefix: "GJ",
      allowedSources: [],
      allowedAccountTypes: [],
      autoReverse: false,
      requireBalance: true
    },
    {
      code: "RJ",
      name: "Recurring Journal",
      numberPrefix: "RJ",
      allowedSources: ["MANUAL"],
      allowedAccountTypes: [],
      autoReverse: false,
      requireBalance: true
    },
    {
      code: "AJ",
      name: "Accrual / Reversing",
      numberPrefix: "AJ",
      allowedSources: ["MANUAL"],
      allowedAccountTypes: [],
      autoReverse: true,
      requireBalance: true
    },
    {
      code: "IC",
      name: "Intercompany Journal",
      numberPrefix: "IC",
      allowedSources: ["MANUAL"],
      allowedAccountTypes: [],
      autoReverse: false,
      requireBalance: true
    },
    {
      code: "FX",
      name: "FX Revaluation",
      numberPrefix: "FX",
      allowedSources: ["FX_REVAL"],
      allowedAccountTypes: ["ASSET", "LIABILITY", "EQUITY"],
      autoReverse: true,
      requireBalance: true
    },
    {
      code: "ST",
      name: "Statistical Journal",
      numberPrefix: "ST",
      allowedSources: ["PMS"],
      allowedAccountTypes: [],
      autoReverse: false,
      requireBalance: false
    }
  ];

  for (const entityId of [propertyA.id, propertyB.id]) {
    for (const jt of defaultJournalTypes) {
      await (prisma as any).journalType.upsert({
        where: { entityId_code: { entityId, code: jt.code } },
        update: { name: jt.name },
        create: { entityId, ...jt, isActive: true }
      });
    }
  }

  for (const entityId of [propertyA.id, propertyB.id]) {
    await prisma.reportDefinition.upsert({
      where: {
        entityId_name: {
          entityId,
          name: "USALI Departmental P&L"
        }
      },
      update: {
        type: "USALI_PL",
        isSystem: true,
        template: {
          report: "USALI_PL",
          sections: ["Revenue", "Departmental Expenses", "GOP", "Undistributed Expenses", "EBITDA"]
        }
      },
      create: {
        entityId,
        name: "USALI Departmental P&L",
        type: "USALI_PL",
        isSystem: true,
        template: {
          report: "USALI_PL",
          sections: ["Revenue", "Departmental Expenses", "GOP", "Undistributed Expenses", "EBITDA"]
        }
      }
    });

    // Balance Sheet
    await prisma.reportDefinition.upsert({
      where: { entityId_name: { entityId, name: "Balance Sheet" } },
      update: {
        type: "BALANCE_SHEET",
        isSystem: true,
        template: { report: "BALANCE_SHEET", sections: ["Assets", "Liabilities", "Equity"] }
      },
      create: {
        entityId,
        name: "Balance Sheet",
        type: "BALANCE_SHEET",
        isSystem: true,
        template: { report: "BALANCE_SHEET", sections: ["Assets", "Liabilities", "Equity"] }
      }
    });

    // Cash Flow Statement
    await prisma.reportDefinition.upsert({
      where: { entityId_name: { entityId, name: "Cash Flow Statement" } },
      update: {
        type: "CASHFLOW",
        isSystem: true,
        template: { report: "CASHFLOW", sections: ["Operating", "Investing", "Financing"] }
      },
      create: {
        entityId,
        name: "Cash Flow Statement",
        type: "CASHFLOW",
        isSystem: true,
        template: { report: "CASHFLOW", sections: ["Operating", "Investing", "Financing"] }
      }
    });

    // Trial Balance
    await prisma.reportDefinition.upsert({
      where: { entityId_name: { entityId, name: "Trial Balance" } },
      update: {
        type: "TRIAL_BALANCE",
        isSystem: true,
        template: { report: "TRIAL_BALANCE", sections: ["All Accounts"] }
      },
      create: {
        entityId,
        name: "Trial Balance",
        type: "TRIAL_BALANCE",
        isSystem: true,
        template: { report: "TRIAL_BALANCE", sections: ["All Accounts"] }
      }
    });
  }

  const openPeriodName = "Mar 2026";

  await prisma.period.upsert({
    where: { entityId_year_month: { entityId: propertyA.id, year: 2026, month: 3 } },
    update: { status: "OPEN", name: openPeriodName },
    create: {
      entityId: propertyA.id,
      year: 2026,
      month: 3,
      name: openPeriodName,
      status: "OPEN",
      openedAt: new Date("2026-03-01T00:00:00.000Z")
    }
  });

  await prisma.period.upsert({
    where: { entityId_year_month: { entityId: propertyB.id, year: 2026, month: 3 } },
    update: { status: "OPEN", name: openPeriodName },
    create: {
      entityId: propertyB.id,
      year: 2026,
      month: 3,
      name: openPeriodName,
      status: "OPEN",
      openedAt: new Date("2026-03-01T00:00:00.000Z")
    }
  });

  for (const entityId of [propertyA.id, propertyB.id]) {
    const byCode = new Map<string, string>();

    for (const account of USALI_ACCOUNTS) {
      const existing = await prisma.account.findUnique({
        where: { entityId_code: { entityId, code: account.code } }
      });

      const upserted = await prisma.account.upsert({
        where: { entityId_code: { entityId, code: account.code } },
        update: {
          name: account.name,
          type: account.type,
          accountTypeDefId: typeDefMap.get(account.type),
          normalBalance: account.normalBalance,
          usaliCategory: account.usaliCategory,
          usaliDepartment: account.usaliDepartment,
          level: account.level,
          allowPosting: account.allowPosting,
          parentId: account.parentCode ? byCode.get(account.parentCode) : null
        },
        create: {
          entityId,
          code: account.code,
          name: account.name,
          type: account.type,
          accountTypeDefId: typeDefMap.get(account.type),
          normalBalance: account.normalBalance,
          usaliCategory: account.usaliCategory,
          usaliDepartment: account.usaliDepartment,
          level: account.level,
          allowPosting: account.allowPosting,
          parentId: account.parentCode ? byCode.get(account.parentCode) : null
        }
      });

      byCode.set(account.code, upserted.id);

      if (existing && account.parentCode) {
        const parentId = byCode.get(account.parentCode);
        if (parentId && existing.parentId !== parentId) {
          await prisma.account.update({
            where: { id: existing.id },
            data: { parentId }
          });
        }
      }
    }
  }
  // ── Seed System Roles & Permissions ──────────────────────────────────────

  await ensureSystemCatalog(prisma);
  console.log(`Seeded ${SYSTEM_PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} roles.`);

  // ── Who holds which role where ───────────────────────────────────────────
  // After the roles exist. The administrator is tenant-wide; the controller
  // and the viewer each hold their role on one property.
  await grantTenantAdministrator(prisma, admin.id);
  await grantRoleAtEntity(prisma, controller.id, "CONTROLLER", propertyA.id);
  await grantRoleAtEntity(prisma, viewer.id, "VIEWER", propertyB.id);
  console.log("Seeded role grants for the demo users.");

  // ── Transfer Desk System Profiles ──────────────────────────────────────────
  await seedTransferDeskSystemData(prisma);

  // ── Setup wizard ─────────────────────────────────────────────────────────
  // The seed has created what the wizard would: properties, a chart of
  // accounts and an open period. Mark the tenant set up, so sign-in goes to
  // the dashboard rather than the wizard.
  const progress = await prisma.tenantSetupProgress.findFirst({
    where: { tenantId: DEMO_TENANT_SLUG }
  });
  if (!progress) {
    await prisma.tenantSetupProgress.create({
      data: {
        tenantId: DEMO_TENANT_SLUG,
        currentStep: 7,
        isCompleted: true,
        completedSteps: [1, 2, 3, 4, 5, 6],
        completedAt: new Date()
      }
    });
  } else if (!progress.isCompleted) {
    await prisma.tenantSetupProgress.update({
      where: { id: progress.id },
      data: {
        currentStep: 7,
        isCompleted: true,
        completedSteps: [1, 2, 3, 4, 5, 6],
        completedAt: new Date()
      }
    });
  }
  console.log("Marked the demo tenant's setup complete.");
}

main()
  .then(async () => {
    await Promise.all([prisma.$disconnect(), registryPrisma.$disconnect()]);
  })
  .catch(async (error) => {
    console.error(error);
    await Promise.all([prisma.$disconnect(), registryPrisma.$disconnect()]);
    process.exit(1);
  });
