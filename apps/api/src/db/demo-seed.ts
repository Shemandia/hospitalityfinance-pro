import { PrismaClient, Prisma } from "./client.js";
const prisma = new PrismaClient();

const ENTITY = "00000000-0000-0000-0000-000000000002";
const ADMIN_USER = "a15c0667-e920-4e66-8b15-e1a561b965c4";

async function main() {
  const period = await prisma.period.findFirst({ where: { entityId: ENTITY, status: "OPEN" } });
  if (!period) {
    console.error("No open period");
    return;
  }

  const accts = await prisma.account.findMany({ where: { entityId: ENTITY } });
  const byCode = (c: string) => accts.find((a) => a.code === c)!;

  // Revenue journal: Cash DR 335k | Rooms Revenue CR 250k | F&B Revenue CR 85k
  await prisma.journal.upsert({
    where: { id: "demo-rev-001-0000-0000-000000000001" },
    update: {},
    create: {
      id: "demo-rev-001-0000-0000-000000000001",
      entityId: ENTITY,
      periodId: period.id,
      reference: "JV-REV-001",
      description: "March Revenue",
      source: "PMS",
      status: "POSTED",
      functionalCurrency: "AED",
      postedAt: new Date(),
      createdById: ADMIN_USER,
      lines: {
        create: [
          {
            lineNumber: 1,
            accountId: byCode("1000").id,
            debit: 335000,
            credit: 0,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 335000,
            creditFunctional: 0
          },
          {
            lineNumber: 2,
            accountId: byCode("4100").id,
            debit: 0,
            credit: 250000,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 0,
            creditFunctional: 250000
          },
          {
            lineNumber: 3,
            accountId: byCode("4200").id,
            debit: 0,
            credit: 85000,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 0,
            creditFunctional: 85000
          }
        ]
      }
    }
  });

  // Expense journal: Payroll/Costs DR | AP Control CR
  await prisma.journal.upsert({
    where: { id: "demo-exp-001-0000-0000-000000000002" },
    update: {},
    create: {
      id: "demo-exp-001-0000-0000-000000000002",
      entityId: ENTITY,
      periodId: period.id,
      reference: "JV-EXP-001",
      description: "March Expenses",
      source: "PAYROLL",
      status: "POSTED",
      functionalCurrency: "AED",
      postedAt: new Date(),
      createdById: ADMIN_USER,
      lines: {
        create: [
          {
            lineNumber: 1,
            accountId: byCode("5100").id,
            debit: 45000,
            credit: 0,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 45000,
            creditFunctional: 0
          },
          {
            lineNumber: 2,
            accountId: byCode("5200").id,
            debit: 32000,
            credit: 0,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 32000,
            creditFunctional: 0
          },
          {
            lineNumber: 3,
            accountId: byCode("5300").id,
            debit: 28000,
            credit: 0,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 28000,
            creditFunctional: 0
          },
          {
            lineNumber: 4,
            accountId: byCode("5400").id,
            debit: 18000,
            credit: 0,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 18000,
            creditFunctional: 0
          },
          {
            lineNumber: 5,
            accountId: byCode("2000").id,
            debit: 0,
            credit: 123000,
            currency: "AED",
            fxRate: 1,
            debitFunctional: 0,
            creditFunctional: 123000
          }
        ]
      }
    }
  });

  // AccountPeriodBalance — update balances
  const upsertBalance = (accountId: string, debits: number, credits: number) =>
    prisma.accountPeriodBalance.upsert({
      where: { entityId_accountId_periodId: { entityId: ENTITY, accountId, periodId: period.id } },
      update: { periodDebits: debits, periodCredits: credits, closingBalance: credits - debits },
      create: {
        entityId: ENTITY,
        accountId,
        periodId: period.id,
        openingBalance: 0,
        periodDebits: debits,
        periodCredits: credits,
        closingBalance: credits - debits
      }
    });

  await Promise.all([
    upsertBalance(byCode("1000").id, 335000, 0),
    upsertBalance(byCode("2000").id, 0, 123000),
    upsertBalance(byCode("3000").id, 0, 212000),
    upsertBalance(byCode("4100").id, 0, 250000),
    upsertBalance(byCode("4200").id, 0, 85000),
    upsertBalance(byCode("5100").id, 45000, 0),
    upsertBalance(byCode("5200").id, 32000, 0),
    upsertBalance(byCode("5300").id, 28000, 0),
    upsertBalance(byCode("5400").id, 18000, 0)
  ]);

  // PMS stats: 280 available, 224 occupied (80%) for all March days
  for (let d = 1; d <= 31; d++) {
    const statDate = new Date(2026, 2, d);
    await prisma.pMSStatistic.upsert({
      where: { entityId_statDate: { entityId: ENTITY, statDate } },
      update: { availableRooms: 280, occupiedRooms: 224 },
      create: {
        entityId: ENTITY,
        statDate,
        availableRooms: 280,
        occupiedRooms: 224,
        source: "DEMO"
      }
    });
  }

  console.log("Demo data seeded successfully.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e.message);
    prisma.$disconnect();
    process.exit(1);
  });
