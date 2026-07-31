import { Prisma, PrismaClient } from "../../db/client.js";
import { setEntityDbContext, clearEntityDbContext } from "../../db/tenantContext.js";
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

import { ServiceError } from "../../shared/service-error.js";
import { resolveTaxAccountId } from "../tax/tax-posting.js";

export class ARServiceError extends ServiceError {}

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

    // City ledger invoices from PMS should not be created manually without origin tag
    if (!input.origin || input.origin === "MANUAL") {
      console.info(
        `[ARService] Manual AR invoice creation for entity=${entityId}, invoice=${input.invoiceNumber}. ` +
          `Note: In hospitality, AR invoices typically originate from PMS city ledger.`
      );
    }

    return this.repository(this.prisma).createInvoice(entityId, input);
  }

  async postInvoice(entityId: string, invoiceId: string, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await setEntityDbContext(tx, entityId);
        const repository = this.repository(tx);
        // Lock the invoice row to prevent concurrent double-posting (SELECT FOR UPDATE)
        const [locked] = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`SELECT id, status FROM ar_invoices
        WHERE id = ${invoiceId} AND entity_id = ${entityId}
        FOR UPDATE`;
        if (!locked) {
          throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
        }
        if (locked.status !== "DRAFT") {
          throw new ARServiceError(
            "AR_INVOICE_NOT_DRAFT",
            "Only draft invoices can be posted.",
            409
          );
        }

        // Now fetch the full invoice with relations (already locked)
        const invoice = await repository.getInvoice(entityId, invoiceId);
        if (!invoice) {
          throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
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

        // `amount` is the gross the customer owes. Output tax must be split out
        // of it rather than credited to revenue: previously the whole invoice
        // was credited to 4100, overstating revenue by the VAT and making a VAT
        // return impossible to prepare.
        const amount = new Prisma.Decimal(invoice.amount);
        const taxAmount = new Prisma.Decimal((invoice as any).taxAmount ?? 0);
        const storedNet = new Prisma.Decimal((invoice as any).netAmount ?? 0);
        // Invoices created before tax tracking have netAmount backfilled to
        // amount, but guard anyway so a zero net can never wipe out revenue.
        const netAmount = storedNet.isZero() ? amount.sub(taxAmount) : storedNet;

        if (!netAmount.add(taxAmount).toDecimalPlaces(4).equals(amount.toDecimalPlaces(4))) {
          throw new ARServiceError(
            "AR_INVOICE_TOTALS_INCONSISTENT",
            `Invoice amount ${amount.toFixed(4)} does not equal net ${netAmount.toFixed(4)} + ` +
              `tax ${taxAmount.toFixed(4)}.`,
            422
          );
        }

        const fxRate = new Prisma.Decimal(invoice.fxRate);

        // Use invoice origin to determine the GL journal source:
        // PMS city-ledger invoices → source "PMS", POS → "POS", manual → "AR"
        const originToSource: Record<string, "AR" | "PMS" | "POS"> = {
          PMS: "PMS",
          POS: "POS",
          MANUAL: "AR"
        };
        const journalSource = originToSource[(invoice as any).origin ?? "MANUAL"] ?? "AR";

        const arJournalLines = [
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
            credit: netAmount,
            fxRate,
            lineNumber: 2,
            description: `Revenue recognition for invoice ${invoice.invoiceNumber}`
          }
        ];

        if (!taxAmount.isZero()) {
          const outputTaxAccountId = await resolveTaxAccountId(
            tx,
            entityId,
            [(invoice as any).taxCodeId],
            "OUTPUT"
          );

          arJournalLines.push({
            accountId: outputTaxAccountId,
            debit: new Prisma.Decimal(0),
            credit: taxAmount,
            fxRate,
            lineNumber: 3,
            description: `Output tax for invoice ${invoice.invoiceNumber}`
          });
        }

        const journal = await repository.createPostedJournalForARInvoice(
          entityId,
          actorId,
          invoice.id,
          period.id,
          invoice.currency,
          `AR invoice ${invoice.invoiceNumber} - ${invoice.customer.name}`,
          arJournalLines,
          journalSource
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
    } finally {
      clearEntityDbContext();
    }
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
        status: input.status as
          | "DRAFT"
          | "POSTED"
          | "PARTIALLY_PAID"
          | "PAID"
          | "OVERDUE"
          | "CANCELLED"
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

  /**
   * Create a receipt AND its GL journal atomically: debit cash/bank, credit the
   * AR control account. Without the journal the receivables and cash positions
   * never move when money is collected (AR-C1, audit 2026-07-08).
   */
  async createReceipt(entityId: string, input: ARReceiptCreateInput, actorId: string) {
    await this.getCustomer(entityId, input.customerId);

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new ARServiceError(
        "AR_RECEIPT_INVALID_AMOUNT",
        "Receipt amount must be greater than zero.",
        422
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await setEntityDbContext(tx, entityId);
        const repository = this.repository(tx);

        // Cash/bank GL account: the linked bank account's GL account, else code 1000.
        let cashAccountId: string | null = null;
        if (input.bankAccountId) {
          const bankAccount = await repository.getBankAccount(entityId, input.bankAccountId);
          if (!bankAccount) {
            throw new ARServiceError("AR_BANK_ACCOUNT_NOT_FOUND", "Bank account not found.", 404);
          }
          cashAccountId = bankAccount.glAccountId;
        }
        if (!cashAccountId) {
          const cashAccount = await repository.getAccountByCode(entityId, "1000");
          cashAccountId = cashAccount?.id ?? null;
        }
        if (!cashAccountId) {
          throw new ARServiceError(
            "AR_CASH_ACCOUNT_NOT_FOUND",
            "No cash/bank GL account available. Link the bank account to a GL account or create account code 1000.",
            422
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

        const period =
          (await repository.getOpenPeriodForDate(entityId, input.receiptDate)) ??
          (await repository.getAnyOpenPeriod(entityId));
        if (!period) {
          throw new ARServiceError("AR_PERIOD_NOT_OPEN", "No open period available.", 422);
        }

        // fxRate: explicit input, else 1 for functional-currency receipts, else latest SPOT rate.
        const currency = input.currency.toUpperCase();
        let fxRate = input.fxRate ? new Prisma.Decimal(input.fxRate) : null;
        if (!fxRate) {
          const entity = await repository.getEntityFunctionalCurrency(entityId);
          const functionalCurrency = entity?.functionalCurrency?.toUpperCase();
          if (!functionalCurrency || functionalCurrency === currency) {
            fxRate = new Prisma.Decimal(1);
          } else {
            const rate = await repository.getSpotFxRate(currency, functionalCurrency);
            if (!rate) {
              throw new ARServiceError(
                "AR_FX_RATE_NOT_FOUND",
                `No SPOT FX rate found for ${currency}→${functionalCurrency}. Provide fxRate or add a rate on the FX page.`,
                422
              );
            }
            fxRate = rate.rate;
          }
        }

        const receipt = await repository.createReceipt(entityId, input);

        const journal = await repository.createPostedJournalForARReceipt(
          entityId,
          actorId,
          receipt.id,
          period.id,
          currency,
          `AR receipt ${input.reference ?? receipt.id.slice(0, 8)} - ${receipt.customer.name}`,
          [
            {
              accountId: cashAccountId,
              debit: amount,
              credit: new Prisma.Decimal(0),
              fxRate,
              lineNumber: 1,
              description: `Cash received from ${receipt.customer.name}`
            },
            {
              accountId: arControl.id,
              debit: new Prisma.Decimal(0),
              credit: amount,
              fxRate,
              lineNumber: 2,
              description: `AR control relief for receipt from ${receipt.customer.name}`
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

        await repository.setReceiptGlJournal(entityId, receipt.id, journal.id);
        return repository.getReceipt(entityId, receipt.id);
      });
    } finally {
      clearEntityDbContext();
    }
  }

  // ── Allocation ───────────────────────────────────────────────────────────────

  /**
   * Allocate a receipt to an invoice within a transaction.
   * Uses SELECT FOR UPDATE on the invoice row to prevent concurrent
   * over-allocation (two allocations exceeding the outstanding balance).
   */
  async allocateReceipt(entityId: string, input: ARAllocationInput) {
    const allocatedAmount = new Prisma.Decimal(input.allocatedAmount);
    if (allocatedAmount.lessThanOrEqualTo(0)) {
      throw new ARServiceError(
        "AR_ALLOCATION_INVALID_AMOUNT",
        "Allocated amount must be greater than zero.",
        422
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const repo = this.repository(tx);

      // Lock the receipt row so concurrent allocations cannot jointly exceed
      // the receipt amount (lock order: receipt, then invoice — keep consistent).
      const [lockedReceipt] = await tx.$queryRaw<Array<{ id: string; amount: string }>>`
        SELECT id, amount::text
        FROM ar_receipts
        WHERE id = ${input.receiptId} AND entity_id = ${entityId}
        FOR UPDATE
      `;
      if (!lockedReceipt) {
        throw new ARServiceError("AR_RECEIPT_NOT_FOUND", "Receipt not found.", 404);
      }

      const allocatedSoFar = await repo.sumReceiptAllocations(input.receiptId);
      const receiptUnallocated = new Prisma.Decimal(lockedReceipt.amount).sub(
        new Prisma.Decimal(allocatedSoFar._sum.allocatedAmount ?? 0)
      );
      if (allocatedAmount.greaterThan(receiptUnallocated)) {
        throw new ARServiceError(
          "AR_ALLOCATION_EXCEEDS_RECEIPT",
          `Allocated amount ${allocatedAmount.toFixed(4)} exceeds the receipt's unallocated balance ${receiptUnallocated.toFixed(4)}.`,
          422
        );
      }

      // Lock the invoice row to prevent concurrent allocations
      const [locked] = await tx.$queryRaw<
        Array<{ id: string; status: string; amount: string; amount_paid: string }>
      >`
        SELECT id, status, amount::text, amount_paid::text
        FROM ar_invoices
        WHERE id = ${input.invoiceId} AND entity_id = ${entityId}
        FOR UPDATE
      `;
      if (!locked) {
        throw new ARServiceError("AR_INVOICE_NOT_FOUND", "Invoice not found.", 404);
      }
      if (!["POSTED", "PARTIALLY_PAID", "OVERDUE"].includes(locked.status)) {
        throw new ARServiceError(
          "AR_INVOICE_NOT_ALLOCATABLE",
          "Invoice is not in a state that allows allocation.",
          409
        );
      }

      const outstanding = new Prisma.Decimal(locked.amount).sub(
        new Prisma.Decimal(locked.amount_paid)
      );

      if (allocatedAmount.greaterThan(outstanding)) {
        throw new ARServiceError(
          "AR_ALLOCATION_EXCEEDS_OUTSTANDING",
          `Allocated amount ${allocatedAmount.toFixed(4)} exceeds outstanding balance ${outstanding.toFixed(4)}.`,
          422
        );
      }

      const allocation = await repo.createAllocation(input);
      const newAmountPaid = new Prisma.Decimal(locked.amount_paid).add(allocatedAmount);
      const newStatus = newAmountPaid.greaterThanOrEqualTo(new Prisma.Decimal(locked.amount))
        ? "PAID"
        : "PARTIALLY_PAID";

      await repo.updateInvoice(entityId, locked.id, {
        amountPaid: newAmountPaid,
        status: newStatus as
          | "DRAFT"
          | "POSTED"
          | "PARTIALLY_PAID"
          | "PAID"
          | "OVERDUE"
          | "CANCELLED"
      });

      return allocation;
    });
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
      // Use range-based checks so a missed day does not permanently skip a reminder
      let dunningLevel: number | null = null;
      if (daysOverdue >= 30) dunningLevel = 30;
      else if (daysOverdue >= 14) dunningLevel = 14;
      else if (daysOverdue >= 7) dunningLevel = 7;
      if (dunningLevel === null) continue;
      // Skip if this dunning level was already sent (tracked via lastDunningLevel on invoice)
      if ((invoice as any).lastDunningLevel >= dunningLevel) continue;

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
      // Track dunning level so we don't re-send the same tier
      // Note: also missing entity_id filter — see audit HIGH-7. Adding it now.
      await this.prisma.$executeRaw`
        UPDATE ar_invoices SET last_dunning_level = ${dunningLevel} WHERE id = ${invoice.id} AND entity_id = ${entityId}
      `.catch(() => {
        /* column may not exist yet — requires migration */
      });
      sent.push(invoice.id);
    }

    return { dunningEmailsSent: sent.length, invoiceIds: sent };
  }
}
