import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const group = await prisma.entity.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "HFP Demo Group",
      type: "GROUP",
      functionalCurrency: "USD",
      timezone: "UTC",
      countryCode: "AE"
    }
  });

  const propertyA = await prisma.entity.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "HFP Demo Resort - Jumeirah",
      type: "PROPERTY",
      parentId: group.id,
      functionalCurrency: "AED",
      timezone: "Asia/Dubai",
      countryCode: "AE"
    }
  });

  const propertyB = await prisma.entity.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      name: "HFP Demo City Hotel - Doha",
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
          sections: [
            "Revenue",
            "Departmental Expenses",
            "GOP",
            "Undistributed Expenses",
            "EBITDA"
          ]
        }
      },
      create: {
        entityId,
        name: "USALI Departmental P&L",
        type: "USALI_PL",
        isSystem: true,
        template: {
          report: "USALI_PL",
          sections: [
            "Revenue",
            "Departmental Expenses",
            "GOP",
            "Undistributed Expenses",
            "EBITDA"
          ]
        }
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
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
