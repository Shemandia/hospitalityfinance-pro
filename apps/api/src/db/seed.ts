import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
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

  const usaliAccounts: Array<{
    code: string;
    name: string;
    type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
    normalBalance: "DEBIT" | "CREDIT";
    usaliCategory?: string;
    usaliDepartment?: string;
    parentCode?: string;
    level: number;
    allowPosting: boolean;
  }> = [
    {
      code: "1000",
      name: "Cash and Cash Equivalents",
      type: "ASSET",
      normalBalance: "DEBIT",
      usaliCategory: "Current Assets",
      level: 1,
      allowPosting: true
    },
    {
      code: "2000",
      name: "Accounts Payable Control",
      type: "LIABILITY",
      normalBalance: "CREDIT",
      usaliCategory: "Current Liabilities",
      level: 1,
      allowPosting: true
    },
    {
      code: "3000",
      name: "Retained Earnings",
      type: "EQUITY",
      normalBalance: "CREDIT",
      usaliCategory: "Equity",
      level: 1,
      allowPosting: true
    },
    {
      code: "4000",
      name: "Total Revenue",
      type: "REVENUE",
      normalBalance: "CREDIT",
      usaliCategory: "Revenue",
      level: 1,
      allowPosting: false
    },
    {
      code: "4100",
      name: "Rooms Revenue",
      type: "REVENUE",
      normalBalance: "CREDIT",
      usaliCategory: "Revenue",
      usaliDepartment: "Rooms",
      parentCode: "4000",
      level: 2,
      allowPosting: true
    },
    {
      code: "4200",
      name: "Food Revenue",
      type: "REVENUE",
      normalBalance: "CREDIT",
      usaliCategory: "Revenue",
      usaliDepartment: "Food and Beverage",
      parentCode: "4000",
      level: 2,
      allowPosting: true
    },
    {
      code: "4300",
      name: "Beverage Revenue",
      type: "REVENUE",
      normalBalance: "CREDIT",
      usaliCategory: "Revenue",
      usaliDepartment: "Food and Beverage",
      parentCode: "4000",
      level: 2,
      allowPosting: true
    },
    {
      code: "5000",
      name: "Total Departmental Expenses",
      type: "EXPENSE",
      normalBalance: "DEBIT",
      usaliCategory: "Departmental Expenses",
      level: 1,
      allowPosting: false
    },
    {
      code: "5100",
      name: "Rooms Payroll Expense",
      type: "EXPENSE",
      normalBalance: "DEBIT",
      usaliCategory: "Departmental Expenses",
      usaliDepartment: "Rooms",
      parentCode: "5000",
      level: 2,
      allowPosting: true
    },
    {
      code: "5200",
      name: "Food Cost Expense",
      type: "EXPENSE",
      normalBalance: "DEBIT",
      usaliCategory: "Departmental Expenses",
      usaliDepartment: "Food and Beverage",
      parentCode: "5000",
      level: 2,
      allowPosting: true
    },
    {
      code: "5300",
      name: "Admin and General Expense",
      type: "EXPENSE",
      normalBalance: "DEBIT",
      usaliCategory: "Undistributed Expenses",
      usaliDepartment: "Admin and General",
      parentCode: "5000",
      level: 2,
      allowPosting: true
    },
    {
      code: "5400",
      name: "Utilities Expense",
      type: "EXPENSE",
      normalBalance: "DEBIT",
      usaliCategory: "Undistributed Expenses",
      usaliDepartment: "Utilities",
      parentCode: "5000",
      level: 2,
      allowPosting: true
    }
  ];

  for (const entityId of [propertyA.id, propertyB.id]) {
    const byCode = new Map<string, string>();

    for (const account of usaliAccounts) {
      const existing = await prisma.account.findUnique({
        where: { entityId_code: { entityId, code: account.code } }
      });

      const upserted = await prisma.account.upsert({
        where: { entityId_code: { entityId, code: account.code } },
        update: {
          name: account.name,
          type: account.type,
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

  const SYSTEM_PERMISSIONS = [
    { code: "GL_READ", description: "View chart of accounts, journals, trial balance" },
    { code: "GL_WRITE", description: "Create and edit journals, accounts" },
    { code: "GL_POST", description: "Post and approve journals" },
    { code: "GL_REVERSE", description: "Reverse posted journals" },
    { code: "AP_READ", description: "View suppliers, invoices, payment runs" },
    { code: "AP_WRITE", description: "Create invoices, manage suppliers" },
    { code: "AP_APPROVE", description: "Approve AP invoices" },
    { code: "AP_PAYMENT_CONFIRM", description: "Confirm and process payment runs" },
    { code: "AR_READ", description: "View customers, invoices, ageing" },
    { code: "AR_WRITE", description: "Create AR invoices, receipts, allocations" },
    { code: "AR_DUNNING", description: "Run dunning process" },
    { code: "BUDGET_READ", description: "View budget definitions and variance" },
    { code: "BUDGET_WRITE", description: "Create and edit budgets, import Excel" },
    { code: "FX_READ", description: "View FX rates and currencies" },
    { code: "FX_WRITE", description: "Manage FX rates, run revaluation" },
    { code: "REPORT_READ", description: "View and download reports" },
    { code: "REPORT_WRITE", description: "Create report definitions, run reports" },
    { code: "PERIOD_READ", description: "View accounting periods" },
    { code: "PERIOD_MANAGE", description: "Open, close, lock periods" },
    { code: "PERIOD_REOPEN", description: "Reopen locked periods" },
    { code: "INTEGRATION_READ", description: "View import logs and connector mappings" },
    { code: "INTEGRATION_IMPORT", description: "Run PMS/POS/payroll imports" },
    { code: "INTEGRATION_CONFIG", description: "Configure connectors and Transfer Desk" },
    { code: "CONSOLIDATION_RUN", description: "Run multi-entity consolidation" },
    { code: "AUDIT_READ", description: "View audit log" },
    { code: "ADMIN_USERS", description: "Manage entity users and role assignments" },
    { code: "ADMIN_SETTINGS", description: "Manage entity settings, properties, journal types" }
  ];

  const permissionMap = new Map<string, string>();
  for (const perm of SYSTEM_PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { code: perm.code },
      update: { description: perm.description },
      create: perm
    });
    permissionMap.set(p.code, p.id);
  }

  const SYSTEM_ROLES: Array<{
    code: string;
    name: string;
    description: string;
    permissions: string[];
  }> = [
    {
      code: "VIEWER",
      name: "Viewer",
      description: "Read-only access to dashboards, reports, and financial data",
      permissions: [
        "GL_READ",
        "AP_READ",
        "AR_READ",
        "BUDGET_READ",
        "FX_READ",
        "REPORT_READ",
        "PERIOD_READ",
        "AUDIT_READ",
        "INTEGRATION_READ"
      ]
    },
    {
      code: "CONTROLLER",
      name: "Controller",
      description: "Can post journals, approve invoices, close periods, and run reports",
      permissions: [
        "GL_READ",
        "GL_WRITE",
        "GL_POST",
        "AP_READ",
        "AP_WRITE",
        "AP_APPROVE",
        "AR_READ",
        "AR_WRITE",
        "AR_DUNNING",
        "BUDGET_READ",
        "BUDGET_WRITE",
        "FX_READ",
        "FX_WRITE",
        "REPORT_READ",
        "REPORT_WRITE",
        "PERIOD_READ",
        "PERIOD_MANAGE",
        "AUDIT_READ",
        "INTEGRATION_READ"
      ]
    },
    {
      code: "ADMIN",
      name: "Administrator",
      description: "Full module access including imports, payment runs, user management",
      permissions: SYSTEM_PERMISSIONS.filter((p) => p.code !== "PERIOD_REOPEN").map((p) => p.code)
    },
    {
      code: "SUPERADMIN",
      name: "Super Administrator",
      description: "System-wide access including cross-entity operations and period reopen",
      permissions: SYSTEM_PERMISSIONS.map((p) => p.code)
    }
  ];

  for (const roleDef of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: roleDef.code },
      update: { name: roleDef.name, description: roleDef.description },
      create: { code: roleDef.code, name: roleDef.name, description: roleDef.description }
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
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
