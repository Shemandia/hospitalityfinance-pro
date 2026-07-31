/**
 * Integration Test: VAT/tax posting for AP and AR (P0 blocker — the system
 * posted and paid net of tax).
 *
 * The audit's failure case: book a 118,000 TZS invoice made of 100,000 net and
 * 18,000 VAT, and the AP liability showed 100,000 while the payment run paid
 * the supplier 100,000 — short by exactly the tax. AR credited the whole
 * invoice to revenue with no output-VAT split, so a VAT return was impossible.
 *
 * These assertions are about money landing in the right GL accounts, so they
 * run against real Postgres rather than stubs.
 *
 * Run: TEST_DATABASE_URL=… pnpm vitest run tests/integration/ap-ar-tax.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "../../src/db/client.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import { APService } from "../../src/modules/ap/service.js";
import { ARService } from "../../src/modules/ar/service.js";
import { TaxPostingError } from "../../src/modules/tax/tax-posting.js";

const D = (v: string | number) => new Prisma.Decimal(v);

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("AP/AR tax posting against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("AP/AR tax posting against real Postgres", () => {
    let prisma: PrismaClient;
    let apService: APService;
    let arService: ARService;

    let entityId: string;
    let userId: string;
    let periodId: string;
    let supplierId: string;
    let customerId: string;

    let expenseAcc: string;
    let apControl: string;
    let arControl: string;
    let revenueAcc: string;
    let inputVatAcc: string;
    let outputVatAcc: string;
    let vatCodeId: string;
    let unmappedCodeId: string;

    beforeAll(async () => {
      // The services open their own transactions and set entity context per
      // call, so pin the pool to one connection and set context at session
      // scope for the fixture reads/writes.
      const base = process.env.TEST_DATABASE_URL!;
      const url = `${base}${base.includes("?") ? "&" : "?"}connection_limit=1`;
      prisma = new PrismaClient({ datasources: { db: { url } } });
      apService = new APService(prisma);
      arService = new ARService(prisma);
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      const unique = `${Date.now()}-${Math.round(performance.now() * 1000)}`;

      const seeded = await withBypassRLS(prisma, async (tx: any) => {
        const entity = await tx.entity.create({
          data: {
            name: `Tax Test ${unique}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "TZS"
          }
        });

        const user = await tx.user.create({
          data: { email: `tax-${unique}@example.test`, name: "Tax Tester" }
        });
        await tx.entityUser.create({
          data: { entityId: entity.id, userId: user.id, role: "ADMIN" }
        });

        const period = await tx.period.create({
          data: {
            entityId: entity.id,
            year: 2026,
            month: 6,
            name: "2026-06",
            status: "OPEN"
          }
        });

        const mkAcc = async (code: string, name: string, type: string, nb: string) =>
          (
            await tx.account.create({
              data: { entityId: entity.id, code, name, type, normalBalance: nb }
            })
          ).id;

        const accounts = {
          expense: await mkAcc("6100", "Consumables", "EXPENSE", "DEBIT"),
          apControl: await mkAcc("2000", "Accounts Payable", "LIABILITY", "CREDIT"),
          arControl: await mkAcc("1200", "Accounts Receivable", "ASSET", "DEBIT"),
          revenue: await mkAcc("4100", "Room Revenue", "REVENUE", "CREDIT"),
          inputVat: await mkAcc("1450", "Input VAT Recoverable", "ASSET", "DEBIT"),
          outputVat: await mkAcc("2250", "Output VAT Payable", "LIABILITY", "CREDIT")
        };

        const vatCode = await tx.taxCode.create({
          data: {
            entityId: entity.id,
            code: "VAT18",
            description: "Tanzania VAT 18%",
            taxType: "VAT",
            inputTaxAccountId: accounts.inputVat,
            outputTaxAccountId: accounts.outputVat
          }
        });

        const unmapped = await tx.taxCode.create({
          data: {
            entityId: entity.id,
            code: "VAT0-UNMAPPED",
            description: "Rate with no GL mapping",
            taxType: "VAT"
          }
        });

        const supplier = await tx.supplier.create({
          data: {
            entityId: entity.id,
            name: "Test Supplier",
            code: `SUP${unique.slice(-6)}`,
            currency: "TZS",
            paymentTermsDays: 30
          }
        });

        const customer = await tx.customer.create({
          data: {
            entityId: entity.id,
            name: "Test Customer",
            code: `CUS${unique.slice(-6)}`,
            type: "CORPORATE",
            currency: "TZS",
            paymentTermsDays: 30
          }
        });

        return {
          entityId: entity.id,
          userId: user.id,
          periodId: period.id,
          accounts,
          vatCodeId: vatCode.id,
          unmappedCodeId: unmapped.id,
          supplierId: supplier.id,
          customerId: customer.id
        };
      });

      entityId = seeded.entityId;
      userId = seeded.userId;
      periodId = seeded.periodId;
      supplierId = seeded.supplierId;
      customerId = seeded.customerId;
      expenseAcc = seeded.accounts.expense;
      apControl = seeded.accounts.apControl;
      arControl = seeded.accounts.arControl;
      revenueAcc = seeded.accounts.revenue;
      inputVatAcc = seeded.accounts.inputVat;
      outputVatAcc = seeded.accounts.outputVat;
      vatCodeId = seeded.vatCodeId;
      unmappedCodeId = seeded.unmappedCodeId;

      await prisma.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, false)`;
    });

    /** Create + approve an AP invoice so it is ready to post. */
    async function makeApInvoice(opts: {
      net: string;
      tax: string;
      gross: string;
      taxCodeId?: string | null;
      secondLineTaxCodeId?: string | null;
    }) {
      const invoice = await withBypassRLS(prisma, async (tx: any) =>
        tx.aPInvoice.create({
          data: {
            entityId,
            supplierId,
            periodId,
            invoiceNumber: `INV-${Math.random().toString(36).slice(2, 10)}`,
            invoiceDate: new Date(),
            dueDate: new Date(),
            currency: "TZS",
            grossAmount: D(opts.gross),
            taxAmount: D(opts.tax),
            netAmount: D(opts.net),
            functionalAmount: D(opts.gross),
            fxRate: D(1),
            status: "APPROVED",
            lines: {
              create: [
                {
                  description: "Line 1",
                  quantity: D(1),
                  unitPrice: D(opts.net),
                  amount: D(opts.net),
                  glAccountId: expenseAcc,
                  taxCodeId: opts.taxCodeId ?? null
                }
              ]
            }
          }
        })
      );
      return invoice.id;
    }

    async function journalLinesFor(journalId: string) {
      return withBypassRLS(prisma, async (tx: any) =>
        tx.journalLine.findMany({
          where: { journalId },
          include: { account: true },
          orderBy: { lineNumber: "asc" }
        })
      );
    }

    async function balanceOf(accountId: string) {
      return withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findFirst({ where: { entityId, accountId, periodId } })
      );
    }

    it("books input VAT and credits AP control with the gross amount", async () => {
      const invoiceId = await makeApInvoice({
        net: "100000",
        tax: "18000",
        gross: "118000",
        taxCodeId: vatCodeId
      });

      const posted = await apService.postInvoice(entityId, invoiceId, userId);
      const lines = await journalLinesFor(posted!.glJournalId!);

      const expense = lines.find((l: any) => l.accountId === expenseAcc);
      const vat = lines.find((l: any) => l.accountId === inputVatAcc);
      const ap = lines.find((l: any) => l.accountId === apControl);

      expect(D(expense.debit).toFixed(2)).toBe("100000.00");
      expect(vat, "input VAT line must exist").toBeDefined();
      expect(D(vat.debit).toFixed(2)).toBe("18000.00");
      // The supplier is owed the gross, not the net.
      expect(D(ap.credit).toFixed(2)).toBe("118000.00");

      // AP control is credit-normal, stored normal-balance-positive.
      const apBalance = await balanceOf(apControl);
      expect(D(apBalance.closingBalance).toFixed(2)).toBe("118000.00");

      const vatBalance = await balanceOf(inputVatAcc);
      expect(D(vatBalance.closingBalance).toFixed(2)).toBe("18000.00");
    });

    it("still posts a tax-free invoice exactly as before", async () => {
      const invoiceId = await makeApInvoice({ net: "50000", tax: "0", gross: "50000" });

      const posted = await apService.postInvoice(entityId, invoiceId, userId);
      const lines = await journalLinesFor(posted!.glJournalId!);

      expect(lines).toHaveLength(2);
      expect(lines.some((l: any) => l.accountId === inputVatAcc)).toBe(false);
      const ap = lines.find((l: any) => l.accountId === apControl);
      expect(D(ap.credit).toFixed(2)).toBe("50000.00");
    });

    it("refuses to post when a tax-bearing invoice has no tax code", async () => {
      const invoiceId = await makeApInvoice({
        net: "100000",
        tax: "18000",
        gross: "118000",
        taxCodeId: null
      });

      await expect(apService.postInvoice(entityId, invoiceId, userId)).rejects.toThrow(
        TaxPostingError
      );
    });

    it("refuses to post when the tax code has no GL account configured", async () => {
      const invoiceId = await makeApInvoice({
        net: "100000",
        tax: "18000",
        gross: "118000",
        taxCodeId: unmappedCodeId
      });

      await expect(apService.postInvoice(entityId, invoiceId, userId)).rejects.toThrow(
        /no input \(recoverable\) tax.*GL account configured/i
      );
    });

    it("proposes payment of the gross amount, not the net", async () => {
      // The reported cash defect: the supplier was paid 100,000 against a
      // 118,000 invoice, leaving AP permanently short by the VAT.
      const invoiceId = await makeApInvoice({
        net: "100000",
        tax: "18000",
        gross: "118000",
        taxCodeId: vatCodeId
      });
      await apService.postInvoice(entityId, invoiceId, userId);

      const run = await apService.proposePaymentRun(entityId, userId, {
        startDate: new Date(Date.now() - 86400000),
        endDate: new Date(Date.now() + 86400000),
        includeApproved: false,
        includePosted: true,
        bankFileFormat: "CSV"
      } as any);

      const total = (run as any).items.reduce(
        (sum: Prisma.Decimal, i: any) => sum.add(D(i.payableAmount)),
        D(0)
      );
      expect(total.toFixed(2)).toBe("118000.00");
    });

    it("splits output VAT out of AR revenue", async () => {
      const invoice = await arService.createInvoice(entityId, {
        customerId,
        invoiceNumber: `AR-${Math.random().toString(36).slice(2, 10)}`,
        invoiceDate: new Date(),
        dueDate: new Date(),
        currency: "TZS",
        amount: "118000",
        netAmount: "100000",
        taxAmount: "18000",
        taxCodeId: vatCodeId,
        functionalAmount: "118000",
        fxRate: "1",
        origin: "MANUAL"
      } as any);

      const posted = await arService.postInvoice(entityId, (invoice as any).id, userId);
      const lines = await journalLinesFor((posted as any).glJournalId!);

      const ar = lines.find((l: any) => l.accountId === arControl);
      const rev = lines.find((l: any) => l.accountId === revenueAcc);
      const vat = lines.find((l: any) => l.accountId === outputVatAcc);

      // Customer owes the gross; revenue is recognised net of VAT.
      expect(D(ar.debit).toFixed(2)).toBe("118000.00");
      expect(D(rev.credit).toFixed(2)).toBe("100000.00");
      expect(vat, "output VAT line must exist").toBeDefined();
      expect(D(vat.credit).toFixed(2)).toBe("18000.00");
    });

    it("credits the full amount to revenue when an AR invoice has no tax", async () => {
      const invoice = await arService.createInvoice(entityId, {
        customerId,
        invoiceNumber: `AR-${Math.random().toString(36).slice(2, 10)}`,
        invoiceDate: new Date(),
        dueDate: new Date(),
        currency: "TZS",
        amount: "75000",
        functionalAmount: "75000",
        fxRate: "1",
        origin: "MANUAL"
      } as any);

      const posted = await arService.postInvoice(entityId, (invoice as any).id, userId);
      const lines = await journalLinesFor((posted as any).glJournalId!);

      expect(lines).toHaveLength(2);
      const rev = lines.find((l: any) => l.accountId === revenueAcc);
      expect(D(rev.credit).toFixed(2)).toBe("75000.00");
    });
  });
}
