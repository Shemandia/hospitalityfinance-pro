/**
 * Sky Jana SAF flat-file parser
 *
 * Jana exports purchasing vouchers as SAF (SunAccount Transfer File) .txt files.
 * File naming convention: Jana-IN-Purchasing-{DDMMYYHH}.txt
 *
 * This module re-exports the shared SAF parser and adds Jana-specific helpers
 * for interpreting journal types, analysis codes, and vendor/expense grouping.
 */

export {
  parseSAFFile,
  buildPreviewSummary,
  groupByReference,
  groupByJournalType,
  isVendorAccount,
  isGLAccount,
  type SAFTransactionLine,
  type SAFParseResult,
  type SAFParseError,
  type SAFControlRecord
} from "../saf/saf-parser.js";

import {
  parseSAFFile,
  groupByReference,
  isVendorAccount,
  isGLAccount,
  type SAFTransactionLine,
  type SAFParseResult
} from "../saf/saf-parser.js";

// ── Jana-specific types ───────────────────────────────────────────────────────

/** A Jana purchasing voucher — one balanced group of debit/credit lines */
export interface JanaPurchasingVoucher {
  reference: string;
  journalType: string;
  transactionDate: string;
  accountingPeriod: string;
  currency: string;
  expenseLines: JanaExpenseLine[];
  vendorLines: JanaVendorLine[];
  totalGross: number;
  totalNet: number;
  totalVAT: number;
  isBalanced: boolean;
}

export interface JanaExpenseLine {
  accountCode: string;
  amount: number;
  description: string;
  department: string; // T1 analysis code
  vatRate: string; // T0 analysis code
  lineNumber: number;
}

export interface JanaVendorLine {
  vendorCode: string; // e.g. CGRAN001
  amount: number;
  description: string;
  reference: string;
  lineNumber: number;
}

// ── Jana journal type mapping ─────────────────────────────────────────────────

export const JANA_JOURNAL_TYPES: Record<string, string> = {
  MFMCP: "Materials F&B Misc Cost Posting",
  MFMCR: "Materials F&B Cost Reversal/Credit"
};

export function isJanaFile(result: SAFParseResult): boolean {
  return result.journalTypes.some((jt) => jt in JANA_JOURNAL_TYPES);
}

// ── Extract vouchers from parsed SAF ──────────────────────────────────────────

/**
 * Group SAF lines into Jana purchasing vouchers, one per transaction reference.
 * Each voucher has expense debit lines, VAT debit lines, and vendor credit lines.
 */
export function extractJanaVouchers(result: SAFParseResult): JanaPurchasingVoucher[] {
  const groups = groupByReference(result.lines);
  const vouchers: JanaPurchasingVoucher[] = [];

  for (const [ref, lines] of groups) {
    const debits = lines.filter((l) => l.dcMarker === "D");
    const credits = lines.filter((l) => l.dcMarker === "C");

    // Separate expense lines from VAT lines (VAT accounts typically start with 23)
    const expenseDebits = debits.filter((l) => !l.accountCode.startsWith("23"));
    const vatDebits = debits.filter((l) => l.accountCode.startsWith("23"));

    const totalDebits = debits.reduce((s, l) => s + Number(l.amount), 0);
    const totalCredits = credits.reduce((s, l) => s + Number(l.amount), 0);

    const expenseLines: JanaExpenseLine[] = expenseDebits.map((l, i) => ({
      accountCode: l.accountCode,
      amount: Number(l.amount),
      description: l.description,
      department: l.t1,
      vatRate: l.t0,
      lineNumber: i + 1
    }));

    const vendorLines: JanaVendorLine[] = credits.map((l, i) => ({
      vendorCode: l.accountCode,
      amount: Number(l.amount),
      description: l.description,
      reference: l.transactionReference,
      lineNumber: i + 1
    }));

    const totalVAT = vatDebits.reduce((s, l) => s + Number(l.amount), 0);
    const totalNet = expenseDebits.reduce((s, l) => s + Number(l.amount), 0);

    vouchers.push({
      reference: ref,
      journalType: lines[0]?.journalType ?? "",
      transactionDate: lines[0]?.transactionDate ?? "",
      accountingPeriod: lines[0]?.accountingPeriod ?? "",
      currency: lines[0]?.conversionCode ?? result.currency ?? "USD",
      expenseLines,
      vendorLines,
      totalGross: totalCredits,
      totalNet,
      totalVAT,
      isBalanced: Math.abs(Math.round(totalDebits * 100) - Math.round(totalCredits * 100)) === 0
    });
  }

  return vouchers;
}

/**
 * Detect the file type from a filename.
 * Jana files: .txt (e.g. Jana-IN-Purchasing-11061306.txt)
 * Opera files: .SUN
 */
export function detectFileFormat(filename: string): "JANA_TXT" | "OPERA_SUN" | "SAF_GENERIC" {
  const lower = filename.toLowerCase();
  if (lower.includes("jana") && lower.endsWith(".txt")) return "JANA_TXT";
  if (lower.endsWith(".sun")) return "OPERA_SUN";
  if (lower.endsWith(".txt") || lower.endsWith(".saf")) return "SAF_GENERIC";
  return "SAF_GENERIC";
}
