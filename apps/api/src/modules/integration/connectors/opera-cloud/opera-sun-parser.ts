/**
 * Opera .SUN file parser
 *
 * Opera PMS exports night-audit revenue postings as .SUN files —
 * these use the same SAF (SunAccount Transfer File) fixed-width format
 * as Jana .txt files (Infor SunSystems standard).
 *
 * Opera revenue files typically contain:
 *   - DEBIT lines to Cash/AR accounts (e.g. 1000, 1100)
 *   - CREDIT lines to Revenue accounts (e.g. RROOM, RFNB revenue codes)
 *   - Journal types: RROOM (Room Revenue), RFNB (F&B Revenue), SALES, etc.
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
} from "../saf/saf-parser.js";

import {
  parseSAFFile,
  groupByJournalType,
  type SAFTransactionLine,
  type SAFParseResult,
} from "../saf/saf-parser.js";

// ── Opera-specific types ──────────────────────────────────────────────────────

export interface OperaRevenueGroup {
  journalType: string;           // RROOM, RFNB, SALES, etc.
  journalTypeLabel: string;
  businessDate: string;
  accountingPeriod: string;
  currency: string;
  debitLines: OperaRevenueLine[];
  creditLines: OperaRevenueLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}

export interface OperaRevenueLine {
  accountCode: string;
  amount: number;
  description: string;
  transactionReference: string;
  lineNumber: number;
}

// ── Opera journal type mapping ────────────────────────────────────────────────

export const OPERA_JOURNAL_TYPES: Record<string, string> = {
  RROOM: "Room Revenue",
  RFNB:  "F&B Revenue",
  SALES: "POS Sales Posting",
  RMINI: "Mini-Bar Revenue",
  RLAUN: "Laundry Revenue",
  RSPRT: "Spa & Sports Revenue",
  RTELE: "Telephone Revenue",
  RPARK: "Parking Revenue",
  RMISC: "Miscellaneous Revenue",
  RTAX:  "Tax Posting",
  RPAY:  "Payment Posting",
  ADJST: "Manual Adjustment",
};

export function isOperaFile(result: SAFParseResult): boolean {
  return result.journalTypes.some(jt => jt in OPERA_JOURNAL_TYPES);
}

// ── Extract revenue groups from parsed SAF ────────────────────────────────────

/**
 * Group Opera .SUN lines by journal type, producing one revenue group per type.
 * Typically one .SUN file = one night-audit date, with multiple journal types.
 */
export function extractOperaRevenueGroups(result: SAFParseResult): OperaRevenueGroup[] {
  const groups = groupByJournalType(result.lines);
  const revenueGroups: OperaRevenueGroup[] = [];

  for (const [jt, lines] of groups) {
    const debits = lines.filter(l => l.dcMarker === "D");
    const credits = lines.filter(l => l.dcMarker === "C");
    const totalDebits = debits.reduce((s, l) => s + l.amount, 0);
    const totalCredits = credits.reduce((s, l) => s + l.amount, 0);

    const debitLines: OperaRevenueLine[] = debits.map((l, i) => ({
      accountCode: l.accountCode,
      amount: l.amount,
      description: l.description,
      transactionReference: l.transactionReference,
      lineNumber: i + 1,
    }));

    const creditLines: OperaRevenueLine[] = credits.map((l, i) => ({
      accountCode: l.accountCode,
      amount: l.amount,
      description: l.description,
      transactionReference: l.transactionReference,
      lineNumber: i + 1,
    }));

    revenueGroups.push({
      journalType: jt,
      journalTypeLabel: OPERA_JOURNAL_TYPES[jt] ?? jt,
      businessDate: lines[0]?.transactionDate ?? "",
      accountingPeriod: lines[0]?.accountingPeriod ?? "",
      currency: lines[0]?.conversionCode ?? result.currency ?? "USD",
      debitLines,
      creditLines,
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      isBalanced: Math.abs(Math.round(totalDebits * 100) - Math.round(totalCredits * 100)) === 0,
    });
  }

  return revenueGroups;
}
