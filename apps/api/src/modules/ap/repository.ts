import { Prisma, PrismaClient } from "@prisma/client";
import type {
  APInvoiceCreateInput,
  APInvoiceListQuery,
  APInvoiceUpdateInput,
  PaymentRunProposalInput,
  SupplierCreateInput,
  SupplierUpdateInput
} from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class APRepository {
  constructor(private readonly db: DbClient) {}

  listSuppliers(entityId: string) {
    return this.db.supplier.findMany({
      where: { entityId },
      orderBy: [{ name: "asc" }]
    });
  }

  getSupplier(entityId: string, supplierId: string) {
    return this.db.supplier.findFirst({
      where: { entityId, id: supplierId }
    });
  }

  getSupplierByCode(entityId: string, code: string) {
    return this.db.supplier.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  createSupplier(entityId: string, input: SupplierCreateInput) {
    return this.db.supplier.create({
      data: {
        entityId,
        name: input.name,
        code: input.code,
        taxId: input.taxId,
        currency: input.currency.toUpperCase(),
        paymentTermsDays: input.paymentTermsDays,
        bankDetails: input.bankDetails ? (input.bankDetails as Prisma.InputJsonValue) : undefined,
        isActive: input.isActive
      }
    });
  }

  updateSupplier(entityId: string, supplierId: string, input: SupplierUpdateInput) {
    const data: Prisma.SupplierUpdateManyMutationInput = {
      name: input.name,
      code: input.code,
      taxId: input.taxId,
      currency: input.currency?.toUpperCase(),
      paymentTermsDays: input.paymentTermsDays,
      bankDetails: input.bankDetails
        ? (input.bankDetails as Prisma.InputJsonValue)
        : undefined,
      isActive: input.isActive
    };

    return this.db.supplier.updateMany({
      where: { entityId, id: supplierId },
      data
    });
  }

  deleteSupplier(entityId: string, supplierId: string) {
    return this.db.supplier.updateMany({
      where: { entityId, id: supplierId },
      data: { isActive: false }
    });
  }

  listInvoices(entityId: string, query: APInvoiceListQuery) {
    return this.db.aPInvoice.findMany({
      where: {
        entityId,
        status: query.status,
        supplierId: query.supplierId,
        dueDate: query.dueBefore ? { lte: query.dueBefore } : undefined
      },
      take: query.limit,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        supplier: true,
        lines: true
      }
    });
  }

  getInvoice(entityId: string, invoiceId: string) {
    return this.db.aPInvoice.findFirst({
      where: { entityId, id: invoiceId },
      include: {
        supplier: true,
        period: true,
        lines: true,
        purchaseOrder: {
          include: {
            lines: true,
            goodsReceivedNotes: {
              include: {
                lines: true
              }
            }
          }
        }
      }
    });
  }

  createInvoice(entityId: string, createdById: string | null, input: APInvoiceCreateInput) {
    return this.db.aPInvoice.create({
      data: {
        entityId,
        supplierId: input.supplierId,
        periodId: input.periodId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        currency: input.currency.toUpperCase(),
        grossAmount: new Prisma.Decimal(input.grossAmount),
        taxAmount: new Prisma.Decimal(input.taxAmount),
        netAmount: new Prisma.Decimal(input.netAmount),
        functionalAmount: new Prisma.Decimal(input.functionalAmount),
        fxRate: new Prisma.Decimal(input.fxRate),
        status: "DRAFT",
        poId: input.poId,
        paymentTerms: input.paymentTerms,
        createdById,
        lines: {
          create: input.lines.map((line) => ({
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            amount: new Prisma.Decimal(line.amount),
            glAccountId: line.glAccountId,
            taxCode: line.taxCode
          }))
        }
      },
      include: {
        lines: true,
        supplier: true
      }
    });
  }

  async updateInvoice(entityId: string, invoiceId: string, input: APInvoiceUpdateInput) {
    const { lines, ...rest } = input;

    const updated = await this.db.aPInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: {
        ...rest,
        grossAmount: rest.grossAmount ? new Prisma.Decimal(rest.grossAmount) : undefined,
        taxAmount: rest.taxAmount ? new Prisma.Decimal(rest.taxAmount) : undefined,
        netAmount: rest.netAmount ? new Prisma.Decimal(rest.netAmount) : undefined,
        functionalAmount: rest.functionalAmount
          ? new Prisma.Decimal(rest.functionalAmount)
          : undefined,
        fxRate: rest.fxRate ? new Prisma.Decimal(rest.fxRate) : undefined
      }
    });

    if (updated.count > 0 && lines) {
      await this.db.aPInvoiceLine.deleteMany({
        where: { invoiceId }
      });
      await this.db.aPInvoiceLine.createMany({
        data: lines.map((line) => ({
          invoiceId,
          description: line.description,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: new Prisma.Decimal(line.unitPrice),
          amount: new Prisma.Decimal(line.amount),
          glAccountId: line.glAccountId,
          taxCode: line.taxCode
        }))
      });
    }

    return updated;
  }

  deleteInvoice(entityId: string, invoiceId: string) {
    return this.db.aPInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: { status: "CANCELLED" }
    });
  }

  setInvoiceStatus(
    entityId: string,
    invoiceId: string,
    status:
      | "DRAFT"
      | "PENDING_APPROVAL"
      | "APPROVED"
      | "POSTED"
      | "PAID"
      | "DISPUTED"
      | "CANCELLED",
    approvedById?: string | null
  ) {
    return this.db.aPInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: {
        status,
        approvedById: approvedById ?? undefined
      }
    });
  }

  linkInvoiceJournal(entityId: string, invoiceId: string, journalId: string) {
    return this.db.aPInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: { glJournalId: journalId }
    });
  }

  getPeriod(entityId: string, periodId: string) {
    return this.db.period.findFirst({
      where: { entityId, id: periodId }
    });
  }

  getOpenPeriodForDate(entityId: string, date: Date) {
    return this.db.period.findFirst({
      where: {
        entityId,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        status: "OPEN"
      },
      orderBy: [{ createdAt: "asc" }]
    });
  }

  getAccountById(entityId: string, accountId: string) {
    return this.db.account.findFirst({
      where: { entityId, id: accountId, isActive: true }
    });
  }

  getAccountByCode(entityId: string, code: string) {
    return this.db.account.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  getFallbackAPControlAccount(entityId: string) {
    return this.db.account.findFirst({
      where: {
        entityId,
        type: "LIABILITY",
        isControlAccount: true,
        isActive: true
      },
      orderBy: [{ code: "asc" }]
    });
  }

  getFallbackBankAccount(entityId: string) {
    return this.db.account.findFirst({
      where: {
        entityId,
        type: "ASSET",
        allowPosting: true,
        isActive: true
      },
      orderBy: [{ code: "asc" }]
    });
  }

  createPostedJournalForInvoice(
    entityId: string,
    actorUserId: string,
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
        reference: `AP-${invoiceId}`,
        description,
        source: "AP",
        status: "POSTED",
        postedAt: new Date(),
        functionalCurrency: currency,
        createdById: actorUserId,
        approvedById: actorUserId,
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
      include: {
        lines: true
      }
    });
  }

  async updateAccountBalance(
    entityId: string,
    accountId: string,
    periodId: string,
    debitFunctional: Prisma.Decimal,
    creditFunctional: Prisma.Decimal
  ) {
    const existing = await this.db.accountPeriodBalance.findUnique({
      where: {
        entityId_accountId_periodId: {
          entityId,
          accountId,
          periodId
        }
      }
    });

    if (!existing) {
      const opening = new Prisma.Decimal(0);
      const periodDebits = debitFunctional;
      const periodCredits = creditFunctional;
      const closing = opening.add(periodDebits).sub(periodCredits);

      await this.db.accountPeriodBalance.create({
        data: {
          entityId,
          accountId,
          periodId,
          openingBalance: opening,
          periodDebits,
          periodCredits,
          closingBalance: closing
        }
      });
      return;
    }

    const periodDebits = new Prisma.Decimal(existing.periodDebits).add(
      debitFunctional
    );
    const periodCredits = new Prisma.Decimal(existing.periodCredits).add(
      creditFunctional
    );
    const closing = new Prisma.Decimal(existing.openingBalance)
      .add(periodDebits)
      .sub(periodCredits);

    await this.db.accountPeriodBalance.update({
      where: { id: existing.id },
      data: {
        periodDebits,
        periodCredits,
        closingBalance: closing
      }
    });
  }

  findUserByIdOrKeycloak(subject: string) {
    return this.db.user.findFirst({
      where: {
        OR: [{ id: subject }, { keycloakId: subject }]
      }
    });
  }

  findAnyEntityUser(entityId: string) {
    return this.db.entityUser.findFirst({
      where: { entityId },
      orderBy: [{ createdAt: "asc" }]
    });
  }

  listInvoicesForPaymentRun(
    entityId: string,
    startDate: Date,
    endDate: Date,
    statuses: Array<"APPROVED" | "POSTED">,
    supplierIds?: string[]
  ) {
    return this.db.aPInvoice.findMany({
      where: {
        entityId,
        status: { in: statuses },
        dueDate: {
          gte: startDate,
          lte: endDate
        },
        ...(supplierIds && supplierIds.length > 0
          ? { supplierId: { in: supplierIds } }
          : {}),
        paymentRuns: {
          none: {
            paymentRun: {
              status: {
                in: ["PROPOSED", "APPROVED", "CONFIRMED", "PROCESSED"]
              }
            }
          }
        }
      },
      include: {
        supplier: true
      },
      orderBy: [{ supplierId: "asc" }, { dueDate: "asc" }]
    });
  }

  createPaymentRun(
    entityId: string,
    createdById: string,
    input: PaymentRunProposalInput,
    items: Array<{
      supplierId: string;
      currency: string;
      invoiceCount: number;
      grossAmount: Prisma.Decimal;
      creditAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      payableAmount: Prisma.Decimal;
    }>,
    invoices: Array<{
      invoiceId: string;
      allocatedAmount: Prisma.Decimal;
      isCreditNote: boolean;
    }>
  ) {
    return this.db.paymentRun.create({
      data: {
        entityId,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "PROPOSED",
        bankFileFormat: input.bankFileFormat,
        createdById,
        items: {
          create: items.map((item) => ({
            supplierId: item.supplierId,
            currency: item.currency,
            invoiceCount: item.invoiceCount,
            grossAmount: item.grossAmount,
            creditAmount: item.creditAmount,
            discountAmount: item.discountAmount,
            payableAmount: item.payableAmount
          }))
        },
        invoices: {
          create: invoices.map((invoice) => ({
            invoiceId: invoice.invoiceId,
            allocatedAmount: invoice.allocatedAmount,
            isCreditNote: invoice.isCreditNote
          }))
        }
      },
      include: {
        items: {
          include: { supplier: true }
        },
        invoices: {
          include: { invoice: true }
        }
      }
    });
  }

  listPaymentRuns(entityId: string, limit = 50) {
    return this.db.paymentRun.findMany({
      where: { entityId },
      take: limit,
      orderBy: [{ createdAt: "desc" }],
      include: {
        items: true,
        payments: true
      }
    });
  }

  getPaymentRun(entityId: string, paymentRunId: string) {
    return this.db.paymentRun.findFirst({
      where: { entityId, id: paymentRunId },
      include: {
        items: {
          include: {
            supplier: true
          }
        },
        invoices: {
          include: {
            invoice: {
              include: { supplier: true }
            }
          }
        },
        payments: true
      }
    });
  }

  updatePaymentRunStatus(
    entityId: string,
    paymentRunId: string,
    status: "PROPOSED" | "APPROVED" | "CONFIRMED" | "PROCESSED" | "FAILED" | "CANCELLED",
    actorId: string,
    actorField: "approvedById" | "confirmedById" | "createdById" = "approvedById"
  ) {
    return this.db.paymentRun.updateMany({
      where: { entityId, id: paymentRunId },
      data: {
        status,
        [actorField]: actorId
      }
    });
  }

  setPaymentRunFilePath(entityId: string, paymentRunId: string, bankFilePath: string) {
    return this.db.paymentRun.updateMany({
      where: { entityId, id: paymentRunId },
      data: { bankFilePath }
    });
  }

  createPaymentRecord(data: {
    entityId: string;
    supplierId: string;
    paymentRunId: string;
    paymentDate: Date;
    currency: string;
    amount: Prisma.Decimal;
    paymentMethod: "BANK_TRANSFER" | "CHEQUE" | "CARD" | "CASH";
    bankAccountId: string;
    reference: string;
    glJournalId?: string;
    status: string;
  }) {
    return this.db.aPPayment.create({
      data
    });
  }

  createPaymentAllocations(
    paymentId: string,
    allocations: Array<{ invoiceId: string; allocatedAmount: Prisma.Decimal }>
  ) {
    if (allocations.length === 0) {
      return Promise.resolve();
    }

    return this.db.aPPaymentAllocation.createMany({
      data: allocations.map((allocation) => ({
        paymentId,
        invoiceId: allocation.invoiceId,
        allocatedAmount: allocation.allocatedAmount
      }))
    });
  }

  setInvoicesPaid(entityId: string, invoiceIds: string[]) {
    if (invoiceIds.length === 0) {
      return Promise.resolve({ count: 0 });
    }

    return this.db.aPInvoice.updateMany({
      where: { entityId, id: { in: invoiceIds } },
      data: { status: "PAID" }
    });
  }

  createPostedJournalForPayment(
    entityId: string,
    actorUserId: string,
    paymentReference: string,
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
        reference: paymentReference,
        description,
        source: "AP",
        status: "POSTED",
        postedAt: new Date(),
        functionalCurrency: currency,
        createdById: actorUserId,
        approvedById: actorUserId,
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
      include: {
        lines: true
      }
    });
  }
}
