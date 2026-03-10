import { Prisma, PrismaClient } from "@prisma/client";
import { setEntityDbContext } from "../../db/tenantContext.js";
import { sendEmail } from "../../shared/email.js";
import { ARRepository } from "./repository.js";
import type {
  ARAllocationInput,
  ARInvoiceCreateInput,
  ARInvoiceListQuery,
  ARInvoiceUpdateInput,
  ARReceiptCreateInput,
  AgeingQuery,
  CustomerCreateInput,
  CustomerUpdateInput
} from "./types.js";

export class ARServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class ARService {
  constructor(private readonly prisma: PrismaClient) {}

  private repository(client: PrismaClient | Prisma.TransactionClient) {
    return new ARRepository(client);
  }

  // ── Customers ───────────────────────────────────────────────────────────────

  listCustomers(entityId: string) {
    return this.repository(this.prisma).listCustomers(entityId);
  }

  async getCustomer(entityId: string, customerId: string) {
    const customer = await this.repository(this.prisma).getCustomer(entityId, customerId);
    if (!customer) {
      throw new ARServiceError("AR_CUSTOMER_NOT_FOUND", "Customer not found.", 404);
    }
    return customer;
  }

  async createCustomer(entityId: string, input: CustomerCreateInput) {
    const existing = await this.repository(this.prisma).getCustomerByCode(entityId, input.code);
    if (existing) {
      throw new ARServiceError(
        "AR_CUSTOMER_CODE_EXISTS",
        `Customer code ${input.code} already exists.`,
        409
      );
    }
    return this.repository(this.prisma).createCustomer(entityId, input);
  }

  async updateCustomer(entityId: string, customerId: string, input: CustomerUpdateInput) {
    await this.getCustomer(entityId, customerId);
    if (input.code) {
      const existing = await this.repository(this.prisma).getCustomerByCode(entityId, input.code);
      if (existing && existing.id !== customerId) {
        throw new ARServiceError(
          "AR_CUSTOMER_CODE_EXISTS",
          `Customer code ${input.code} already exists.`,
          409
        );
      }
    }
    const updated = await this.repository(this.prisma).updateCustomer(entityId, customerId, input);
    if (updated.count === 0) {
      throw new ARServiceError("AR_CUSTOMER_NOT_FOUND", "Customer not found.", 404);
    }
    return this.getCustomer(entityId, customerId);
  }

  // ── Invoices ────────────────────────────────────────────────────────────────

  listInvoices(entityId: string, query: ARInvoiceListQuery) {
    return this.repository(this.prisma).listInvoices(entityId, query);
  }

  async getInvoice(entityId: string, invoiceId: string) {
    const invoice = await this.repository(this.prisma).getInvoice(entityId, invoiceId);
    if (!invoice) {
      throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
    }
    return invoice;
  }

  async createInvoice(entityId: string, input: ARInvoiceCreateInput) {
    await this.getCustomer(entityId, input.customerId);
    return this.repository(this.prisma).createInvoice(entityId, input);
  }

  async postInvoice(entityId: string, invoiceId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await setEntityDbContext(tx, entityId);
      const repository = this.repository(tx);
      const invoice = await repository.getInvoice(entityId, invoiceId);
      if (!invoice) {
        throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
      }
      if (invoice.status !== "DRAFT") {
        throw new ARServiceError(
          "AR_INVOICE_NOT_DRAFT",
          "Only draft invoices can be posted.",
          409
        );
      }

      const arControl =
        (await repository.getAccountByCode(entityId, "1200")) ??
        (await repository.getFallbackARControlAccount(entityId));
      if (!arControl) {
        throw new ARServiceError(
          "AR_CONTROL_ACCOUNT_NOT_FOUND",
          "AR receivable control account not configured. Create account code 1200.",
          422
        );
      }

      const revenueAccount = await repository.getAccountByCode(entityId, "4100");
      if (!revenueAccount) {
        throw new ARServiceError(
          "AR_REVENUE_ACCOUNT_NOT_FOUND",
          "Revenue account (4100) not configured.",
          422
        );
      }

      const period =
        (await repository.getOpenPeriodForDate(entityId, invoice.invoiceDate)) ??
        (await repository.getAnyOpenPeriod(entityId));
      if (!period) {
        throw new ARServiceError("AR_PERIOD_NOT_OPEN", "No open period available.", 422);
      }

      const amount = new Prisma.Decimal(invoice.amount);
      const fxRate = new Prisma.Decimal(invoice.fxRate);

      const journal = await repository.createPostedJournalForARInvoice(
        entityId,
        actorId,
        invoice.id,
        period.id,
        invoice.currency,
        `AR invoice ${invoice.invoiceNumber} - ${invoice.customer.name}`,
        [
          {
            accountId: arControl.id,
            debit: amount,
            credit: new Prisma.Decimal(0),
            fxRate,
            lineNumber: 1,
            description: `AR receivable for ${invoice.customer.name}`
          },
          {
            accountId: revenueAccount.id,
            debit: new Prisma.Decimal(0),
            credit: amount,
            fxRate,
            lineNumber: 2,
            description: `Revenue recognition for invoice ${invoice.invoiceNumber}`
          }
        ]
      );

      for (const line of journal.lines) {
        await repository.updateAccountBalance(
          entityId,
          line.accountId,
          period.id,
          line.debitFunctional,
          line.creditFunctional,
          line.account.type
        );
      }

      await repository.setInvoiceStatus(entityId, invoice.id, "POSTED", journal.id);
      return repository.getInvoice(entityId, invoice.id);
    });
  }

  async updateInvoice(entityId: string, invoiceId: string, input: ARInvoiceUpdateInput) {
    const invoice = await this.getInvoice(entityId, invoiceId);
    if (!["DRAFT", "OVERDUE"].includes(invoice.status)) {
      throw new ARServiceError(
        "AR_INVOICE_LOCKED",
        "Only draft or overdue invoices can be updated.",
        409
      );
    }
    await this.repository(this.prisma).updateInvoice(entityId, invoiceId, {
      ...(input.dueDate && { dueDate: input.dueDate }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.status && {
        status: input.status as "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED"
      })
    });
    return this.getInvoice(entityId, invoiceId);
  }

  // ── Receipts ────────────────────────────────────────────────────────────────

  listReceipts(entityId: string, customerId?: string) {
    return this.repository(this.prisma).listReceipts(entityId, customerId);
  }

  async getReceipt(entityId: string, receiptId: string) {
    const receipt = await this.repository(this.prisma).getReceipt(entityId, receiptId);
    if (!receipt) {
      throw new ARServiceError("AR_RECEIPT_NOT_FOUND", "Receipt not found.", 404);
    }
    return receipt;
  }

  async createReceipt(entityId: string, input: ARReceiptCreateInput) {
    await this.getCustomer(entityId, input.customerId);
    return this.repository(this.prisma).createReceipt(entityId, input);
  }

  // ── Allocation ───────────────────────────────────────────────────────────────

  async allocateReceipt(entityId: string, input: ARAllocationInput) {
    const receipt = await this.repository(this.prisma).getReceipt(entityId, input.receiptId);
    if (!receipt) {
      throw new ARServiceError("AR_RECEIPT_NOT_FOUND", "Receipt not found.", 404);
    }
    const invoice = await this.repository(this.prisma).getInvoice(entityId, input.invoiceId);
    if (!invoice) {
      throw new ARServiceError("AR_INVOICE_NOT_FOUND", "Invoice not found.", 404);
    }
    if (!["POSTED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status)) {
      throw new ARServiceError(
        "AR_INVOICE_NOT_ALLOCATABLE",
        "Invoice is not in a state that allows allocation.",
        409
      );
    }

    const allocatedAmount = new Prisma.Decimal(input.allocatedAmount);
    const outstanding = new Prisma.Decimal(invoice.amount).sub(new Prisma.Decimal(invoice.amountPaid));

    if (allocatedAmount.greaterThan(outstanding)) {
      throw new ARServiceError(
        "AR_ALLOCATION_EXCEEDS_OUTSTANDING",
        `Allocated amount ${allocatedAmount.toFixed(4)} exceeds outstanding balance ${outstanding.toFixed(4)}.`,
        422
      );
    }

    const allocation = await this.repository(this.prisma).createAllocation(input);
    const newAmountPaid = new Prisma.Decimal(invoice.amountPaid).add(allocatedAmount);
    const newStatus = newAmountPaid.greaterThanOrEqualTo(new Prisma.Decimal(invoice.amount))
      ? "PAID"
      : "PARTIALLY_PAID";

    await this.repository(this.prisma).updateInvoice(entityId, invoice.id, {
      amountPaid: newAmountPaid,
      status: newStatus as "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED"
    });

    return allocation;
  }

  // ── Ageing Report ─────────────────────────────────────────────────────────────

  async getAgeingReport(entityId: string, query: AgeingQuery) {
    const asOfDate = query.asOfDate ?? new Date();
    const rows = await this.repository(this.prisma).getAgeingReport(entityId, asOfDate);
    return {
      asOfDate,
      data: rows.map((row) => ({
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerCode: row.customer_code,
        currency: row.currency,
        bucket0to30: row.bucket_0_30.toString(),
        bucket31to60: row.bucket_31_60.toString(),
        bucket61to90: row.bucket_61_90.toString(),
        bucket91Plus: row.bucket_91_plus.toString(),
        totalOutstanding: row.total_outstanding.toString()
      }))
    };
  }

  // ── Dunning ───────────────────────────────────────────────────────────────────

  async runDunning(entityId: string) {
    const now = new Date();
    const invoices = await this.repository(this.prisma).listInvoices(entityId, {
      status: "OVERDUE",
      limit: 200
    });

    const sent: string[] = [];
    for (const invoice of invoices) {
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysToSend = [7, 14, 30];
      if (!daysToSend.includes(daysOverdue)) continue;

      const billingContact = invoice.customer.billingContact as Record<string, unknown> | null;
      const email = typeof billingContact?.email === "string" ? billingContact.email : null;
      if (!email) continue;

      await sendEmail({
        to: email,
        subject: `Payment reminder: Invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue`,
        html: `<p>Dear ${invoice.customer.name},</p>
<p>Invoice <strong>${invoice.invoiceNumber}</strong> for ${invoice.currency} ${invoice.amount} was due on ${new Date(invoice.dueDate).toDateString()}.</p>
<p>It is now <strong>${daysOverdue} days overdue</strong>. Please arrange payment at your earliest convenience.</p>
<p>HospitalityFinance Pro</p>`
      });
      sent.push(invoice.id);
    }

    return { dunningEmailsSent: sent.length, invoiceIds: sent };
  }
}
