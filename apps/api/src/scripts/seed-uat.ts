/**
 * UAT Environment Seed Script
 *
 * Populates a UAT environment with realistic demo data for user acceptance testing.
 * Covers: Entities, Users, COA, Periods, Journals, AP, AR, FX, Budget, PMS Stats.
 *
 * Usage: DATABASE_URL=... npx tsx src/scripts/seed-uat.ts
 */

import { PrismaClient, Prisma } from "../db/client.js";
import { randomUUID } from "node:crypto";
import {
  applyAccessMigration,
  ensureSystemCatalog,
  grantRoleAtEntity
} from "../modules/access/setup.js";
import { APService } from "../modules/ap/service.js";
import { ARService } from "../modules/ar/service.js";
import { requireConfig } from "../config.js";

// The seed writes rows for several entities, so it runs with the row-level
// security bypass set for its whole session. One connection only: a session
// setting lives on the connection that set it.
const seedUrl = new URL(requireConfig(["DATABASE_URL"], "seed-uat").DATABASE_URL);
seedUrl.searchParams.set("connection_limit", "1");
const prisma = new PrismaClient({ datasourceUrl: seedUrl.toString() });

/** Tax code used on the seeded supplier invoices. */
const UAT_TAX_CODE = "VAT5";

// ── Fixed IDs (match dev-mode auth) ────────────────────────────────────────

const GROUP_ID = "00000000-0000-0000-0000-000000000001";
const PROP_A_ID = "00000000-0000-0000-0000-000000000002"; // Jumeirah Beach Resort
const PROP_B_ID = "00000000-0000-0000-0000-000000000003"; // Doha Corniche Hotel
const ADMIN_USER_ID = "a15c0667-e920-4e66-8b15-e1a561b965c4";

async function main() {
  console.log("=== HospitalityFinance Pro — UAT Seed ===\n");
  await prisma.$executeRaw`SELECT set_config('app.bypass_rls', 'true', false)`;
  await applyAccessMigration(prisma);

  // ── 1. Entities ─────────────────────────────────────────────────────────

  console.log("1. Seeding entities...");
  await prisma.entity.upsert({
    where: { id: GROUP_ID },
    update: {},
    create: {
      id: GROUP_ID,
      name: "HFP Demo Group",
      code: "HFP",
      type: "GROUP",
      functionalCurrency: "USD",
      reportingCurrency: "USD",
      timezone: "UTC",
      countryCode: "AE",
      isActive: true
    }
  });

  await prisma.entity.upsert({
    where: { id: PROP_A_ID },
    update: {},
    create: {
      id: PROP_A_ID,
      name: "Jumeirah Beach Resort",
      code: "JBR",
      type: "PROPERTY",
      parentId: GROUP_ID,
      functionalCurrency: "AED",
      reportingCurrency: "USD",
      timezone: "Asia/Dubai",
      countryCode: "AE",
      isActive: true
    }
  });

  await prisma.entity.upsert({
    where: { id: PROP_B_ID },
    update: {},
    create: {
      id: PROP_B_ID,
      name: "Doha Corniche Hotel",
      code: "DCH",
      type: "PROPERTY",
      parentId: GROUP_ID,
      functionalCurrency: "QAR",
      reportingCurrency: "USD",
      timezone: "Asia/Qatar",
      countryCode: "QA",
      isActive: true
    }
  });

  // ── 2. Admin User ───────────────────────────────────────────────────────

  console.log("2. Seeding admin user...");
  await prisma.user.upsert({
    where: { id: ADMIN_USER_ID },
    update: {},
    create: {
      id: ADMIN_USER_ID,
      email: "admin@hfp.local",
      keycloakId: `dev-${ADMIN_USER_ID}`,
      name: "Admin User",
      isActive: true
    }
  });

  // A grant on the group reaches both properties.
  await ensureSystemCatalog(prisma);
  await grantRoleAtEntity(prisma, ADMIN_USER_ID, "ADMIN", GROUP_ID);

  // ── 3. Chart of Accounts (USALI-compliant) ──────────────────────────────

  console.log("3. Seeding chart of accounts...");
  const accounts = [
    // Assets
    {
      code: "1001",
      name: "Cash and Cash Equivalents",
      type: "ASSET",
      nb: "DEBIT",
      dept: null,
      cat: null
    },
    { code: "1010", name: "Petty Cash", type: "ASSET", nb: "DEBIT", dept: null, cat: null },
    {
      code: "1100",
      name: "Accounts Receivable - Trade",
      type: "ASSET",
      nb: "DEBIT",
      dept: null,
      cat: null
    },
    {
      code: "1110",
      name: "Accounts Receivable - City Ledger",
      type: "ASSET",
      nb: "DEBIT",
      dept: null,
      cat: null
    },
    {
      code: "1200",
      name: "Inventory - Food",
      type: "ASSET",
      nb: "DEBIT",
      dept: "Food & Beverage",
      cat: null
    },
    {
      code: "1210",
      name: "Inventory - Beverage",
      type: "ASSET",
      nb: "DEBIT",
      dept: "Food & Beverage",
      cat: null
    },
    { code: "1300", name: "Prepaid Expenses", type: "ASSET", nb: "DEBIT", dept: null, cat: null },
    {
      code: "1500",
      name: "Property and Equipment",
      type: "ASSET",
      nb: "DEBIT",
      dept: null,
      cat: null
    },
    {
      code: "1510",
      name: "Accumulated Depreciation",
      type: "ASSET",
      nb: "CREDIT",
      dept: null,
      cat: null
    },

    // Liabilities
    {
      code: "2001",
      name: "Accounts Payable - Trade",
      type: "LIABILITY",
      nb: "CREDIT",
      dept: null,
      cat: null
    },
    {
      code: "2010",
      name: "Accrued Expenses",
      type: "LIABILITY",
      nb: "CREDIT",
      dept: null,
      cat: null
    },
    {
      code: "2050",
      name: "Guest Deposits",
      type: "LIABILITY",
      nb: "CREDIT",
      dept: "Rooms",
      cat: null
    },
    {
      code: "2100",
      name: "Sales Tax Payable",
      type: "LIABILITY",
      nb: "CREDIT",
      dept: null,
      cat: null
    },
    {
      code: "2200",
      name: "Long-term Debt",
      type: "LIABILITY",
      nb: "CREDIT",
      dept: null,
      cat: null
    },

    // Equity
    { code: "3001", name: "Owner's Equity", type: "EQUITY", nb: "CREDIT", dept: null, cat: null },
    {
      code: "3010",
      name: "Retained Earnings",
      type: "EQUITY",
      nb: "CREDIT",
      dept: null,
      cat: null
    },

    // Revenue - Rooms
    {
      code: "4001",
      name: "Room Revenue - Transient",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Rooms",
      cat: "Revenue"
    },
    {
      code: "4002",
      name: "Room Revenue - Group",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Rooms",
      cat: "Revenue"
    },
    {
      code: "4010",
      name: "Room Revenue - Other",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Rooms",
      cat: "Revenue"
    },

    // Revenue - F&B
    {
      code: "4101",
      name: "Restaurant Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Food & Beverage",
      cat: "Revenue"
    },
    {
      code: "4102",
      name: "Bar Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Food & Beverage",
      cat: "Revenue"
    },
    {
      code: "4103",
      name: "Banquet Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Food & Beverage",
      cat: "Revenue"
    },
    {
      code: "4110",
      name: "Mini Bar Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Food & Beverage",
      cat: "Revenue"
    },

    // Revenue - Other
    {
      code: "4201",
      name: "Spa Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Spa",
      cat: "Revenue"
    },
    {
      code: "4301",
      name: "Parking Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Other Operated",
      cat: "Revenue"
    },
    {
      code: "4401",
      name: "Telephone Revenue",
      type: "REVENUE",
      nb: "CREDIT",
      dept: "Telecom",
      cat: "Revenue"
    },

    // Expenses - Rooms
    {
      code: "5001",
      name: "Rooms - Salaries & Wages",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Rooms",
      cat: "Payroll"
    },
    {
      code: "5010",
      name: "Rooms - Guest Supplies",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Rooms",
      cat: "Other Expense"
    },
    {
      code: "5020",
      name: "Rooms - Linen & Laundry",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Rooms",
      cat: "Other Expense"
    },
    {
      code: "5030",
      name: "Rooms - Commissions",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Rooms",
      cat: "Other Expense"
    },

    // Expenses - F&B
    {
      code: "5101",
      name: "F&B - Cost of Food",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Food & Beverage",
      cat: "Cost of Sales"
    },
    {
      code: "5102",
      name: "F&B - Cost of Beverage",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Food & Beverage",
      cat: "Cost of Sales"
    },
    {
      code: "5110",
      name: "F&B - Salaries & Wages",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Food & Beverage",
      cat: "Payroll"
    },
    {
      code: "5120",
      name: "F&B - Operating Supplies",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Food & Beverage",
      cat: "Other Expense"
    },

    // Undistributed Expenses
    {
      code: "6001",
      name: "Admin & General - Salaries",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Administrative & General",
      cat: "Payroll"
    },
    {
      code: "6010",
      name: "Admin & General - Office Supplies",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Administrative & General",
      cat: "Other Expense"
    },
    {
      code: "6020",
      name: "Admin & General - Professional Fees",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Administrative & General",
      cat: "Other Expense"
    },
    {
      code: "6101",
      name: "Sales & Marketing - Salaries",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Sales & Marketing",
      cat: "Payroll"
    },
    {
      code: "6110",
      name: "Sales & Marketing - Advertising",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Sales & Marketing",
      cat: "Other Expense"
    },
    {
      code: "6201",
      name: "Property Operations - Salaries",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Property Operations",
      cat: "Payroll"
    },
    {
      code: "6210",
      name: "Property Operations - Repairs",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Property Operations",
      cat: "Other Expense"
    },
    {
      code: "6301",
      name: "Utilities - Electricity",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Utilities",
      cat: "Other Expense"
    },
    {
      code: "6310",
      name: "Utilities - Water",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Utilities",
      cat: "Other Expense"
    },

    // Fixed Charges
    {
      code: "7001",
      name: "Management Fees",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Management Fees",
      cat: "Fixed Charges"
    },
    {
      code: "7010",
      name: "Insurance",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Fixed Charges",
      cat: "Fixed Charges"
    },
    {
      code: "7020",
      name: "Property Tax",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Fixed Charges",
      cat: "Fixed Charges"
    },
    {
      code: "7030",
      name: "Depreciation",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Fixed Charges",
      cat: "Fixed Charges"
    },
    {
      code: "7040",
      name: "Interest Expense",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: "Fixed Charges",
      cat: "Fixed Charges"
    },

    // FX
    {
      code: "8001",
      name: "FX Gain / Loss - Realised",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: null,
      cat: null
    },
    {
      code: "8002",
      name: "FX Gain / Loss - Unrealised",
      type: "EXPENSE",
      nb: "DEBIT",
      dept: null,
      cat: null
    }
  ] as const;

  // What the payables and receivables services need from the chart until the
  // unified ledger replaces them (WP-U): the two control accounts flagged, an
  // input-tax account, and revenue account 4100, which the receivables service
  // still names by code.
  const CONTROL_ACCOUNT_CODES = new Set(["1100", "2001"]);
  const serviceAccounts = [
    { code: "1320", name: "Input VAT Recoverable", type: "ASSET", nb: "DEBIT" },
    { code: "4100", name: "City Ledger Revenue", type: "REVENUE", nb: "CREDIT" }
  ] as const;

  for (const entityId of [PROP_A_ID, PROP_B_ID]) {
    for (const a of serviceAccounts) {
      await prisma.account.upsert({
        where: { entityId_code: { entityId, code: a.code } },
        update: {},
        create: {
          entityId,
          code: a.code,
          name: a.name,
          type: a.type,
          normalBalance: a.nb,
          allowPosting: true,
          isActive: true,
          level: 1
        }
      });
    }
    for (const a of accounts) {
      const existing = await prisma.account.findFirst({
        where: { entityId, code: a.code }
      });
      if (!existing) {
        await prisma.account.create({
          data: {
            entityId,
            code: a.code,
            name: a.name,
            type: a.type as any,
            normalBalance: a.nb as any,
            usaliDepartment: a.dept,
            usaliCategory: a.cat,
            isControlAccount: CONTROL_ACCOUNT_CODES.has(a.code),
            allowPosting: true,
            isActive: true,
            level: 1
          }
        });
      } else if (CONTROL_ACCOUNT_CODES.has(a.code) && !existing.isControlAccount) {
        await prisma.account.update({
          where: { id: existing.id },
          data: { isControlAccount: true }
        });
      }
    }
  }

  // ── 4. Currencies & FX Rates ────────────────────────────────────────────

  console.log("4. Seeding currencies & FX rates...");
  const currencies = [
    { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
    { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimalPlaces: 2 },
    { code: "QAR", name: "Qatari Riyal", symbol: "﷼", decimalPlaces: 2 },
    { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
    { code: "GBP", name: "British Pound", symbol: "£", decimalPlaces: 2 }
  ];

  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: {},
      create: c
    });
  }

  const fxRates = [
    { from: "AED", to: "USD", rate: "0.27229408", type: "CLOSING" },
    { from: "AED", to: "USD", rate: "0.27229408", type: "AVERAGE" },
    { from: "QAR", to: "USD", rate: "0.27472527", type: "CLOSING" },
    { from: "QAR", to: "USD", rate: "0.27472527", type: "AVERAGE" },
    { from: "EUR", to: "USD", rate: "1.08500000", type: "CLOSING" },
    { from: "EUR", to: "USD", rate: "1.08200000", type: "AVERAGE" },
    { from: "GBP", to: "USD", rate: "1.26400000", type: "CLOSING" },
    { from: "GBP", to: "USD", rate: "1.26100000", type: "AVERAGE" }
  ];

  for (const r of fxRates) {
    const existing = await prisma.fXRate.findFirst({
      where: {
        fromCurrency: r.from,
        toCurrency: r.to,
        rateType: r.type as any,
        effectiveDate: new Date("2026-03-01")
      }
    });
    if (!existing) {
      await prisma.fXRate.create({
        data: {
          fromCurrency: r.from,
          toCurrency: r.to,
          rate: new Prisma.Decimal(r.rate),
          rateType: r.type as any,
          effectiveDate: new Date("2026-03-01"),
          source: "MANUAL"
        }
      });
    }
  }

  // ── 5. Periods ──────────────────────────────────────────────────────────

  console.log("5. Seeding periods...");
  const months = [
    { year: 2026, month: 1, name: "January 2026", status: "CLOSED" },
    { year: 2026, month: 2, name: "February 2026", status: "CLOSED" },
    { year: 2026, month: 3, name: "March 2026", status: "OPEN" }
  ];

  const periodIds: Record<string, Record<string, string>> = {};

  for (const entityId of [PROP_A_ID, PROP_B_ID]) {
    periodIds[entityId] = {};
    for (const m of months) {
      const existing = await prisma.period.findFirst({
        where: { entityId, year: m.year, month: m.month }
      });
      if (existing) {
        periodIds[entityId][`${m.year}-${m.month}`] = existing.id;
      } else {
        const p = await prisma.period.create({
          data: {
            entityId,
            year: m.year,
            month: m.month,
            name: m.name,
            status: m.status as any,
            openedAt: new Date(`${m.year}-${String(m.month).padStart(2, "0")}-01`)
          }
        });
        periodIds[entityId][`${m.year}-${m.month}`] = p.id;
      }
    }
  }

  // ── 6. Sample Journals (Property A — March) ────────────────────────────

  console.log("6. Seeding sample journals...");
  const marchPeriodA = periodIds[PROP_A_ID]["2026-3"];

  const accountMap = new Map<string, string>();
  const propAAccounts = await prisma.account.findMany({ where: { entityId: PROP_A_ID } });
  for (const a of propAAccounts) accountMap.set(a.code, a.id);

  const journalData = [
    {
      ref: "JE-001",
      desc: "Room revenue — week 1",
      lines: [
        { acct: "1100", dr: "125000", cr: "0" },
        { acct: "4001", dr: "0", cr: "100000" },
        { acct: "4002", dr: "0", cr: "25000" }
      ]
    },
    {
      ref: "JE-002",
      desc: "F&B revenue — week 1",
      lines: [
        { acct: "1001", dr: "45000", cr: "0" },
        { acct: "4101", dr: "0", cr: "28000" },
        { acct: "4102", dr: "0", cr: "12000" },
        { acct: "4110", dr: "0", cr: "5000" }
      ]
    },
    {
      ref: "JE-003",
      desc: "Rooms department expenses",
      lines: [
        { acct: "5001", dr: "35000", cr: "0" },
        { acct: "5010", dr: "8000", cr: "0" },
        { acct: "5020", dr: "5000", cr: "0" },
        { acct: "1001", dr: "0", cr: "48000" }
      ]
    },
    {
      ref: "JE-004",
      desc: "F&B cost of sales",
      lines: [
        { acct: "5101", dr: "9500", cr: "0" },
        { acct: "5102", dr: "3200", cr: "0" },
        { acct: "2001", dr: "0", cr: "12700" }
      ]
    },
    {
      ref: "JE-005",
      desc: "Undistributed operating expenses",
      lines: [
        { acct: "6001", dr: "18000", cr: "0" },
        { acct: "6010", dr: "2500", cr: "0" },
        { acct: "6101", dr: "12000", cr: "0" },
        { acct: "6110", dr: "8000", cr: "0" },
        { acct: "6201", dr: "10000", cr: "0" },
        { acct: "6301", dr: "15000", cr: "0" },
        { acct: "1001", dr: "0", cr: "65500" }
      ]
    },
    {
      ref: "JE-006",
      desc: "Fixed charges — management fees & insurance",
      lines: [
        { acct: "7001", dr: "12500", cr: "0" },
        { acct: "7010", dr: "4500", cr: "0" },
        { acct: "7030", dr: "8000", cr: "0" },
        { acct: "2010", dr: "0", cr: "25000" }
      ]
    }
  ];

  for (const jd of journalData) {
    const existing = await prisma.journal.findFirst({
      where: { entityId: PROP_A_ID, reference: jd.ref, periodId: marchPeriodA }
    });
    if (existing) continue;

    const journal = await prisma.journal.create({
      data: {
        entityId: PROP_A_ID,
        periodId: marchPeriodA,
        reference: jd.ref,
        description: jd.desc,
        source: "MANUAL",
        status: "POSTED",
        functionalCurrency: "AED",
        postedAt: new Date(),
        createdById: ADMIN_USER_ID
      }
    });

    for (let i = 0; i < jd.lines.length; i++) {
      const line = jd.lines[i];
      const accountId = accountMap.get(line.acct);
      if (!accountId) {
        console.warn(`  Account ${line.acct} not found, skipping line.`);
        continue;
      }
      await prisma.journalLine.create({
        data: {
          journalId: journal.id,
          accountId,
          lineNumber: i + 1,
          debit: new Prisma.Decimal(line.dr),
          credit: new Prisma.Decimal(line.cr),
          debitFunctional: new Prisma.Decimal(line.dr),
          creditFunctional: new Prisma.Decimal(line.cr),
          currency: "AED",
          fxRate: new Prisma.Decimal("1")
        }
      });

      // Update account period balance
      const apb = await prisma.accountPeriodBalance.findFirst({
        where: { entityId: PROP_A_ID, accountId, periodId: marchPeriodA }
      });
      const dr = new Prisma.Decimal(line.dr);
      const cr = new Prisma.Decimal(line.cr);
      if (apb) {
        await prisma.accountPeriodBalance.update({
          where: { id: apb.id },
          data: {
            periodDebits: apb.periodDebits.add(dr),
            periodCredits: apb.periodCredits.add(cr),
            closingBalance: apb.closingBalance.add(dr).sub(cr)
          }
        });
      } else {
        await prisma.accountPeriodBalance.create({
          data: {
            entityId: PROP_A_ID,
            accountId,
            periodId: marchPeriodA,
            openingBalance: new Prisma.Decimal(0),
            periodDebits: dr,
            periodCredits: cr,
            closingBalance: dr.sub(cr)
          }
        });
      }
    }
  }

  // ── 7. Suppliers & AP Invoices ──────────────────────────────────────────

  console.log("7. Seeding suppliers & AP invoices...");
  const suppliers = [
    {
      code: "SUP-001",
      name: "Emirates Food Trading",
      currency: "AED",
      terms: 30,
      net: "14250",
      expenseAccount: "5101",
      lineDescription: "Food supplies, March",
      post: true
    },
    {
      code: "SUP-002",
      name: "Gulf Linen Services",
      currency: "AED",
      terms: 15,
      net: "8075",
      expenseAccount: "5020",
      lineDescription: "Linen and laundry, March",
      post: true
    },
    {
      code: "SUP-003",
      name: "Dubai Maintenance Co",
      currency: "AED",
      terms: 45,
      net: "11400",
      expenseAccount: "6210",
      lineDescription: "Maintenance contract, March",
      post: false
    }
  ];

  const apService = new APService(prisma);
  const arService = new ARService(prisma);
  // The services scope their own transactions to the entity; the fixture
  // reads they make outside a transaction rely on the session bypass above.
  const requireAccount = (code: string): string => {
    const id = accountMap.get(code);
    if (!id) throw new Error(`UAT seed: account ${code} is missing from the chart.`);
    return id;
  };

  // 5% VAT: input tax to 1320, output tax to the chart's Sales Tax Payable.
  const UAT_TAX_RATE = new Prisma.Decimal("0.05");
  const taxCode = await prisma.taxCode.upsert({
    where: { entityId_code: { entityId: PROP_A_ID, code: UAT_TAX_CODE } },
    update: {},
    create: {
      entityId: PROP_A_ID,
      code: UAT_TAX_CODE,
      description: "VAT 5%",
      taxType: "VAT",
      inputTaxAccountId: requireAccount("1320"),
      outputTaxAccountId: requireAccount("2100")
    }
  });
  await prisma.taxRate.deleteMany({ where: { taxCodeId: taxCode.id } });
  await prisma.taxRate.create({
    data: {
      taxCodeId: taxCode.id,
      rate: UAT_TAX_RATE.mul(100),
      effectiveFrom: new Date("2026-01-01")
    }
  });

  for (const s of suppliers) {
    const existing = await prisma.supplier.findFirst({
      where: { entityId: PROP_A_ID, code: s.code }
    });
    if (!existing) {
      const supplier = await prisma.supplier.create({
        data: {
          entityId: PROP_A_ID,
          code: s.code,
          name: s.name,
          currency: s.currency,
          paymentTermsDays: s.terms,
          isActive: true
        }
      });

      // One invoice per supplier, created, approved and posted through the
      // payables service so that it has a journal and balances behind it.
      // The last supplier's invoice is left approved, awaiting posting.
      const net = new Prisma.Decimal(s.net);
      const tax = net.mul(UAT_TAX_RATE).toDecimalPlaces(2);
      const gross = net.add(tax);
      const invoiceDate = new Date("2026-03-10");
      const invoice = await apService.createInvoice(PROP_A_ID, ADMIN_USER_ID, {
        supplierId: supplier.id,
        periodId: marchPeriodA,
        invoiceNumber: `INV-${s.code}-001`,
        invoiceDate,
        dueDate: new Date(invoiceDate.getTime() + s.terms * 86400000),
        currency: s.currency,
        grossAmount: gross.toFixed(4),
        taxAmount: tax.toFixed(4),
        netAmount: net.toFixed(4),
        functionalAmount: gross.toFixed(4),
        fxRate: "1",
        lines: [
          {
            description: s.lineDescription,
            quantity: "1",
            unitPrice: net.toFixed(4),
            amount: net.toFixed(4),
            glAccountId: requireAccount(s.expenseAccount),
            taxCode: UAT_TAX_CODE
          }
        ]
      });
      await apService.approveInvoice(PROP_A_ID, invoice.id, ADMIN_USER_ID);
      if (s.post) await apService.postInvoice(PROP_A_ID, invoice.id, ADMIN_USER_ID);
    }
  }

  // ── 8. Customers & AR Invoices ──────────────────────────────────────────

  console.log("8. Seeding customers & AR invoices...");
  const customers = [
    { code: "CUS-001", name: "Acme Corporation", type: "CORPORATE" },
    { code: "CUS-002", name: "Booking.com", type: "OTA" },
    { code: "CUS-003", name: "Arabian Travels", type: "TRAVEL_AGENT" }
  ];

  for (const c of customers) {
    const existing = await prisma.customer.findFirst({
      where: { entityId: PROP_A_ID, code: c.code }
    });
    if (!existing) {
      const customer = await prisma.customer.create({
        data: {
          entityId: PROP_A_ID,
          code: c.code,
          name: c.name,
          type: c.type as any,
          currency: "AED",
          isActive: true
        }
      });

      // Created and posted through the receivables service, so the invoice
      // has a journal: debit the receivables control account, credit revenue.
      const arAmount = c.type === "CORPORATE" ? "45000" : c.type === "OTA" ? "32000" : "18000";
      const invoice = await arService.createInvoice(PROP_A_ID, {
        customerId: customer.id,
        invoiceNumber: `AR-${c.code}-001`,
        invoiceDate: new Date("2026-03-05"),
        dueDate: new Date("2026-04-04"),
        currency: "AED",
        amount: arAmount,
        functionalAmount: arAmount,
        fxRate: "1",
        origin: "MANUAL"
      });
      await arService.postInvoice(PROP_A_ID, invoice.id, ADMIN_USER_ID);
    }
  }

  // ── 9. Budget Definition & Lines ────────────────────────────────────────

  console.log("9. Seeding budget...");
  let budgetDef = await prisma.budgetDefinition.findFirst({
    where: { entityId: PROP_A_ID, name: "2026 Annual Budget" }
  });
  if (!budgetDef) {
    budgetDef = await prisma.budgetDefinition.create({
      data: {
        entityId: PROP_A_ID,
        name: "2026 Annual Budget",
        year: 2026
      }
    });

    // Budget lines for March (month 3)
    const budgetLines = [
      { code: "4001", amount: "110000" },
      { code: "4002", amount: "28000" },
      { code: "4101", amount: "30000" },
      { code: "4102", amount: "14000" },
      { code: "5001", amount: "38000" },
      { code: "5101", amount: "10000" },
      { code: "6001", amount: "20000" },
      { code: "6301", amount: "16000" },
      { code: "7001", amount: "13000" }
    ];

    for (const bl of budgetLines) {
      const accountId = accountMap.get(bl.code);
      if (!accountId) continue;
      await prisma.budgetLine.create({
        data: {
          budgetDefinitionId: budgetDef.id,
          accountId,
          month: 3,
          amount: new Prisma.Decimal(bl.amount)
        }
      });
    }
  }

  // ── 10. PMS Statistics ──────────────────────────────────────────────────

  console.log("10. Seeding PMS statistics...");
  const statDate = new Date("2026-03-15");
  const existingStat = await prisma.pMSStatistic.findFirst({
    where: { entityId: PROP_A_ID, statDate }
  });
  if (!existingStat) {
    await prisma.pMSStatistic.create({
      data: {
        entityId: PROP_A_ID,
        statDate,
        availableRooms: 250,
        occupiedRooms: 198,
        source: "MANUAL"
      }
    });
  }

  // ── 11. Report Definitions ──────────────────────────────────────────────

  console.log("11. Seeding report definitions...");
  const reportTypes = [
    { name: "USALI P&L", type: "USALI_PL" },
    { name: "Trial Balance", type: "TRIAL_BALANCE" },
    { name: "Balance Sheet", type: "BALANCE_SHEET" },
    { name: "Cash Flow Statement", type: "CASHFLOW" }
  ];

  for (const rt of reportTypes) {
    const existing = await prisma.reportDefinition.findFirst({
      where: { entityId: PROP_A_ID, name: rt.name }
    });
    if (!existing) {
      await prisma.reportDefinition.create({
        data: {
          entityId: PROP_A_ID,
          name: rt.name,
          type: rt.type as any,
          isSystem: true,
          template: {}
        }
      });
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────

  console.log("\n=== UAT seed complete ===");
  console.log(`  Entities: 3 (1 Group + 2 Properties)`);
  console.log(`  Accounts: ${accounts.length} per property`);
  console.log(`  Periods: ${months.length} per property`);
  console.log(`  Journals: ${journalData.length} (Property A, March)`);
  console.log(`  Suppliers: ${suppliers.length} + AP invoices`);
  console.log(`  Customers: ${customers.length} + AR invoices`);
  console.log(`  FX Rates: ${fxRates.length}`);
  console.log(`  Budget: 1 definition + ${9} lines`);
  console.log(`  PMS Stats: 1 day`);
  console.log(`  Reports: ${reportTypes.length} system definitions`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
