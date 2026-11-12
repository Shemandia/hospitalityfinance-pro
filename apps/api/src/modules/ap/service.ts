import { Prisma, PrismaClient } from "../../db/client.js";
import { setEntityDbContext, clearEntityDbContext } from "../../db/tenantContext.js";
import { getRequestContext } from "../../db/requestContext.js";
import { getStorageBackend } from "../../jobs/transfer-desk-storage.js";
import { ServiceError } from "../../shared/service-error.js";
import {
  resolveCurrencyDecimals,
  decimalsFor,
  formatAmountPlain,
  formatAmountSwift
} from "../../shared/currency-decimals.js";
import { resolveTaxAccountId } from "../tax/tax-posting.js";
import { APRepository } from "./repository.js";
import type {
  APInvoiceCreateInput,
  APInvoiceListQuery,
  APInvoiceUpdateInput,
  PaymentRunConfirmInput,
  PaymentRunProposalInput,
  SupplierCreateInput,
  SupplierUpdateInput
} from "./types.js";

// PO matching removed — handled by external Material Management system

type CandidateInvoice = Awaited<ReturnType<APRepository["listInvoicesForPaymentRun"]>>[number];
type PaymentRunDetail = NonNullable<Awaited<ReturnType<APRepository["getPaymentRun"]>>>;

type GroupProposal = {
  supplierId: string;
  supplierName: string;
  currency: string;
  invoices: CandidateInvoice[];
  grossAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  payableAmount: Prisma.Decimal;
  allocations: Array<{
    invoiceId: string;
    allocatedAmount: Prisma.Decimal;
    isCreditNote: boolean;
  }>;
};

type PaymentFileEntry = {
  supplierName: string;
  supplierCode: string;
  currency: string;
  amount: Prisma.Decimal;
  reference: string;
  /** Supplier bank details, parsed from Supplier.bankDetails JSON */
  supplierBankAccount: string;
  supplierBankName: string;
  supplierBankSwift: string;
  remittanceInfo: string;
};

/**
 * Parse the Supplier.bankDetails JSON column. Tolerates missing or partial
 * data — banks won't reject CSVs with empty cells, they just need the columns
 * present so the file matches the upload template.
 */
function readSupplierBankDetails(bankDetails: unknown): {
  accountNumber: string;
  bankName: string;
  swift: string;
} {
  if (!bankDetails || typeof bankDetails !== "object") {
    return { accountNumber: "", bankName: "", swift: "" };
  }
  const b = bankDetails as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = b[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return "";
  };
  return {
    accountNumber: pick("accountNumber", "account_number", "account", "iban"),
    bankName: pick("bankName", "bank_name", "bank"),
    swift: pick("swift", "swiftCode", "swift_code", "bic")
  };
}

export class APServiceError extends ServiceError {}

const PAYMENT_FILE_EXTENSIONS = new Set(["csv", "xml", "mt103"]);
const STORAGE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function normalizeStorageSegment(value: string, label: string): string {
  if (!STORAGE_SEGMENT_PATTERN.test(value)) {
    throw new APServiceError(
      "AP_PAYMENT_FILE_INVALID_STORAGE_KEY",
      `Invalid ${label} for payment file storage.`,
      422
    );
  }
  return value;
}

function normalizePaymentFileExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  if (!PAYMENT_FILE_EXTENSIONS.has(normalized)) {
    throw new APServiceError(
      "AP_PAYMENT_FILE_INVALID_EXTENSION",
      "Unsupported payment file extension.",
      422
    );
  }
  return normalized;
}

export function buildPaymentFileStorageKey(input: {
  tenantSlug: string;
  entityId: string;
  paymentRunId: string;
  extension: string;
}): string {
  const tenantSlug = normalizeStorageSegment(input.tenantSlug, "tenant slug");
  const entityId = normalizeStorageSegment(input.entityId, "entity id");
  const paymentRunId = normalizeStorageSegment(input.paymentRunId, "payment run id");
  const extension = normalizePaymentFileExtension(input.extension);
  return `payment-runs/${tenantSlug}/entities/${entityId}/runs/${paymentRunId}/bank-file.${extension}`;
}

export function validatePaymentFileStorageKey(
  storageKey: string,
  expected: { tenantSlug: string; entityId: string; paymentRunId: string }
): string {
  if (
    storageKey.includes("\\") ||
    storageKey.includes("..") ||
    storageKey.startsWith("/") ||
    storageKey.startsWith("./") ||
    /^[a-zA-Z]:/.test(storageKey) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(storageKey)
  ) {
    throw new APServiceError(
      "AP_PAYMENT_FILE_INVALID_STORAGE_KEY",
      "Payment file storage key is not safe.",
      403
    );
  }

  const extension = storageKey.split(".").pop() ?? "";
  const expectedKey = buildPaymentFileStorageKey({ ...expected, extension });
  if (storageKey !== expectedKey) {
    throw new APServiceError(
      "AP_PAYMENT_FILE_INVALID_STORAGE_KEY",
      "Payment file storage key does not match the requested payment run.",
      403
    );
  }
  return storageKey;
}

export function sanitizePaymentFileDownloadName(paymentRunId: string, extension: string): string {
  const safeRunId = paymentRunId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "payment-run";
  return `payment-run-${safeRunId}.${normalizePaymentFileExtension(extension)}`;
}

export function paymentFileContentType(storageKey: string): string {
  const extension = normalizePaymentFileExtension(storageKey.split(".").pop() ?? "");
  if (extension === "xml") return "application/xml";
  if (extension === "mt103") return "text/plain";
  return "text/csv";
}

export class APService {
  constructor(private readonly prisma: PrismaClient) {}

  private repository(client: PrismaClient | Prisma.TransactionClient) {
    return new APRepository(client);
  }

  private normalizeReferencePrefix(prefix: string): string {
    const normalized = prefix
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    return normalized.length > 0 ? normalized : "PAYRUN";
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * @param currencyDecimals Decimal places per currency, from the `currencies`
   *   registry. Every format previously hardcoded 2, so a zero-decimal currency
   *   such as TZS was written with phantom cents.
   */
  private buildPaymentFile(
    paymentRun: PaymentRunDetail,
    entries: PaymentFileEntry[],
    currencyDecimals: Map<string, number>
  ): { extension: string; content: string } {
    const plain = (entry: PaymentFileEntry) =>
      formatAmountPlain(entry.amount, decimalsFor(currencyDecimals, entry.currency));
    if (paymentRun.bankFileFormat === "CSV") {
      // Tanzanian-bank standard upload columns (Exim, CRDB, NMB use the same shape).
      const header = [
        "Payment Reference",
        "Supplier Name",
        "Supplier Bank Account",
        "Bank Name",
        "SWIFT/BIC",
        "Amount",
        "Currency",
        "Remittance Info"
      ].join(",");
      const escape = (field: string | number) => `"${String(field).replace(/"/g, '""')}"`;
      const rows = entries.map((entry) =>
        [
          entry.reference,
          entry.supplierName,
          entry.supplierBankAccount,
          entry.supplierBankName,
          entry.supplierBankSwift,
          plain(entry),
          entry.currency,
          entry.remittanceInfo
        ]
          .map(escape)
          .join(",")
      );
      return {
        extension: "csv",
        // CRLF for Windows-friendly bank portals
        content: [header, ...rows].join("\r\n") + "\r\n"
      };
    }

    if (paymentRun.bankFileFormat === "SWIFT_MT103") {
      const valueDate = new Date().toISOString().slice(2, 10).replace(/-/g, "");
      const blocks = entries.map((entry) => {
        const party = entry.supplierName.slice(0, 35);
        return [
          "{4:",
          `:20:${entry.reference}`,
          ":23B:CRED",
          `:32A:${valueDate}${entry.currency}${formatAmountSwift(
            entry.amount,
            decimalsFor(currencyDecimals, entry.currency)
          )}`,
          ":50K:/HFP-PAYMENTS",
          "HospitalityFinance Pro",
          `:59:/${entry.reference}`,
          party,
          `:70:Payment run ${paymentRun.id}`,
          "-}"
        ].join("\n");
      });

      return {
        extension: "mt103",
        content: blocks.join("\n")
      };
    }

    const now = new Date();
    const executionDate = now.toISOString().slice(0, 10);
    const controlSum = entries.reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
    // A pain.001 message carries one currency in practice; if entries somehow
    // span several, use the widest precision so the control sum cannot be
    // truncated below the transactions it totals.
    const controlSumDecimals = entries.reduce(
      (max, entry) => Math.max(max, decimalsFor(currencyDecimals, entry.currency)),
      0
    );
    const messageId = `PR-${paymentRun.id.slice(0, 8)}-${now.getTime()}`;

    const transactions = entries
      .map((entry, index) => {
        const instructionId = `${entry.reference}-${String(index + 1).padStart(3, "0")}`;
        return `
        <CdtTrfTxInf>
          <PmtId>
            <InstrId>${this.escapeXml(instructionId)}</InstrId>
            <EndToEndId>${this.escapeXml(entry.reference)}</EndToEndId>
          </PmtId>
          <Amt>
            <InstdAmt Ccy="${this.escapeXml(entry.currency)}">${plain(entry)}</InstdAmt>
          </Amt>
          <Cdtr>
            <Nm>${this.escapeXml(entry.supplierName.slice(0, 70))}</Nm>
          </Cdtr>
          <RmtInf>
            <Ustrd>Payment run ${this.escapeXml(paymentRun.id)}</Ustrd>
          </RmtInf>
        </CdtTrfTxInf>`.trim();
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${this.escapeXml(messageId)}</MsgId>
      <CreDtTm>${now.toISOString()}</CreDtTm>
      <NbOfTxs>${entries.length}</NbOfTxs>
      <CtrlSum>${formatAmountPlain(controlSum, controlSumDecimals)}</CtrlSum>
      <InitgPty>
        <Nm>HospitalityFinance Pro</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${this.escapeXml(`PMT-${paymentRun.id.slice(0, 12)}`)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <ReqdExctnDt>${executionDate}</ReqdExctnDt>
${transactions
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;

    return {
      extension: "xml",
      content: xml
    };
  }

  async listSuppliers(entityId: string) {
    return this.repository(this.prisma).listSuppliers(entityId);
  }

  async getSupplier(entityId: string, supplierId: string) {
    const supplier = await this.repository(this.prisma).getSupplier(entityId, supplierId);
    if (!supplier) {
      throw new APServiceError("AP_SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    }
    return supplier;
  }

  async createSupplier(entityId: string, input: SupplierCreateInput) {
    const existing = await this.repository(this.prisma).getSupplierByCode(entityId, input.code);
    if (existing) {
      throw new APServiceError(
        "AP_SUPPLIER_CODE_EXISTS",
        `Supplier code ${input.code} already exists.`,
        409
      );
    }
    return this.repository(this.prisma).createSupplier(entityId, input);
  }

  async updateSupplier(entityId: string, supplierId: string, input: SupplierUpdateInput) {
    await this.getSupplier(entityId, supplierId);
    if (input.code) {
      const existing = await this.repository(this.prisma).getSupplierByCode(entityId, input.code);
      if (existing && existing.id !== supplierId) {
        throw new APServiceError(
          "AP_SUPPLIER_CODE_EXISTS",
          `Supplier code ${input.code} already exists.`,
          409
        );
      }
    }

    const updated = await this.repository(this.prisma).updateSupplier(entityId, supplierId, input);
    if (updated.count === 0) {
      throw new APServiceError("AP_SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    }

    return this.getSupplier(entityId, supplierId);
  }

  async deleteSupplier(entityId: string, supplierId: string) {
    await this.getSupplier(entityId, supplierId);
    await this.repository(this.prisma).deleteSupplier(entityId, supplierId);
    return { id: supplierId, deleted: true };
  }

  async listInvoices(entityId: string, query: APInvoiceListQuery) {
    return this.repository(this.prisma).listInvoices(entityId, query);
  }

  async getInvoice(entityId: string, invoiceId: string) {
    const invoice = await this.repository(this.prisma).getInvoice(entityId, invoiceId);
    if (!invoice) {
      throw new APServiceError("AP_INVOICE_NOT_FOUND", "Invoice not found.", 404);
    }
    return invoice;
  }

  private validateInvoiceLineTotals(input: APInvoiceCreateInput | APInvoiceUpdateInput) {
    if (!input.lines || input.lines.length === 0) {
      return;
    }

    const total = input.lines.reduce((sum, line) => {
      return sum.add(new Prisma.Decimal(line.amount));
    }, new Prisma.Decimal(0));

    if ("netAmount" in input && input.netAmount) {
      const net = new Prisma.Decimal(input.netAmount);
      if (!total.toDecimalPlaces(4).equals(net.toDecimalPlaces(4))) {
        throw new APServiceError(
          "AP_INVOICE_LINE_TOTAL_MISMATCH",
          `Invoice line total ${total.toFixed(4)} does not equal net amount ${net.toFixed(4)}.`,
          422
        );
      }
    }

    // Cross-field: grossAmount must equal netAmount + taxAmount
    if (
      "grossAmount" in input &&
      input.grossAmount &&
      "netAmount" in input &&
      input.netAmount &&
      "taxAmount" in input &&
      input.taxAmount
    ) {
      const gross = new Prisma.Decimal(input.grossAmount);
      const net = new Prisma.Decimal(input.netAmount);
      const tax = new Prisma.Decimal(input.taxAmount);
      const expectedGross = net.add(tax);
      if (!expectedGross.toDecimalPlaces(4).equals(gross.toDecimalPlaces(4))) {
        throw new APServiceError(
          "AP_INVOICE_GROSS_MISMATCH",
          `grossAmount (${gross.toFixed(4)}) must equal netAmount (${net.toFixed(4)}) + taxAmount (${tax.toFixed(4)}) = ${expectedGross.toFixed(4)}.`,
          422
        );
      }
    }
  }

  async createInvoice(entityId: string, actorUserId: string | null, input: APInvoiceCreateInput) {
    await this.getSupplier(entityId, input.supplierId);
    const period = await this.repository(this.prisma).getPeriod(entityId, input.periodId);
    if (!period) {
      throw new APServiceError("AP_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    this.validateInvoiceLineTotals(input);
    const taxCodeIds = await this.resolveLineTaxCodes(entityId, input.lines);
    return this.repository(this.prisma).createInvoice(entityId, actorUserId, input, taxCodeIds);
  }

  /**
   * Resolves each line's tax code to the tenant's TaxCode row. Posting takes
   * the tax account from that row; a line that only carried the code as text
   * could never be posted. Returns one id (or null) per line, in order.
   */
  private async resolveLineTaxCodes(
    entityId: string,
    lines: ReadonlyArray<{ taxCode?: string }>
  ): Promise<Array<string | null>> {
    const codes = [...new Set(lines.flatMap((line) => (line.taxCode ? [line.taxCode] : [])))];
    if (codes.length === 0) return lines.map(() => null);

    const found = await this.repository(this.prisma).findTaxCodesByCode(entityId, codes);
    const idByCode = new Map(found.map((taxCode) => [taxCode.code, taxCode.id]));
    const unknown = codes.filter((code) => !idByCode.has(code));
    if (unknown.length > 0) {
      throw new APServiceError(
        "AP_TAX_CODE_NOT_FOUND",
        `Tax code(s) not defined for this entity: ${unknown.join(", ")}.`,
        422
      );
    }
    return lines.map((line) => (line.taxCode ? (idByCode.get(line.taxCode) ?? null) : null));
  }

  async submitSupplierInvoice(entityId: string, input: APInvoiceCreateInput) {
    return this.createInvoice(entityId, null, input);
  }

  async updateInvoice(entityId: string, invoiceId: string, input: APInvoiceUpdateInput) {
    const existing = await this.getInvoice(entityId, invoiceId);
    if (!["DRAFT", "DISPUTED", "PENDING_APPROVAL"].includes(existing.status)) {
      throw new APServiceError(
        "AP_INVOICE_LOCKED",
        "Only draft, disputed, or pending approval invoices can be updated.",
        409
      );
    }

    this.validateInvoiceLineTotals(input);
    const updated = await this.repository(this.prisma).updateInvoice(entityId, invoiceId, input);
    if (updated.count === 0) {
      throw new APServiceError("AP_INVOICE_NOT_FOUND", "Invoice not found.", 404);
    }

    return this.getInvoice(entityId, invoiceId);
  }

  async deleteInvoice(entityId: string, invoiceId: string) {
    const existing = await this.getInvoice(entityId, invoiceId);
    if (existing.status !== "DRAFT") {
      throw new APServiceError(
        "AP_INVOICE_NOT_DRAFT",
        "Only draft invoices can be cancelled.",
        409
      );
    }

    await this.repository(this.prisma).deleteInvoice(entityId, invoiceId);
    return { id: invoiceId, cancelled: true };
  }

  private async resolveJournalActorId(entityId: string, subject: string): Promise<string> {
    const directUser = await this.repository(this.prisma).findUserByIdOrKeycloak(subject);
    if (directUser) {
      return directUser.id;
    }

    const entityUser = await this.repository(this.prisma).findAnyEntityUser(entityId);
    if (entityUser) {
      return entityUser.userId;
    }

    throw new APServiceError(
      "AP_ACTOR_NOT_RESOLVED",
      "No valid accounting user found for journal posting.",
      422
    );
  }

  /**
   * Approve an AP invoice using a conditional update to prevent concurrent
   * double-approval or approve-during-post races.
   */
  async approveInvoice(entityId: string, invoiceId: string, approverSubject: string) {
    const invoice = await this.getInvoice(entityId, invoiceId);
    if (!["DRAFT", "PENDING_APPROVAL", "DISPUTED"].includes(invoice.status)) {
      throw new APServiceError(
        "AP_INVOICE_APPROVAL_INVALID_STATUS",
        `Invoice status ${invoice.status} cannot be approved.`,
        409
      );
    }

    const approverId = await this.resolveJournalActorId(entityId, approverSubject);

    // Conditional update: only succeeds if status is still one of the approvable states.
    // If another thread already changed the status, count will be 0.
    const result = await this.prisma.aPInvoice.updateMany({
      where: {
        id: invoiceId,
        entityId,
        status: { in: ["DRAFT", "PENDING_APPROVAL", "DISPUTED"] }
      },
      data: { status: "APPROVED", approvedById: approverId }
    });

    if (result.count === 0) {
      throw new APServiceError(
        "AP_INVOICE_STATUS_CHANGED",
        "Invoice status was changed by another user. Please refresh and try again.",
        409
      );
    }

    return this.getInvoice(entityId, invoiceId);
  }

  async postInvoice(entityId: string, invoiceId: string, actorSubject: string) {
    const actorId = await this.resolveJournalActorId(entityId, actorSubject);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setEntityDbContext(transaction, entityId);
        const repository = this.repository(transaction);

        // Lock the invoice row to prevent concurrent post/approve/cancel
        const [locked] = await transaction.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM ap_invoices
        WHERE id = ${invoiceId} AND entity_id = ${entityId}
        FOR UPDATE
      `;
        if (!locked) {
          throw new APServiceError("AP_INVOICE_NOT_FOUND", "Invoice not found.", 404);
        }

        if (locked.status !== "APPROVED") {
          throw new APServiceError(
            "AP_INVOICE_NOT_APPROVED",
            "Only approved invoices can be posted.",
            409
          );
        }

        // Now safe to read full invoice with relations (row is locked)
        const invoice = await repository.getInvoice(entityId, invoiceId);
        if (!invoice) {
          throw new APServiceError("AP_INVOICE_NOT_FOUND", "Invoice not found after lock.", 404);
        }

        if (invoice.period.status !== "OPEN") {
          throw new APServiceError(
            "AP_PERIOD_CLOSED",
            `Period ${invoice.period.name} is not open.`,
            422
          );
        }

        const apControl =
          // The account the tenant flagged as control comes first; the literal
          // code is only the fallback for charts that flag none (ACC-12).
          (await repository.getFallbackAPControlAccount(entityId)) ??
          (await repository.getAccountByCode(entityId, "2000"));
        if (!apControl) {
          throw new APServiceError(
            "AP_CONTROL_ACCOUNT_NOT_FOUND",
            "Accounts payable control account not configured.",
            422
          );
        }

        let lineNumber = 1;
        const journalLines: Array<{
          accountId: string;
          debit: Prisma.Decimal;
          credit: Prisma.Decimal;
          fxRate: Prisma.Decimal;
          lineNumber: number;
          description: string;
        }> = [];

        // Expense/asset lines. These sum to netAmount — createInvoice enforces
        // that the line total equals netAmount, and that gross = net + tax.
        const netDebit = invoice.lines.reduce((sum, line) => {
          if (!line.glAccountId) {
            throw new APServiceError(
              "AP_LINE_ACCOUNT_REQUIRED",
              `Invoice line ${line.id} missing GL account mapping.`,
              422
            );
          }

          const amount = new Prisma.Decimal(line.amount);
          journalLines.push({
            accountId: line.glAccountId,
            debit: amount,
            credit: new Prisma.Decimal(0),
            fxRate: new Prisma.Decimal(invoice.fxRate),
            lineNumber: lineNumber++,
            description: line.description
          });

          return sum.add(amount);
        }, new Prisma.Decimal(0));

        // Input tax. Previously invoice.taxAmount was simply discarded, so the
        // AP liability was understated by the tax and the supplier was later
        // underpaid by the same amount.
        const taxAmount = new Prisma.Decimal(invoice.taxAmount ?? 0);
        if (!taxAmount.isZero()) {
          const inputTaxAccountId = await resolveTaxAccountId(
            transaction,
            entityId,
            invoice.lines.map((line) => line.taxCodeId),
            "INPUT"
          );

          journalLines.push({
            accountId: inputTaxAccountId,
            debit: taxAmount,
            credit: new Prisma.Decimal(0),
            fxRate: new Prisma.Decimal(invoice.fxRate),
            lineNumber: lineNumber++,
            description: `Input tax for invoice ${invoice.invoiceNumber}`
          });
        }

        const totalDebit = netDebit.add(taxAmount);

        // The supplier is owed the gross amount, not the net.
        const grossAmount = new Prisma.Decimal(invoice.grossAmount);
        if (!grossAmount.toDecimalPlaces(4).equals(totalDebit.toDecimalPlaces(4))) {
          throw new APServiceError(
            "AP_INVOICE_TOTALS_INCONSISTENT",
            `Invoice gross amount ${grossAmount.toFixed(4)} does not equal lines + tax ` +
              `${totalDebit.toFixed(4)}.`,
            422
          );
        }

        journalLines.push({
          accountId: apControl.id,
          debit: new Prisma.Decimal(0),
          credit: grossAmount,
          fxRate: new Prisma.Decimal(invoice.fxRate),
          lineNumber: lineNumber++,
          description: `AP control for invoice ${invoice.invoiceNumber}`
        });

        const totalCredit = journalLines.reduce(
          (sum, line) => sum.add(line.credit),
          new Prisma.Decimal(0)
        );
        if (!totalDebit.toDecimalPlaces(4).equals(totalCredit.toDecimalPlaces(4))) {
          throw new APServiceError(
            "AP_POSTING_UNBALANCED",
            "Generated AP posting journal is unbalanced.",
            422
          );
        }

        const journal = await repository.createPostedJournalForInvoice(
          entityId,
          actorId,
          invoice.id,
          invoice.periodId,
          invoice.currency,
          `AP invoice ${invoice.invoiceNumber} posting`,
          journalLines
        );

        for (const line of journal.lines) {
          await repository.updateAccountBalance(
            entityId,
            line.accountId,
            invoice.periodId,
            line.debitFunctional,
            line.creditFunctional,
            line.account.type
          );
        }

        await repository.linkInvoiceJournal(entityId, invoice.id, journal.id);
        await repository.setInvoiceStatus(entityId, invoice.id, "POSTED", actorId);

        return repository.getInvoice(entityId, invoice.id);
      });
    } finally {
      clearEntityDbContext();
    }
  }

  async proposePaymentRun(entityId: string, actorSubject: string, input: PaymentRunProposalInput) {
    if (input.startDate > input.endDate) {
      throw new APServiceError(
        "AP_PAYMENT_RUN_INVALID_DATES",
        "startDate must be on or before endDate.",
        422
      );
    }

    const statuses: Array<"APPROVED" | "POSTED"> = [];
    if (input.includeApproved) {
      statuses.push("APPROVED");
    }
    if (input.includePosted) {
      statuses.push("POSTED");
    }
    if (statuses.length === 0) {
      throw new APServiceError(
        "AP_PAYMENT_RUN_NO_STATUSES",
        "At least one invoice status scope must be enabled.",
        422
      );
    }

    const actorId = await this.resolveJournalActorId(entityId, actorSubject);
    const invoices = await this.repository(this.prisma).listInvoicesForPaymentRun(
      entityId,
      input.startDate,
      input.endDate,
      statuses,
      input.supplierIds
    );

    if (invoices.length === 0) {
      throw new APServiceError(
        "AP_PAYMENT_RUN_NO_CANDIDATES",
        "No invoices match the payment run criteria.",
        404
      );
    }

    const grouped = new Map<string, GroupProposal>();
    for (const invoice of invoices) {
      const key = `${invoice.supplierId}::${invoice.currency}`;
      // Pay the gross amount. This previously used netAmount, so every
      // tax-bearing invoice underpaid the supplier by exactly the tax — the
      // AP control account was left permanently short and the remittance did
      // not match the supplier's own invoice total.
      const amount = new Prisma.Decimal(invoice.grossAmount);
      const isCreditNote = amount.lessThan(0);

      let group = grouped.get(key);
      if (!group) {
        group = {
          supplierId: invoice.supplierId,
          supplierName: invoice.supplier.name,
          currency: invoice.currency,
          invoices: [],
          grossAmount: new Prisma.Decimal(0),
          creditAmount: new Prisma.Decimal(0),
          discountAmount: new Prisma.Decimal(0),
          payableAmount: new Prisma.Decimal(0),
          allocations: []
        };
        grouped.set(key, group);
      }

      group.invoices.push(invoice);
      if (isCreditNote) {
        group.creditAmount = group.creditAmount.add(amount.abs());
      } else {
        group.grossAmount = group.grossAmount.add(amount);
      }
      group.payableAmount = group.payableAmount.add(amount);
      group.allocations.push({
        invoiceId: invoice.id,
        allocatedAmount: amount,
        isCreditNote
      });
    }

    const selectedGroups = Array.from(grouped.values()).filter((group) =>
      group.payableAmount.greaterThan(0)
    );

    if (selectedGroups.length === 0) {
      throw new APServiceError(
        "AP_PAYMENT_RUN_NON_POSITIVE",
        "Computed payable balances are not positive for any supplier.",
        422
      );
    }

    const items = selectedGroups.map((group) => ({
      supplierId: group.supplierId,
      currency: group.currency,
      invoiceCount: group.allocations.length,
      grossAmount: group.grossAmount.toDecimalPlaces(4),
      creditAmount: group.creditAmount.toDecimalPlaces(4),
      discountAmount: group.discountAmount.toDecimalPlaces(4),
      payableAmount: group.payableAmount.toDecimalPlaces(4)
    }));

    const runInvoices = selectedGroups.flatMap((group) =>
      group.allocations.map((allocation) => ({
        invoiceId: allocation.invoiceId,
        allocatedAmount: allocation.allocatedAmount.toDecimalPlaces(4),
        isCreditNote: allocation.isCreditNote
      }))
    );

    return this.repository(this.prisma).createPaymentRun(
      entityId,
      actorId,
      input,
      items,
      runInvoices
    );
  }

  async listPaymentRuns(entityId: string, limit?: number) {
    return this.repository(this.prisma).listPaymentRuns(entityId, limit ?? 50);
  }

  async getPaymentRun(entityId: string, paymentRunId: string) {
    const paymentRun = await this.repository(this.prisma).getPaymentRun(entityId, paymentRunId);
    if (!paymentRun) {
      throw new APServiceError("AP_PAYMENT_RUN_NOT_FOUND", "Payment run not found.", 404);
    }
    return paymentRun;
  }

  async getPaymentRunBankFile(
    entityId: string,
    paymentRunId: string
  ): Promise<{
    content: string;
    filename: string;
    contentType: string;
    storageKey: string;
  }> {
    const tenantSlug = getRequestContext().tenantSlug;
    if (!tenantSlug) {
      throw new APServiceError(
        "AP_PAYMENT_FILE_TENANT_CONTEXT_REQUIRED",
        "Tenant context is required to download payment files.",
        500
      );
    }

    const paymentRun = await this.getPaymentRun(entityId, paymentRunId);
    if (!paymentRun.bankFilePath) {
      throw new APServiceError(
        "AP_PAYMENT_FILE_NOT_FOUND",
        "No bank file is available for this payment run.",
        404
      );
    }

    const storageKey = validatePaymentFileStorageKey(paymentRun.bankFilePath, {
      tenantSlug,
      entityId,
      paymentRunId: paymentRun.id
    });

    try {
      const content = await getStorageBackend().read(storageKey);
      const extension = storageKey.split(".").pop() ?? "csv";
      return {
        content,
        filename: sanitizePaymentFileDownloadName(paymentRun.id, extension),
        contentType: paymentFileContentType(storageKey),
        storageKey
      };
    } catch {
      throw new APServiceError(
        "AP_PAYMENT_FILE_MISSING",
        "Payment file object is missing from storage.",
        404
      );
    }
  }

  async deletePaymentRun(entityId: string, paymentRunId: string) {
    const paymentRun = await this.getPaymentRun(entityId, paymentRunId);
    if (paymentRun.status !== "PROPOSED") {
      throw new APServiceError(
        "AP_PAYMENT_RUN_DELETE_INVALID_STATUS",
        `Only PROPOSED payment runs can be deleted. Current status: ${paymentRun.status}.`,
        409
      );
    }
    // Delete related items and invoices first, then the run
    await this.prisma.paymentRunInvoice.deleteMany({ where: { paymentRunId } });
    await this.prisma.paymentRunItem.deleteMany({ where: { paymentRunId } });
    await this.prisma.paymentRun.delete({ where: { id: paymentRunId } });
    return { deleted: true };
  }

  async approvePaymentRun(entityId: string, paymentRunId: string, approverSubject: string) {
    const approverId = await this.resolveJournalActorId(entityId, approverSubject);
    const paymentRun = await this.getPaymentRun(entityId, paymentRunId);
    if (paymentRun.status !== "PROPOSED") {
      throw new APServiceError(
        "AP_PAYMENT_RUN_APPROVAL_INVALID_STATUS",
        `Payment run status ${paymentRun.status} cannot be approved.`,
        409
      );
    }

    const updated = await this.repository(this.prisma).updatePaymentRunStatus(
      entityId,
      paymentRunId,
      "APPROVED",
      approverId
    );
    if (updated.count === 0) {
      throw new APServiceError("AP_PAYMENT_RUN_NOT_FOUND", "Payment run not found.", 404);
    }

    return this.getPaymentRun(entityId, paymentRunId);
  }

  async confirmPaymentRun(
    entityId: string,
    paymentRunId: string,
    confirmerSubject: string,
    input: PaymentRunConfirmInput
  ) {
    const confirmerId = await this.resolveJournalActorId(entityId, confirmerSubject);
    const currentRun = await this.getPaymentRun(entityId, paymentRunId);

    if (currentRun.status !== "APPROVED") {
      throw new APServiceError(
        "AP_PAYMENT_RUN_CONFIRM_INVALID_STATUS",
        `Payment run status ${currentRun.status} cannot be confirmed.`,
        409
      );
    }

    const repository = this.repository(this.prisma);
    const bankAccount = await repository.getAccountById(entityId, input.bankAccountId);
    if (!bankAccount || !bankAccount.allowPosting) {
      throw new APServiceError(
        "AP_PAYMENT_RUN_BANK_ACCOUNT_INVALID",
        "A valid posting bank account is required.",
        422
      );
    }

    const apControl =
      // The account the tenant flagged as control comes first; the literal
      // code is only the fallback for charts that flag none (ACC-12).
      (await repository.getFallbackAPControlAccount(entityId)) ??
      (await repository.getAccountByCode(entityId, "2000"));
    if (!apControl) {
      throw new APServiceError(
        "AP_CONTROL_ACCOUNT_NOT_FOUND",
        "Accounts payable control account not configured.",
        422
      );
    }

    const referencePrefix = this.normalizeReferencePrefix(input.referencePrefix);
    const entries: PaymentFileEntry[] = currentRun.items
      .filter((item) => new Prisma.Decimal(item.payableAmount).greaterThan(0))
      .map((item, index) => {
        const bank = readSupplierBankDetails(
          (item.supplier as { bankDetails?: unknown }).bankDetails
        );
        return {
          supplierName: item.supplier.name,
          supplierCode: item.supplier.code,
          currency: item.currency,
          amount: new Prisma.Decimal(item.payableAmount).toDecimalPlaces(2),
          reference: `${referencePrefix}-${currentRun.id.slice(0, 8)}-${String(index + 1).padStart(3, "0")}`,
          supplierBankAccount: bank.accountNumber,
          supplierBankName: bank.bankName,
          supplierBankSwift: bank.swift,
          remittanceInfo: `Payment for ${item.supplier.name} (${item.invoiceCount} invoices)`
        };
      });

    const currencyDecimals = await resolveCurrencyDecimals(
      this.prisma,
      entries.map((entry) => entry.currency)
    );
    const file = this.buildPaymentFile(currentRun, entries, currencyDecimals);
    const storage = getStorageBackend();
    const tenantSlug = getRequestContext().tenantSlug;
    if (!tenantSlug) {
      throw new APServiceError(
        "AP_PAYMENT_FILE_TENANT_CONTEXT_REQUIRED",
        "Tenant context is required to store payment files.",
        500
      );
    }
    const bankFileKey = buildPaymentFileStorageKey({
      tenantSlug,
      entityId,
      paymentRunId: currentRun.id,
      extension: file.extension
    });

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setEntityDbContext(transaction, entityId);
        const txRepository = this.repository(transaction);

        // Lock the payment run row to prevent double-confirmation
        const [lockedRun] = await transaction.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM payment_runs
        WHERE id = ${paymentRunId} AND entity_id = ${entityId}
        FOR UPDATE
      `;
        if (!lockedRun) {
          throw new APServiceError("AP_PAYMENT_RUN_NOT_FOUND", "Payment run not found.", 404);
        }
        if (lockedRun.status !== "APPROVED") {
          throw new APServiceError(
            "AP_PAYMENT_RUN_CONFIRM_INVALID_STATUS",
            `Payment run status ${lockedRun.status} cannot be confirmed.`,
            409
          );
        }

        // Safe to read full payment run with relations now (row is locked)
        const paymentRun = await txRepository.getPaymentRun(entityId, paymentRunId);
        if (!paymentRun) {
          throw new APServiceError(
            "AP_PAYMENT_RUN_NOT_FOUND",
            "Payment run not found after lock.",
            404
          );
        }

        const confirmed = await txRepository.updatePaymentRunStatus(
          entityId,
          paymentRunId,
          "CONFIRMED",
          confirmerId,
          "confirmedById"
        );
        if (confirmed.count === 0) {
          throw new APServiceError("AP_PAYMENT_RUN_NOT_FOUND", "Payment run not found.", 404);
        }

        await storage.write(bankFileKey, file.content);
        await txRepository.setPaymentRunFilePath(entityId, paymentRunId, bankFileKey);

        const invoiceGroups = new Map<
          string,
          Array<{
            invoiceId: string;
            allocatedAmount: Prisma.Decimal;
          }>
        >();

        for (const runInvoice of paymentRun.invoices) {
          const invoice = runInvoice.invoice;
          const key = `${invoice.supplierId}::${invoice.currency}`;
          const list = invoiceGroups.get(key) ?? [];
          list.push({
            invoiceId: invoice.id,
            allocatedAmount: new Prisma.Decimal(runInvoice.allocatedAmount)
          });
          invoiceGroups.set(key, list);
        }

        const paymentDate = new Date();
        const openPaymentPeriod = await txRepository.getOpenPeriodForDate(entityId, paymentDate);
        if (!openPaymentPeriod) {
          throw new APServiceError(
            "AP_PAYMENT_PERIOD_NOT_OPEN",
            "No open period exists for the payment date.",
            422
          );
        }

        // Fetch entity's functional currency for FX rate lookups
        const entity = await transaction.entity.findFirst({
          where: { id: entityId },
          select: { functionalCurrency: true }
        });
        const functionalCurrency = entity?.functionalCurrency ?? "USD";

        const paidInvoiceIds = new Set<string>();
        let sequence = 1;

        for (const item of paymentRun.items) {
          const payableAmount = new Prisma.Decimal(item.payableAmount);
          if (payableAmount.lessThanOrEqualTo(0)) {
            continue;
          }

          const key = `${item.supplierId}::${item.currency}`;
          const allocations = invoiceGroups.get(key) ?? [];
          if (allocations.length === 0) {
            throw new APServiceError(
              "AP_PAYMENT_RUN_ALLOCATION_MISSING",
              `No invoice allocations found for supplier ${item.supplierId}.`,
              422
            );
          }

          const reference = `${referencePrefix}-${paymentRun.id.slice(0, 8)}-${String(sequence).padStart(3, "0")}`;
          sequence += 1;

          // Look up spot FX rate if payment currency differs from functional currency
          let paymentFxRate = new Prisma.Decimal(1);
          if (item.currency !== functionalCurrency) {
            const spotRate = await transaction.fXRate.findFirst({
              where: {
                fromCurrency: item.currency,
                toCurrency: functionalCurrency,
                rateType: "SPOT"
              },
              orderBy: { effectiveDate: "desc" }
            });
            if (spotRate) {
              paymentFxRate = spotRate.rate;
            }
          }

          // Use the supplier's own GL account (e.g. CBORA001) if it exists,
          // otherwise fall back to the generic AP control account (2000).
          // SAF imports credit vendor accounts directly, so payment must debit the same account.
          const supplierGLAccount = await txRepository.getAccountByCode(
            entityId,
            item.supplier.code
          );
          const debitAccountId = supplierGLAccount?.id ?? apControl.id;

          const journal = await txRepository.createPostedJournalForPayment(
            entityId,
            confirmerId,
            reference,
            openPaymentPeriod.id,
            item.currency,
            `AP payment run ${paymentRun.id} - ${item.supplier.name}`,
            [
              {
                accountId: debitAccountId,
                debit: payableAmount,
                credit: new Prisma.Decimal(0),
                fxRate: paymentFxRate,
                lineNumber: 1,
                description: `Clear AP for ${item.supplier.name}`
              },
              {
                accountId: bankAccount.id,
                debit: new Prisma.Decimal(0),
                credit: payableAmount,
                fxRate: paymentFxRate,
                lineNumber: 2,
                description: `Disburse cash for ${item.supplier.name}`
              }
            ]
          );

          for (const line of journal.lines) {
            await txRepository.updateAccountBalance(
              entityId,
              line.accountId,
              openPaymentPeriod.id,
              line.debitFunctional,
              line.creditFunctional,
              line.account.type
            );
          }

          const payment = await txRepository.createPaymentRecord({
            entityId,
            supplierId: item.supplierId,
            paymentRunId: paymentRun.id,
            paymentDate,
            currency: item.currency,
            amount: payableAmount,
            paymentMethod: input.paymentMethod,
            bankAccountId: bankAccount.id,
            reference,
            glJournalId: journal.id,
            status: "PROCESSED"
          });

          const paymentAllocations = allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId,
            allocatedAmount: allocation.allocatedAmount
          }));
          await txRepository.createPaymentAllocations(payment.id, paymentAllocations);
          for (const allocation of paymentAllocations) {
            paidInvoiceIds.add(allocation.invoiceId);
          }
        }

        await txRepository.setInvoicesPaid(entityId, Array.from(paidInvoiceIds));
        await txRepository.updatePaymentRunStatus(
          entityId,
          paymentRun.id,
          "PROCESSED",
          confirmerId,
          "confirmedById"
        );

        const finalRun = await txRepository.getPaymentRun(entityId, paymentRun.id);
        if (!finalRun) {
          throw new APServiceError("AP_PAYMENT_RUN_NOT_FOUND", "Payment run not found.", 404);
        }
        return finalRun;
      });
    } finally {
      clearEntityDbContext();
    }
  }
}
