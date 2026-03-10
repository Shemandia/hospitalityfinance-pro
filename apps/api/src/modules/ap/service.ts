import { Prisma, PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setEntityDbContext } from "../../db/tenantContext.js";
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

type MatchStatus = "MATCH" | "PARTIAL_MATCH" | "MISMATCH";

type MatchResult = {
  status: MatchStatus;
  tolerancePct: number;
  lineComparisons: Array<{
    invoiceLineId: string;
    invoiceAmount: string;
    expectedAmount: string;
    variancePct: string;
    withinTolerance: boolean;
    note?: string;
  }>;
};

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
  currency: string;
  amount: Prisma.Decimal;
  reference: string;
};

export class APServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class APService {
  constructor(private readonly prisma: PrismaClient) {}

  private repository(client: PrismaClient | Prisma.TransactionClient) {
    return new APRepository(client);
  }

  private normalizeReferencePrefix(prefix: string): string {
    const normalized = prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
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

  private formatSwiftAmount(amount: Prisma.Decimal): string {
    return amount.toDecimalPlaces(2).toFixed(2).replace(".", ",");
  }

  private buildPaymentFile(
    paymentRun: PaymentRunDetail,
    entries: PaymentFileEntry[]
  ): { extension: string; content: string } {
    if (paymentRun.bankFileFormat === "CSV") {
      const header = "supplier,currency,amount,reference";
      const rows = entries.map((entry) =>
        [
          entry.supplierName,
          entry.currency,
          entry.amount.toDecimalPlaces(2).toFixed(2),
          entry.reference
        ]
          .map((field) => `"${String(field).replace(/"/g, '""')}"`)
          .join(",")
      );
      return {
        extension: "csv",
        content: [header, ...rows].join("\n")
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
          `:32A:${valueDate}${entry.currency}${this.formatSwiftAmount(entry.amount)}`,
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
            <InstdAmt Ccy="${this.escapeXml(entry.currency)}">${entry.amount
              .toDecimalPlaces(2)
              .toFixed(2)}</InstdAmt>
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
      <CtrlSum>${controlSum.toDecimalPlaces(2).toFixed(2)}</CtrlSum>
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
    const existing = await this.repository(this.prisma).getSupplierByCode(
      entityId,
      input.code
    );
    if (existing) {
      throw new APServiceError(
        "AP_SUPPLIER_CODE_EXISTS",
        `Supplier code ${input.code} already exists.`,
        409
      );
    }
    return this.repository(this.prisma).createSupplier(entityId, input);
  }

  async updateSupplier(
    entityId: string,
    supplierId: string,
    input: SupplierUpdateInput
  ) {
    await this.getSupplier(entityId, supplierId);
    if (input.code) {
      const existing = await this.repository(this.prisma).getSupplierByCode(
        entityId,
        input.code
      );
      if (existing && existing.id !== supplierId) {
        throw new APServiceError(
          "AP_SUPPLIER_CODE_EXISTS",
          `Supplier code ${input.code} already exists.`,
          409
        );
      }
    }

    const updated = await this.repository(this.prisma).updateSupplier(
      entityId,
      supplierId,
      input
    );
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
  }

  async createInvoice(
    entityId: string,
    actorUserId: string | null,
    input: APInvoiceCreateInput
  ) {
    await this.getSupplier(entityId, input.supplierId);
    const period = await this.repository(this.prisma).getPeriod(entityId, input.periodId);
    if (!period) {
      throw new APServiceError("AP_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    this.validateInvoiceLineTotals(input);
    return this.repository(this.prisma).createInvoice(entityId, actorUserId, input);
  }

  async submitSupplierInvoice(entityId: string, input: APInvoiceCreateInput) {
    return this.createInvoice(entityId, null, input);
  }

  async updateInvoice(
    entityId: string,
    invoiceId: string,
    input: APInvoiceUpdateInput
  ) {
    const existing = await this.getInvoice(entityId, invoiceId);
    if (!["DRAFT", "DISPUTED", "PENDING_APPROVAL"].includes(existing.status)) {
      throw new APServiceError(
        "AP_INVOICE_LOCKED",
        "Only draft, disputed, or pending approval invoices can be updated.",
        409
      );
    }

    this.validateInvoiceLineTotals(input);
    const updated = await this.repository(this.prisma).updateInvoice(
      entityId,
      invoiceId,
      input
    );
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

  async matchInvoiceToPO(
    entityId: string,
    invoiceId: string,
    tolerancePct = Number(process.env.AP_MATCH_TOLERANCE_PCT ?? "2")
  ): Promise<MatchResult> {
    const invoice = await this.getInvoice(entityId, invoiceId);
    if (!invoice.purchaseOrder) {
      return {
        status: "MISMATCH",
        tolerancePct,
        lineComparisons: invoice.lines.map((line) => ({
          invoiceLineId: line.id,
          invoiceAmount: line.amount.toFixed(4),
          expectedAmount: "0.0000",
          variancePct: "100.0000",
          withinTolerance: false,
          note: "No purchase order linked."
        }))
      };
    }

    const poLines = [...invoice.purchaseOrder.lines];
    const receivedByPoLineId = new Map<string, Prisma.Decimal>();

    for (const grn of invoice.purchaseOrder.goodsReceivedNotes) {
      for (const line of grn.lines) {
        const current = receivedByPoLineId.get(line.purchaseOrderLineId) ?? new Prisma.Decimal(0);
        receivedByPoLineId.set(
          line.purchaseOrderLineId,
          current.add(new Prisma.Decimal(line.amountReceived))
        );
      }
    }

    const lineComparisons = invoice.lines.map((line, index) => {
      const poLine = poLines[index];
      if (!poLine) {
        return {
          invoiceLineId: line.id,
          invoiceAmount: line.amount.toFixed(4),
          expectedAmount: "0.0000",
          variancePct: "100.0000",
          withinTolerance: false,
          note: "No corresponding PO line found."
        };
      }

      const poAmount = new Prisma.Decimal(poLine.amount);
      const receivedAmount = receivedByPoLineId.get(poLine.id) ?? poAmount;
      const expectedAmount = Prisma.Decimal.min(poAmount, receivedAmount);
      const variance = new Prisma.Decimal(line.amount).sub(expectedAmount).abs();
      const variancePct = expectedAmount.equals(0)
        ? new Prisma.Decimal(100)
        : variance.div(expectedAmount).mul(100);
      const withinTolerance = variancePct.lessThanOrEqualTo(tolerancePct);

      return {
        invoiceLineId: line.id,
        invoiceAmount: line.amount.toFixed(4),
        expectedAmount: expectedAmount.toFixed(4),
        variancePct: variancePct.toFixed(4),
        withinTolerance
      };
    });

    const matchedCount = lineComparisons.filter((line) => line.withinTolerance).length;
    const status: MatchStatus =
      matchedCount === lineComparisons.length
        ? "MATCH"
        : matchedCount > 0
          ? "PARTIAL_MATCH"
          : "MISMATCH";

    return {
      status,
      tolerancePct,
      lineComparisons
    };
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
    await this.repository(this.prisma).setInvoiceStatus(
      entityId,
      invoiceId,
      "APPROVED",
      approverId
    );

    return this.getInvoice(entityId, invoiceId);
  }

  async postInvoice(entityId: string, invoiceId: string, actorSubject: string) {
    const actorId = await this.resolveJournalActorId(entityId, actorSubject);

    return this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const repository = this.repository(transaction);
      const invoice = await repository.getInvoice(entityId, invoiceId);
      if (!invoice) {
        throw new APServiceError("AP_INVOICE_NOT_FOUND", "Invoice not found.", 404);
      }

      if (invoice.status !== "APPROVED") {
        throw new APServiceError(
          "AP_INVOICE_NOT_APPROVED",
          "Only approved invoices can be posted.",
          409
        );
      }

      if (invoice.period.status !== "OPEN") {
        throw new APServiceError(
          "AP_PERIOD_CLOSED",
          `Period ${invoice.period.name} is not open.`,
          422
        );
      }

      const apControl =
        (await repository.getAccountByCode(entityId, "2000")) ??
        (await repository.getFallbackAPControlAccount(entityId));
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

      const totalDebit = invoice.lines.reduce((sum, line) => {
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

      journalLines.push({
        accountId: apControl.id,
        debit: new Prisma.Decimal(0),
        credit: totalDebit,
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
          line.creditFunctional
        );
      }

      await repository.linkInvoiceJournal(entityId, invoice.id, journal.id);
      await repository.setInvoiceStatus(entityId, invoice.id, "POSTED", actorId);

      return repository.getInvoice(entityId, invoice.id);
    });
  }

  async proposePaymentRun(
    entityId: string,
    actorSubject: string,
    input: PaymentRunProposalInput
  ) {
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
      const amount = new Prisma.Decimal(invoice.netAmount);
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

    return this.repository(this.prisma).createPaymentRun(entityId, actorId, input, items, runInvoices);
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
      (await repository.getAccountByCode(entityId, "2000")) ??
      (await repository.getFallbackAPControlAccount(entityId));
    if (!apControl) {
      throw new APServiceError(
        "AP_CONTROL_ACCOUNT_NOT_FOUND",
        "Accounts payable control account not configured.",
        422
      );
    }

    const referencePrefix = this.normalizeReferencePrefix(input.referencePrefix);
    const entries = currentRun.items
      .filter((item) => new Prisma.Decimal(item.payableAmount).greaterThan(0))
      .map((item, index) => ({
        supplierName: item.supplier.name,
        currency: item.currency,
        amount: new Prisma.Decimal(item.payableAmount).toDecimalPlaces(2),
        reference: `${referencePrefix}-${currentRun.id.slice(0, 8)}-${String(index + 1).padStart(3, "0")}`
      }));

    const file = this.buildPaymentFile(currentRun, entries);
    const outputDir = join(process.cwd(), process.env.PAYMENT_RUN_OUTPUT_DIR ?? "payment-runs");
    await mkdir(outputDir, { recursive: true });
    const bankFilePath = join(outputDir, `${currentRun.id}.${file.extension}`);
    await writeFile(bankFilePath, file.content, "utf8");

    return this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const txRepository = this.repository(transaction);
      const paymentRun = await txRepository.getPaymentRun(entityId, paymentRunId);
      if (!paymentRun) {
        throw new APServiceError("AP_PAYMENT_RUN_NOT_FOUND", "Payment run not found.", 404);
      }
      if (paymentRun.status !== "APPROVED") {
        throw new APServiceError(
          "AP_PAYMENT_RUN_CONFIRM_INVALID_STATUS",
          `Payment run status ${paymentRun.status} cannot be confirmed.`,
          409
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

      await txRepository.setPaymentRunFilePath(entityId, paymentRunId, bankFilePath);

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

        // Use the supplier's own GL account (e.g. CBORA001) if it exists,
        // otherwise fall back to the generic AP control account (2000).
        // SAF imports credit vendor accounts directly, so payment must debit the same account.
        const supplierGLAccount = await txRepository.getAccountByCode(entityId, item.supplier.code);
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
              fxRate: new Prisma.Decimal(1),
              lineNumber: 1,
              description: `Clear AP for ${item.supplier.name}`
            },
            {
              accountId: bankAccount.id,
              debit: new Prisma.Decimal(0),
              credit: payableAmount,
              fxRate: new Prisma.Decimal(1),
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
            line.creditFunctional
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
  }
}
