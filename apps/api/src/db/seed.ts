import crypto from "node:crypto";
import { Prisma, PrismaClient } from "./client.js";
import { PrismaClient as RegistryPrismaClient } from "./registry-client.js";
import { USALI_ACCOUNTS, SYSTEM_ACCOUNT_TYPES } from "../modules/setup/usali-template.js";
import { seedTransferDeskSystemData } from "./seed-transfer-desk.js";

const prisma = new PrismaClient();
const registryPrisma = new RegistryPrismaClient({
  datasourceUrl: process.env.REGISTRY_DATABASE_URL ?? process.env.DATABASE_URL
});

async function main(): Promise<void> {
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
    where: { slug: "demo-hotels" },
    update: {},
    create: {
      slug: "demo-hotels",
      name: "HFP Demo Hotels",
      tenantCode: crypto.createHash("sha256").update("demo-hotels").digest("hex").substring(0, 8),
      databaseUrl: process.env.DATABASE_URL ?? "postgresql://hfp:password@localhost:5432/hfp_db",
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

  const admin = await prisma.user.upsert({
    where: { email: "admin@hfp.local" },
    update: {},
    create: {
      email: "admin@hfp.local",
      keycloakId: "kc-admin-001",
      name: "Demo Admin"
    }
  });

  const controller = await prisma.user.upsert({
    where: { email: "controller@hfp.local" },
    update: {},
    create: {
      email: "controller@hfp.local",
      keycloakId: "kc-controller-001",
      name: "Demo Controller"
    }
  });

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@hfp.local" },
    update: {},
    create: {
      email: "viewer@hfp.local",
      keycloakId: "kc-viewer-001",
      name: "Demo Viewer"
    }
  });

  await prisma.entityUser.upsert({
    where: { entityId_userId: { entityId: group.id, userId: admin.id } },
    update: { role: "SUPERADMIN" },
    create: { entityId: group.id, userId: admin.id, role: "SUPERADMIN" }
  });

  await prisma.entityUser.upsert({
    where: {
      entityId_userId: { entityId: propertyA.id, userId: controller.id }
    },
    update: { role: "CONTROLLER" },
    create: {
      entityId: propertyA.id,
      userId: controller.id,
      role: "CONTROLLER"
    }
  });

  await prisma.entityUser.upsert({
    where: { entityId_userId: { entityId: propertyB.id, userId: viewer.id } },
    update: { role: "VIEWER" },
    create: { entityId: propertyB.id, userId: viewer.id, role: "VIEWER" }
  });

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

  const SYSTEM_PERMISSIONS: Array<{ code: string; description: string; category: string }> = [
    // GL & Journals
    {
      code: "GL_READ",
      description: "View chart of accounts, journals, trial balance",
      category: "General Ledger"
    },
    {
      code: "GL_WRITE",
      description: "Create and edit journals, accounts",
      category: "General Ledger"
    },
    { code: "GL_POST", description: "Post journals", category: "General Ledger" },
    { code: "GL_REVERSE", description: "Reverse posted journals", category: "General Ledger" },
    { code: "GL_APPROVE", description: "Approve journal entries", category: "General Ledger" },
    // Chart of Accounts
    { code: "COA_READ", description: "View chart of accounts", category: "Chart of Accounts" },
    { code: "COA_CREATE", description: "Create new accounts", category: "Chart of Accounts" },
    { code: "COA_EDIT", description: "Edit existing accounts", category: "Chart of Accounts" },
    // Accounts Payable
    {
      code: "AP_READ",
      description: "View suppliers, invoices, payment runs",
      category: "Accounts Payable"
    },
    {
      code: "AP_WRITE",
      description: "Create invoices, manage suppliers",
      category: "Accounts Payable"
    },
    { code: "AP_APPROVE", description: "Approve AP invoices", category: "Accounts Payable" },
    {
      code: "AP_PAYMENT_CONFIRM",
      description: "Confirm and process payment runs",
      category: "Accounts Payable"
    },
    // Payment Runs
    { code: "PAYMENT_RUN_READ", description: "View payment runs", category: "Payment Runs" },
    { code: "PAYMENT_RUN_CREATE", description: "Create payment runs", category: "Payment Runs" },
    { code: "PAYMENT_RUN_APPROVE", description: "Approve payment runs", category: "Payment Runs" },
    // Accounts Receivable
    {
      code: "AR_READ",
      description: "View customers, invoices, ageing",
      category: "Accounts Receivable"
    },
    {
      code: "AR_WRITE",
      description: "Create AR invoices, receipts, allocations",
      category: "Accounts Receivable"
    },
    { code: "AR_DUNNING", description: "Run dunning process", category: "Accounts Receivable" },
    // Budget
    {
      code: "BUDGET_READ",
      description: "View budget definitions and variance",
      category: "Budget"
    },
    {
      code: "BUDGET_WRITE",
      description: "Create and edit budgets, import Excel",
      category: "Budget"
    },
    { code: "BUDGET_APPROVE", description: "Approve budgets", category: "Budget" },
    // FX & Currencies
    { code: "FX_READ", description: "View FX rates and currencies", category: "FX & Currencies" },
    {
      code: "FX_WRITE",
      description: "Manage FX rates, run revaluation",
      category: "FX & Currencies"
    },
    // Reporting
    { code: "REPORT_READ", description: "View and download reports", category: "Reporting" },
    {
      code: "REPORT_WRITE",
      description: "Create report definitions, run reports",
      category: "Reporting"
    },
    { code: "REPORT_EXPORT", description: "Export reports to PDF/Excel", category: "Reporting" },
    {
      code: "REPORT_CREATE_CUSTOM",
      description: "Create custom report templates",
      category: "Reporting"
    },
    // Period Management
    { code: "PERIOD_READ", description: "View accounting periods", category: "Period Management" },
    {
      code: "PERIOD_MANAGE",
      description: "Open, close, lock periods",
      category: "Period Management"
    },
    { code: "PERIOD_REOPEN", description: "Reopen locked periods", category: "Period Management" },
    // Transfer Desk
    {
      code: "TRANSFER_DESK_READ",
      description: "View import profiles and execution history",
      category: "Transfer Desk"
    },
    {
      code: "TRANSFER_DESK_EXECUTE",
      description: "Execute import profiles",
      category: "Transfer Desk"
    },
    {
      code: "TRANSFER_DESK_CONFIG",
      description: "Configure profiles, formats, transformations",
      category: "Transfer Desk"
    },
    // Integrations
    {
      code: "INTEGRATION_READ",
      description: "View import logs and connector mappings",
      category: "Integrations"
    },
    {
      code: "INTEGRATION_IMPORT",
      description: "Run PMS/POS/payroll imports",
      category: "Integrations"
    },
    {
      code: "INTEGRATION_CONFIG",
      description: "Configure connectors and mappings",
      category: "Integrations"
    },
    // Intercompany
    {
      code: "IC_READ",
      description: "View intercompany transactions and balances",
      category: "Intercompany"
    },
    {
      code: "IC_CREATE",
      description: "Create intercompany transactions",
      category: "Intercompany"
    },
    {
      code: "IC_APPROVE",
      description: "Approve intercompany transactions",
      category: "Intercompany"
    },
    {
      code: "IC_REVERSE",
      description: "Reverse posted intercompany transactions",
      category: "Intercompany"
    },
    {
      code: "IC_CONFIG",
      description: "Configure IC entity pairs and account mappings",
      category: "Intercompany"
    },
    {
      code: "IC_RECONCILE",
      description: "Run IC reconciliation and create snapshots",
      category: "Intercompany"
    },
    // Consolidation
    {
      code: "CONSOLIDATION_RUN",
      description: "Run multi-entity consolidation",
      category: "Consolidation"
    },
    // Statistics
    { code: "STATS_READ", description: "View operational statistics", category: "Statistics" },
    { code: "STATS_IMPORT", description: "Import statistics from PMS", category: "Statistics" },
    // Audit
    { code: "AUDIT_READ", description: "View audit log", category: "Audit" },
    // User Management
    {
      code: "ADMIN_USERS_READ",
      description: "View users and role assignments",
      category: "User Management"
    },
    {
      code: "ADMIN_USERS",
      description: "Create, edit, and manage users",
      category: "User Management"
    },
    {
      code: "ADMIN_ROLES_MANAGE",
      description: "Create, edit, and delete roles and permissions",
      category: "User Management"
    },
    // System Administration
    {
      code: "ADMIN_SETTINGS",
      description: "Manage entity settings, properties, journal types",
      category: "System Administration"
    },
    {
      code: "ADMIN_ENTITIES",
      description: "Manage entity hierarchy and assignments",
      category: "System Administration"
    },
    {
      code: "ADMIN_AUDIT_LOG",
      description: "Access full system audit log",
      category: "System Administration"
    }
  ];

  const permissionMap = new Map<string, string>();
  for (const perm of SYSTEM_PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { code: perm.code },
      update: { description: perm.description, category: perm.category },
      create: perm
    });
    permissionMap.set(p.code, p.id);
  }

  const SYSTEM_ROLES: Array<{
    code: string;
    name: string;
    description: string;
    isSystem: boolean;
    permissions: string[];
  }> = [
    {
      code: "VIEWER",
      name: "Viewer",
      description: "Read-only access to dashboards, reports, and financial data",
      isSystem: false,
      permissions: [
        "GL_READ",
        "COA_READ",
        "AP_READ",
        "AR_READ",
        "BUDGET_READ",
        "FX_READ",
        "REPORT_READ",
        "PERIOD_READ",
        "AUDIT_READ",
        "INTEGRATION_READ",
        "TRANSFER_DESK_READ",
        "STATS_READ",
        "PAYMENT_RUN_READ",
        "ADMIN_USERS_READ"
      ]
    },
    {
      code: "CONTROLLER",
      name: "Controller",
      description: "Can post journals, approve invoices, close periods, and run reports",
      isSystem: false,
      permissions: [
        "GL_READ",
        "GL_WRITE",
        "GL_POST",
        "GL_APPROVE",
        "COA_READ",
        "COA_CREATE",
        "COA_EDIT",
        "AP_READ",
        "AP_WRITE",
        "AP_APPROVE",
        "PAYMENT_RUN_READ",
        "PAYMENT_RUN_CREATE",
        "AR_READ",
        "AR_WRITE",
        "AR_DUNNING",
        "BUDGET_READ",
        "BUDGET_WRITE",
        "FX_READ",
        "FX_WRITE",
        "REPORT_READ",
        "REPORT_WRITE",
        "REPORT_EXPORT",
        "PERIOD_READ",
        "PERIOD_MANAGE",
        "AUDIT_READ",
        "INTEGRATION_READ",
        "TRANSFER_DESK_READ",
        "TRANSFER_DESK_EXECUTE",
        "STATS_READ",
        "STATS_IMPORT",
        "ADMIN_USERS_READ"
      ]
    },
    {
      code: "ADMIN",
      name: "Administrator",
      description: "Full module access including imports, payment runs, user management",
      isSystem: false,
      permissions: SYSTEM_PERMISSIONS.filter((p) => p.code !== "PERIOD_REOPEN").map((p) => p.code)
    },
    {
      code: "TENANT_ADMIN",
      name: "Tenant Administrator",
      description: "Full system access — manages users, roles, entities, and all modules",
      isSystem: true,
      permissions: SYSTEM_PERMISSIONS.map((p) => p.code)
    }
  ];

  for (const roleDef of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: roleDef.code },
      update: { name: roleDef.name, description: roleDef.description, isSystem: roleDef.isSystem },
      create: {
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem
      }
    });

    // Bind permissions
    for (const permCode of roleDef.permissions) {
      const permId = permissionMap.get(permCode);
      if (!permId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permId } },
        update: {},
        create: { roleId: role.id, permissionId: permId }
      });
    }
  }

  console.log(`Seeded ${SYSTEM_PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} roles.`);

  // ── Transfer Desk System Profiles ──────────────────────────────────────────
  await seedTransferDeskSystemData(prisma);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
