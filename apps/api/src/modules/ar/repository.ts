import { Prisma, PrismaClient } from "@prisma/client";
import type {
  ARAllocationInput,
  ARInvoiceCreateInput,
  ARInvoiceListQuery,
  ARReceiptCreateInput,
  CustomerCreateInput,
  CustomerUpdateInput
} from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class ARRepository {
  constructor(private readonly db: DbClient) {}

  // ── Customers ───────────────────────────────────────────────────────────────

  listCustomers(entityId: string) {
    return this.db.customer.findMany({
      where: { entityId, isActive: true },
      orderBy: [{ name: "asc" }]
    });
  }

  getCustomer(entityId: string, customerId: string) {
    return this.db.customer.findFirst({
      where: { entityId, id: customerId }
    });
  }

  getCustomerByCode(entityId: string, code: string) {
    return this.db.customer.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  createCustomer(entityId: string, input: CustomerCreateInput) {
    return this.db.customer.create({
      data: {
        entityId,
        name: input.name,
        code: input.code,
        type: input.type,
        creditLimit: input.creditLimit ? new Prisma.Decimal(input.creditLimit) : null,
        currency: input.currency.toUpperCase(),
        paymentTermsDays: input.paymentTermsDays,
        billingContact: input.billingContact as Prisma.InputJsonValue | undefined,
        isActive: input.isActive
      }
    });
  }

  updateCustomer(entityId: string, customerId: string, input: CustomerUpdateInput) {
    return this.db.customer.updateMany({
      where: { entityId, id: customerId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.code !== undefined && { code: input.code }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.creditLimit !== undefined && {
          creditLimit: input.creditLimit ? new Prisma.Decimal(input.creditLimit) : null
        }),
        ...(input.currency !== undefined && { currency: input.currency.toUpperCase() }),
        ...(input.paymentTermsDays !== undefined && {
          paymentTermsDays: input.paymentTermsDays
        }),
        ...(input.billingContact !== undefined && {
          billingContact: input.billingContact as Prisma.InputJsonValue
        }),
        ...(input.isActive !== undefined && { isActive: input.isActive })
      }
    });
  }

  // ── Invoices ────────────────────────────────────────────────────────────────

  listInvoices(entityId: string, query: ARInvoiceListQuery) {
    return this.db.aRInvoice.findMany({
      where: {
        entityId,
        customerId: query.customerId,
        status: query.status,
        ...(query.dueBefore && { dueDate: { lte: query.dueBefore } })
      },
      take: query.limit,
      orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
      include: {
        customer: true,
        allocations: true
      }
    });
  }

  getInvoice(entityId: string, invoiceId: string) {
    return this.db.aRInvoice.findFirst({
      where: { entityId, id: invoiceId },
      include: {
        customer: true,
        allocations: {
          include: { receipt: true }
        }
      }
    });
  }

  createInvoice(entityId: string, input: ARInvoiceCreateInput) {
    return this.db.aRInvoice.create({
      data: {
        entityId,
        customerId: input.customerId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        currency: input.currency.toUpperCase(),
        amount: new Prisma.Decimal(input.amount),
        functionalAmount: new Prisma.Decimal(input.functionalAmount),
        fxRate: new Prisma.Decimal(input.fxRate),
        notes: input.notes
      },
      include: { customer: true }
    });
  }

  updateInvoice(entityId: string, invoiceId: string, input: Partial<{
    dueDate: Date;
    notes: string;
    status: "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
    amountPaid: Prisma.Decimal;
    glJournalId: string;
  }>) {
    return this.db.aRInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: input
    });
  }

  setInvoiceStatus(entityId: string, invoiceId: string, status: "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED", glJournalId?: string) {
    return this.db.aRInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: {
        status,
        ...(glJournalId && { glJournalId })
      }
    });
  }

  // ── Receipts ────────────────────────────────────────────────────────────────

  listReceipts(entityId: string, customerId?: string) {
    return this.db.aRReceipt.findMany({
      where: { entityId, ...(customerId && { customerId }) },
      orderBy: [{ receiptDate: "desc" }],
      include: {
        customer: true,
        allocations: {
          include: { invoice: true }
        }
      }
    });
  }

  getReceipt(entityId: string, receiptId: string) {
    return this.db.aRReceipt.findFirst({
      where: { entityId, id: receiptId },
      include: {
        customer: true,
        allocations: {
          include: { invoice: true }
        }
      }
    });
  }

  createReceipt(entityId: string, input: ARReceiptCreateInput, glJournalId?: string) {
    return this.db.aRReceipt.create({
      data: {
        entityId,
        customerId: input.customerId,
        receiptDate: input.receiptDate,
        currency: input.currency.toUpperCase(),
        amount: new Prisma.Decimal(input.amount),
        bankAccountId: input.bankAccountId,
        reference: input.reference,
        glJournalId
      },
      include: { customer: true }
    });
  }

  // ── Allocations ─────────────────────────────────────────────────────────────

  createAllocation(input: ARAllocationInput) {
    return this.db.aRAllocation.create({
      data: {
        receiptId: input.receiptId,
        invoiceId: input.invoiceId,
        allocatedAmount: new Prisma.Decimal(input.allocatedAmount)
      }
    });
  }

  getAllocationsForInvoice(invoiceId: string) {
    return this.db.aRAllocation.findMany({
      where: { invoiceId }
    });
  }

  // ── Ageing Query ─────────────────────────────────────────────────────────────

  async getAgeingReport(entityId: string, asOfDate: Date) {
    type AgeingRow = {
      customer_id: string;
      customer_name: string;
      customer_code: string;
      currency: string;
      bucket_0_30: Prisma.Decimal;
      bucket_31_60: Prisma.Decimal;
      bucket_61_90: Prisma.Decimal;
      bucket_91_plus: Prisma.Decimal;
      total_outstanding: Prisma.Decimal;
    };

    const rows = await this.db.$queryRaw<AgeingRow[]>`
      SELECT
        c.id           AS customer_id,
        c.name         AS customer_name,
        c.code         AS customer_code,
        inv.currency,
        COALESCE(SUM(CASE WHEN EXTRACT(DAY FROM (${asOfDate}::date - inv.due_date)) BETWEEN 0 AND 30
                     THEN (inv.amount - inv.amount_paid) ELSE 0 END), 0)::numeric(18,4) AS bucket_0_30,
        COALESCE(SUM(CASE WHEN EXTRACT(DAY FROM (${asOfDate}::date - inv.due_date)) BETWEEN 31 AND 60
                     THEN (inv.amount - inv.amount_paid) ELSE 0 END), 0)::numeric(18,4) AS bucket_31_60,
        COALESCE(SUM(CASE WHEN EXTRACT(DAY FROM (${asOfDate}::date - inv.due_date)) BETWEEN 61 AND 90
                     THEN (inv.amount - inv.amount_paid) ELSE 0 END), 0)::numeric(18,4) AS bucket_61_90,
        COALESCE(SUM(CASE WHEN EXTRACT(DAY FROM (${asOfDate}::date - inv.due_date)) > 90
                     THEN (inv.amount - inv.amount_paid) ELSE 0 END), 0)::numeric(18,4) AS bucket_91_plus,
        COALESCE(SUM(inv.amount - inv.amount_paid), 0)::numeric(18,4)                  AS total_outstanding
      FROM ar_invoices inv
      JOIN customers c ON c.id = inv.customer_id
      WHERE inv.entity_id = ${entityId}
        AND inv.status IN ('POSTED', 'PARTIALLY_PAID', 'OVERDUE')
        AND inv.due_date <= ${asOfDate}::date
      GROUP BY c.id, c.name, c.code, inv.currency
      ORDER BY total_outstanding DESC;
    `;

    return rows;
  }

  // ── Helper: find account by code ────────────────────────────────────────────

  getAccountByCode(entityId: string, code: string) {
    return this.db.account.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  getFallbackARControlAccount(entityId: string) {
    return this.db.account.findFirst({
      where: { entityId, isControlAccount: true, type: "ASSET" }
    });
  }

  createPostedJournalForARInvoice(
    entityId: string,
    actorId: string,
    invoiceId: string,
    periodId: string,
    currency: string,
    description: string,
    lines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      fxRate: Prisma.Decimal;
      lineNumber: number;
      description: string;
    }>
  ) {
    return this.db.journal.create({
      data: {
        entityId,
        periodId,
        reference: `AR-${invoiceId.slice(0, 8)}`,
        description,
        source: "AR",
        status: "POSTED",
        functionalCurrency: currency,
        createdById: actorId,
        postedAt: new Date(),
        lines: {
          create: lines.map((line) => ({
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            currency,
            fxRate: line.fxRate,
            debitFunctional: line.debit.mul(line.fxRate),
            creditFunctional: line.credit.mul(line.fxRate),
            description: line.description,
            lineNumber: line.lineNumber
          }))
        }
      },
      include: { lines: { include: { account: { select: { type: true } } } } }
    });
  }

  updateAccountBalance(
    entityId: string,
    accountId: string,
    periodId: string,
    debitFunctional: Prisma.Decimal,
    creditFunctional: Prisma.Decimal,
    accountType: string
  ) {
    const isDebitNormal = ["ASSET", "EXPENSE", "CONTRA_REVENUE"].includes(accountType);
    const balanceDelta = isDebitNormal
      ? debitFunctional.sub(creditFunctional)
      : creditFunctional.sub(debitFunctional);

    return this.db.accountPeriodBalance.upsert({
      where: { entityId_accountId_periodId: { entityId, accountId, periodId } },
      create: {
        entityId,
        accountId,
        periodId,
        openingBalance: new Prisma.Decimal(0),
        periodDebits: debitFunctional,
        periodCredits: creditFunctional,
        closingBalance: balanceDelta
      },
      update: {
        periodDebits: { increment: debitFunctional },
        periodCredits: { increment: creditFunctional },
        closingBalance: { increment: balanceDelta }
      }
    });
  }

  getOpenPeriodForDate(entityId: string, date: Date) {
    return this.db.period.findFirst({
      where: {
        entityId,
        status: "OPEN",
        year: date.getFullYear(),
        month: date.getMonth() + 1
      }
    });
  }

  getAnyOpenPeriod(entityId: string) {
    return this.db.period.findFirst({
      where: { entityId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
  }
}
