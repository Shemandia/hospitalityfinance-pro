/**
 * Payroll Integration Service
 *
 * Processes payroll journal batches from external HR/payroll systems and
 * creates GL journals.
 *
 * Typical payroll journal structure (hospitality):
 *
 *   DR  6100  Rooms Payroll Expense        50,000
 *   DR  6200  F&B Payroll Expense          35,000
 *   DR  7100  A&G Payroll Expense          20,000
 *   DR  6150  Employer Social Security      8,400
 *   DR  6160  Employer Pension              5,250
 *       CR  2400  Salaries Payable                   78,750
 *       CR  2410  PAYE Income Tax Payable            15,750
 *       CR  2420  Social Security Payable            12,600
 *       CR  2430  Pension Payable                     7,350
 *       CR  2440  Health Insurance Payable            4,200
 */

import { Prisma, type PrismaClient } from "../../../../db/client.js";
import * as XLSX from "xlsx";
import type { PayrollBatch, PayrollImportResult, PayrollRun } from "./payroll-types.js";

import { applyBalanceDelta } from "../../../../db/balance-writer.js";
export class PayrollServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Batch import via API ────────────────────────────────────────────────────

export async function importPayrollBatch(
  prisma: PrismaClient,
  entityId: string,
  batch: PayrollBatch
): Promise<PayrollImportResult> {
  const result: PayrollImportResult = {
    batchRef: batch.batchRef,
    sourceSystem: batch.sourceSystem,
    created: 0,
    skipped: 0,
    errors: [],
    journalIds: [],
    duplicateRefs: []
  };

  // Get entity user for journal creation
  const entityUser = await prisma.entityUser.findFirst({
    where: { entityId },
    include: { user: true }
  });
  if (!entityUser) {
    throw new PayrollServiceError("PAYROLL_NO_USER", "No entity user found.", 422);
  }

  // Get entity functional currency
  const entity = await prisma.entity.findUniqueOrThrow({
    where: { id: entityId },
    select: { functionalCurrency: true }
  });

  for (let i = 0; i < batch.runs.length; i++) {
    const run = batch.runs[i];
    try {
      const journalId = await processPayrollRun(
        prisma,
        entityId,
        entityUser.userId,
        entity.functionalCurrency,
        run,
        batch.sourceSystem,
        batch.batchRef,
        batch.autoPost
      );

      if (journalId === null) {
        result.skipped++;
        result.duplicateRefs.push(run.reference);
      } else {
        result.created++;
        result.journalIds.push(journalId);
      }
    } catch (error) {
      result.errors.push({
        index: i,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Create import log
  await prisma.importLog.create({
    data: {
      entityId,
      connectorType: "PAYROLL",
      businessDate: new Date(batch.runs[0]?.postingDate ?? new Date()),
      status: result.errors.length > 0 ? "PARTIAL" : "SUCCESS",
      recordsTotal: batch.runs.length,
      recordsImported: result.created,
      recordsFailed: result.errors.length,
      errorDetails: {
        batchRef: batch.batchRef,
        sourceSystem: batch.sourceSystem,
        errors: result.errors
      } as Prisma.InputJsonValue
    }
  });

  return result;
}

// ── Process single payroll run ──────────────────────────────────────────────

async function processPayrollRun(
  prisma: PrismaClient,
  entityId: string,
  createdById: string,
  functionalCurrency: string,
  run: PayrollRun,
  sourceSystem: string,
  batchRef: string,
  autoPost: boolean
): Promise<string | null> {
  // Idempotency: check if journal with this reference already exists
  const existing = await prisma.journal.findFirst({
    where: { entityId, reference: `PAYROLL-${sourceSystem}-${run.reference}` },
    select: { id: true }
  });
  if (existing) return null; // duplicate

  // Validate balance
  let totalDebits = new Prisma.Decimal(0);
  let totalCredits = new Prisma.Decimal(0);
  for (const line of run.lines) {
    totalDebits = totalDebits.add(new Prisma.Decimal(line.debit));
    totalCredits = totalCredits.add(new Prisma.Decimal(line.credit));
  }
  if (!totalDebits.equals(totalCredits)) {
    throw new PayrollServiceError(
      "PAYROLL_UNBALANCED",
      `Payroll run ${run.reference} is unbalanced: DR ${totalDebits.toFixed(2)} ≠ CR ${totalCredits.toFixed(2)}`,
      422
    );
  }

  // Resolve period
  const postingDate = new Date(run.postingDate);
  const period = await prisma.period.findFirst({
    where: {
      entityId,
      status: "OPEN",
      year: postingDate.getFullYear(),
      month: postingDate.getMonth() + 1
    }
  });
  if (!period) {
    throw new PayrollServiceError(
      "PAYROLL_NO_PERIOD",
      `No open period for ${run.postingDate}`,
      422
    );
  }

  // Resolve account codes → IDs
  const accountCodes = [...new Set(run.lines.map((l) => l.accountCode))];
  const accounts = await prisma.account.findMany({
    where: { entityId, code: { in: accountCodes }, isActive: true },
    select: { id: true, code: true, type: true }
  });
  const codeToAccount = new Map(accounts.map((a) => [a.code, a]));

  // Check for unmapped codes
  const unmapped = accountCodes.filter((c) => !codeToAccount.has(c));

  // Try ConnectorMapping fallback for unmapped codes
  if (unmapped.length > 0) {
    const mappings = await prisma.connectorMapping.findMany({
      where: { entityId, connectorType: "PAYROLL", sourceCode: { in: unmapped } },
      include: { glAccount: true }
    });
    for (const m of mappings) {
      if (m.glAccount) {
        codeToAccount.set(m.sourceCode, {
          id: m.glAccount.id,
          code: m.glAccount.code,
          type: m.glAccount.type
        });
      }
    }
  }

  // Final unmapped check
  const stillUnmapped = accountCodes.filter((c) => !codeToAccount.has(c));
  if (stillUnmapped.length > 0) {
    throw new PayrollServiceError(
      "PAYROLL_UNMAPPED_ACCOUNTS",
      `Unmapped account codes: ${stillUnmapped.join(", ")}. Add them to Chart of Accounts or Connector Mappings.`,
      422
    );
  }

  // FX rate
  const runCurrency = run.currency.toUpperCase();
  const funcCcy = functionalCurrency.toUpperCase();
  let fxRate = new Prisma.Decimal(1);
  if (runCurrency !== funcCcy) {
    const rateRec = await prisma.fXRate.findFirst({
      where: { fromCurrency: runCurrency, toCurrency: funcCcy, rateType: "SPOT" },
      orderBy: { effectiveDate: "desc" }
    });
    if (!rateRec) {
      throw new PayrollServiceError(
        "PAYROLL_NO_FX_RATE",
        `No SPOT FX rate for ${runCurrency}→${funcCcy}`,
        422
      );
    }
    fxRate = rateRec.rate;
  }

  // Build journal lines
  const journalLines = run.lines.map((line, idx) => {
    const account = codeToAccount.get(line.accountCode)!;
    const debit = new Prisma.Decimal(line.debit);
    const credit = new Prisma.Decimal(line.credit);
    return {
      accountId: account.id,
      debit,
      credit,
      currency: runCurrency,
      fxRate,
      debitFunctional: debit.mul(fxRate),
      creditFunctional: credit.mul(fxRate),
      description: line.description ?? `${line.accountCode} — ${run.reference}`,
      lineNumber: idx + 1
    };
  });

  // Create journal
  const status = autoPost ? "POSTED" : "DRAFT";
  const journal = await prisma.journal.create({
    data: {
      entityId,
      periodId: period.id,
      reference: `PAYROLL-${sourceSystem}-${run.reference}`,
      description: run.description ?? `Payroll journal ${run.reference} from ${sourceSystem}`,
      source: "PAYROLL",
      status,
      functionalCurrency: funcCcy,
      createdById,
      ...(autoPost ? { postedAt: new Date() } : {}),
      lines: { create: journalLines }
    },
    include: { lines: true }
  });

  // Update balances if auto-posted
  if (autoPost) {
    for (const line of journal.lines) {
      // Canonical signed writer — this used to write `debit - credit`
      // unsigned, moving every credit-normal account the wrong way.
      await applyBalanceDelta(
        prisma,
        entityId,
        period.id,
        line.accountId,
        line.debitFunctional,
        line.creditFunctional
      );
    }
  }

  return journal.id;
}

// ── File-based import (Excel/CSV) ───────────────────────────────────────────

export type PayrollFileRow = {
  rowNumber: number;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
  department: string;
  costCentre: string;
};

export function parsePayrollFile(buffer: Buffer, filename: string): PayrollFileRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new PayrollServiceError("PAYROLL_EMPTY_FILE", "File has no sheets.", 400);

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rawRows
    .map((raw, i) => {
      const rowNumber = i + 2;
      const accountCode = String(
        raw["accountCode"] ??
          raw["account_code"] ??
          raw["AccountCode"] ??
          raw["code"] ??
          raw["Code"] ??
          raw["GL Account"] ??
          ""
      ).trim();

      const debit = parseAmount(raw["debit"] ?? raw["Debit"] ?? raw["DEBIT"] ?? "0");
      const credit = parseAmount(raw["credit"] ?? raw["Credit"] ?? raw["CREDIT"] ?? "0");

      const description = String(
        raw["description"] ?? raw["Description"] ?? raw["narration"] ?? raw["Narration"] ?? ""
      ).trim();
      const department = String(raw["department"] ?? raw["Department"] ?? raw["dept"] ?? "").trim();
      const costCentre = String(
        raw["costCentre"] ?? raw["cost_centre"] ?? raw["CostCentre"] ?? raw["costCenter"] ?? ""
      ).trim();

      return { rowNumber, accountCode, debit, credit, description, department, costCentre };
    })
    .filter((r) => r.accountCode !== "");
}

function parseAmount(value: unknown): string {
  if (value == null || value === "") return "0";
  const n = Number(value);
  return isNaN(n) ? "0" : n.toFixed(4);
}

export async function importPayrollFile(
  prisma: PrismaClient,
  entityId: string,
  file: string,
  filename: string,
  postingDate: string,
  currency: string,
  autoPost: boolean
): Promise<PayrollImportResult> {
  const buffer = Buffer.from(file, "base64");
  const rows = parsePayrollFile(buffer, filename);

  if (rows.length === 0) {
    throw new PayrollServiceError("PAYROLL_EMPTY_FILE", "No data rows found in file.", 400);
  }

  // Convert to payroll batch format
  const batch: PayrollBatch = {
    sourceSystem: "FILE_UPLOAD",
    batchRef: `FILE-${filename}-${Date.now()}`,
    autoPost,
    runs: [
      {
        reference: `${filename.replace(/\.[^.]+$/, "")}-${postingDate}`,
        description: `Payroll file import: ${filename}`,
        postingDate,
        currency,
        lines: rows.map((r) => ({
          accountCode: r.accountCode,
          debit: r.debit,
          credit: r.credit,
          description: r.description || undefined,
          department: r.department || undefined,
          costCentre: r.costCentre || undefined
        }))
      }
    ]
  };

  return importPayrollBatch(prisma, entityId, batch);
}
