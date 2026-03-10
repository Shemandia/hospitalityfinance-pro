/**
 * SAF (SunAccount Transfer File) Parser
 *
 * Supports TWO formats:
 *   - Fixed-width 512-char (Jana .txt files)
 *       • MFMCP journal type  — Purchasing: whole-integer amounts
 *       • MCTRF journal source — Internal Movements / Inventory Differences: ÷1000
 *   - Pipe-delimited (Opera .SUN files, journal types FIDEL/FIDMS/FIDST)
 *
 * Auto-detects format by checking for pipe characters in the first data line.
 * Within fixed-width, auto-detects amount rule from journal type / journal source.
 *
 * Spec reference: SAF-File-Format-Specification.md, Opera-PMS-Integration-Guide.md,
 *   Jana-Internal-Movements-Guide.md, Jana-Inventory-Differences-Guide.md
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SAFFormat = "fixed_width" | "pipe_delimited";

/** Opera file type derived from filename prefix or journal type */
export type OperaFileType = "revenue" | "city_ledger" | "market_stats" | "daily_stats" | null;

/** Jana file type derived from journal type/source or filename */
export type JanaFileType = "purchasing" | "internal_movements" | "inventory_differences" | null;

/** Amount rule for fixed-width Jana files */
export type JanaAmountRule = "whole_integer" | "divide_by_1000";

export interface SAFControlRecord {
  recordType: "C";
  highestJournalNumber: string;
  lastCleardownSequence: string;
  languageId: string;
}

export interface SAFTransactionLine {
  recordType: "L" | "M";
  accountCode: string;
  accountingPeriod: string;      // YYYYPPP
  fiscalYear: number;
  periodNumber: number;
  transactionDate: string;       // YYYYMMDD
  journalNumber: string;
  lineNumber: string;
  amount: number;                // Always positive
  dcMarker: "D" | "C";          // Debit or Credit
  signedAmount: number;          // Positive for debit, negative for credit
  allocationIndicator: string;
  journalType: string;           // e.g. MFMCP, FIDEL, FIDMS, FIDST
  journalSource: string;
  transactionReference: string;  // PO number, invoice ref, Opera tx code
  description: string;
  entryDate: string;
  entryPeriod: string;
  dueDate: string;
  paymentAllocRef: string;
  paymentAllocDate: string;
  paymentAllocPeriod: string;
  assetIndicator: string;
  assetCode: string;
  assetSubCode: string;
  conversionCode: string;        // Currency code (TZS, USD, EUR)
  // Extended fields
  otherAmount: number;
  otherAmountCurrency: string;
  baseAmount: number;
  // Analysis codes T0–T9
  // Fixed-width: positional fields at 242+
  // Pipe-delimited: fields [31]=property, [32]=dept, [33]=dept2, [34]=outlet
  t0: string;   // Jana MFMCP: VAT/tax rate | Jana MCTRF: department code | Opera: property code
  t1: string;   // Jana: Department   | Opera: department code
  t2: string;   // Jana: T2           | Opera: department 2 (echo)
  t3: string;   // Jana: T3           | Opera: outlet code
  t4: string;
  t5: string;
  t6: string;
  t7: string;
  t8: string;
  t9: string;
  // Raw line for debugging
  rawLine: string;
  rawLineNumber: number;
}

export interface SAFParseResult {
  format: SAFFormat;
  operaFileType: OperaFileType;
  janaFileType: JanaFileType;
  version: string | null;
  controlRecord: SAFControlRecord | null;
  lines: SAFTransactionLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  lineCount: number;
  dateRange: { earliest: string; latest: string } | null;
  uniqueAccounts: string[];
  currency: string | null;
  journalTypes: string[];
  errors: SAFParseError[];
}

export interface SAFParseError {
  line: number;
  message: string;
  raw?: string;
}

// ── Opera journal type → file type mapping ───────────────────────────────────

const OPERA_JOURNAL_TYPES: Record<string, OperaFileType> = {
  FIDEL: "revenue",   // Also used for city ledger — disambiguated by source
  FIDMS: "market_stats",
  FIDST: "daily_stats",
};

/** Detect Jana file type from filename prefix or journal type/source */
function detectJanaFileType(filename?: string, journalTypes?: string[], journalSources?: string[]): JanaFileType {
  // Primary: filename prefix
  if (filename) {
    const upper = filename.toUpperCase();
    if (upper.includes("INTERNAL_MOVEMENTS") || upper.includes("INTERNAL-MOVEMENTS")) return "internal_movements";
    if (upper.includes("INVENTORY_DIFFERENCES") || upper.includes("INVENTORY-DIFFERENCES")) return "inventory_differences";
  }
  // Secondary: journal source — MCTRF = internal movements or inventory differences
  // (can't distinguish without filename, default to internal_movements)
  if (journalSources?.includes("MCTRF")) return "internal_movements";
  // MFMCP = purchasing
  if (journalTypes?.includes("MFMCP")) return "purchasing";
  return null;
}

/** Detect Opera file type from filename prefix (e.g. EZZRV20250830.SUN) */
function detectOperaFileType(filename?: string): OperaFileType {
  if (!filename) return null;
  const upper = filename.toUpperCase();
  if (upper.includes("RV")) return "revenue";
  if (upper.includes("CL")) return "city_ledger";
  if (upper.includes("MS")) return "market_stats";
  if (upper.includes("DS")) return "daily_stats";
  return null;
}

// ── Fixed-width field extraction ─────────────────────────────────────────────

/** Extract a fixed-width field (1-based start position, given length). Trims trailing spaces. */
function field(line: string, start: number, length: number): string {
  return line.substring(start - 1, start - 1 + length).trimEnd();
}

// ── Amount parsing ───────────────────────────────────────────────────────────

/**
 * Parse Jana/fixed-width amount — MFMCP purchasing files.
 * - If the string contains '.', parse as float directly
 * - Otherwise parse as integer (whole number, no implied decimals)
 */
function parseAmountJanaWholeInteger(raw: string): number {
  const s = raw.trim();
  if (!s || s === "0") return 0;
  if (s.includes(".")) {
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse Jana/fixed-width amount — MCTRF files (Internal Movements, Inventory Differences).
 * 18-digit integer with 3 implied decimal places → divide by 1000.
 * e.g. 000000000571467040 → 571,467.040
 */
function parseAmountJanaDivide1000(raw: string): number {
  const s = raw.trim();
  if (!s || s === "0") return 0;
  const n = parseInt(s, 10);
  if (isNaN(n)) return 0;
  return Math.round(n) / 1000;
}

/**
 * Determine the amount rule for a fixed-width line based on journal type/source.
 *   MFMCP journal type → whole integer (purchasing)
 *   MCTRF journal source → ÷1000 (internal movements, inventory differences)
 */
function getJanaAmountRule(journalType: string, journalSource: string): JanaAmountRule {
  if (journalSource === "MCTRF") return "divide_by_1000";
  // Default: whole integer (MFMCP purchasing and any other types)
  return "whole_integer";
}

/** Parse a Jana fixed-width amount using the appropriate rule */
function parseAmountJana(raw: string, rule: JanaAmountRule): number {
  return rule === "divide_by_1000"
    ? parseAmountJanaDivide1000(raw)
    : parseAmountJanaWholeInteger(raw);
}

/**
 * Parse Opera/pipe-delimited amount.
 * 18-digit integer with 3 implied decimal places → divide by 1000.
 * e.g. 000000000007204970 → 7204.970
 */
function parseAmountOpera(raw: string): number {
  const s = raw.trim();
  if (!s || s === "0") return 0;
  // Remove leading zeros, parse as integer, divide by 1000
  const n = parseInt(s, 10);
  if (isNaN(n)) return 0;
  // Use Math.round to avoid floating-point drift
  return Math.round(n) / 1000;
}

// ── Format detection ─────────────────────────────────────────────────────────

/**
 * Auto-detect whether the file is pipe-delimited (Opera) or fixed-width (Jana).
 * Checks the first non-empty, non-VERSION line for pipe characters.
 */
function detectFormat(rawLines: string[]): SAFFormat {
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("VERSION")) continue;
    // Pipe-delimited lines will have multiple | characters
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    if (pipeCount >= 5) return "pipe_delimited";
    return "fixed_width";
  }
  return "fixed_width";
}

// ── Pipe-delimited parser (Opera .SUN) ───────────────────────────────────────

function parsePipeLine(
  raw: string,
  lineNum: number,
  errors: SAFParseError[]
): SAFTransactionLine | null {
  const fields = raw.split("|");

  // Need at least 10 fields for a valid line
  if (fields.length < 10) {
    errors.push({ line: lineNum, message: `Too few pipe-delimited fields (${fields.length})`, raw });
    return null;
  }

  const f = (idx: number) => (fields[idx] ?? "").trim();

  const accountCode = f(0);
  if (!accountCode) {
    errors.push({ line: lineNum, message: "Missing account code", raw });
    return null;
  }

  const accountingPeriod = f(1);  // YYYYPPP
  const transactionDate = f(2);   // YYYYMMDD
  const journalNumber = f(3);
  const lineNumber = f(4);
  const recordType = f(5).toUpperCase() || "L";
  const amountRaw = f(6);
  const dcMarker = f(7).toUpperCase();
  const allocationIndicator = f(8);
  const journalType = f(9);
  const journalSource = f(10) ?? "";
  const transactionReference = f(11) ?? "";
  const description = f(12) ?? "";

  if (dcMarker !== "D" && dcMarker !== "C") {
    errors.push({ line: lineNum, message: `Invalid D/C marker: "${dcMarker}"`, raw });
    return null;
  }

  const amount = parseAmountOpera(amountRaw);
  if (amount < 0) {
    errors.push({ line: lineNum, message: `Negative amount: ${amountRaw}`, raw });
    return null;
  }

  // Parse fiscal year and period
  let fiscalYear = 0;
  let periodNumber = 0;
  if (accountingPeriod.length >= 7) {
    fiscalYear = parseInt(accountingPeriod.substring(0, 4), 10) || 0;
    periodNumber = parseInt(accountingPeriod.substring(4), 10) || 0;
  }

  // Currency at field 22, base amount at field 24
  const conversionCode = f(22);
  const baseAmountRaw = f(24);
  const baseAmount = baseAmountRaw ? parseAmountOpera(baseAmountRaw) : amount;

  // Analysis codes: fields 31-34 for Opera (property, dept, dept2, outlet)
  const t0 = f(31);  // Property code (e.g. EZZ)
  const t1 = f(32);  // Department code
  const t2 = f(33);  // Department 2 (echo)
  const t3 = f(34);  // Outlet code
  const t4 = f(35);
  const t5 = f(36);
  const t6 = f(37);
  const t7 = f(38);
  const t8 = f(39);
  const t9 = f(40);

  return {
    recordType: (recordType === "L" || recordType === "M") ? recordType : "L",
    accountCode,
    accountingPeriod,
    fiscalYear,
    periodNumber,
    transactionDate,
    journalNumber,
    lineNumber,
    amount,
    dcMarker: dcMarker as "D" | "C",
    signedAmount: dcMarker === "D" ? amount : -amount,
    allocationIndicator,
    journalType,
    journalSource,
    transactionReference,
    description,
    entryDate: f(13),
    entryPeriod: f(14),
    dueDate: f(15),
    paymentAllocRef: f(16),
    paymentAllocDate: f(17),
    paymentAllocPeriod: f(18),
    assetIndicator: f(19),
    assetCode: f(20),
    assetSubCode: f(21),
    conversionCode,
    otherAmount: 0,
    otherAmountCurrency: f(23),
    baseAmount,
    t0, t1, t2, t3, t4, t5, t6, t7, t8, t9,
    rawLine: raw,
    rawLineNumber: lineNum,
  };
}

// ── Fixed-width parser (Jana .txt) ───────────────────────────────────────────

function parseFixedWidthLine(
  raw: string,
  lineNum: number,
  errors: SAFParseError[]
): SAFTransactionLine | null {
  // Pad to 512 chars if shorter
  const line = raw.padEnd(512);
  const recordType = field(line, 33, 1).toUpperCase();

  if (recordType !== "L" && recordType !== "M" && recordType !== "E" && recordType !== "T" && recordType !== "N") {
    return null; // Not a transaction line — caller handles control/unknown
  }

  const accountCode = field(line, 1, 10);
  if (!accountCode) {
    errors.push({ line: lineNum, message: "Missing account code", raw });
    return null;
  }

  const accountingPeriod = field(line, 16, 7);
  const transactionDate = field(line, 23, 8);
  const amountRaw = field(line, 48, 18);
  const dcMarker = field(line, 66, 1).toUpperCase();

  if (dcMarker !== "D" && dcMarker !== "C") {
    errors.push({ line: lineNum, message: `Invalid D/C marker: "${dcMarker}"`, raw });
    return null;
  }

  // Read journal type/source first to determine amount parsing rule
  const journalType = field(line, 68, 5);
  const journalSource = field(line, 73, 5);
  const amountRule = getJanaAmountRule(journalType, journalSource);

  const amount = parseAmountJana(amountRaw, amountRule);
  if (amount < 0) {
    errors.push({ line: lineNum, message: `Negative amount: ${amountRaw}`, raw });
    return null;
  }

  let fiscalYear = 0;
  let periodNumber = 0;
  if (accountingPeriod.length >= 7) {
    fiscalYear = parseInt(accountingPeriod.substring(0, 4), 10) || 0;
    periodNumber = parseInt(accountingPeriod.substring(4), 10) || 0;
  }

  return {
    recordType: (recordType === "L" || recordType === "M") ? recordType : "L",
    accountCode,
    accountingPeriod,
    fiscalYear,
    periodNumber,
    transactionDate,
    journalNumber: field(line, 34, 7),
    lineNumber: field(line, 41, 7),
    amount,
    dcMarker: dcMarker as "D" | "C",
    signedAmount: dcMarker === "D" ? amount : -amount,
    allocationIndicator: field(line, 67, 1),
    journalType,
    journalSource,
    transactionReference: field(line, 78, 15),
    description: field(line, 93, 25),
    entryDate: field(line, 118, 8),
    entryPeriod: field(line, 126, 7),
    dueDate: field(line, 133, 8),
    paymentAllocRef: field(line, 147, 9),
    paymentAllocDate: field(line, 156, 8),
    paymentAllocPeriod: field(line, 164, 7),
    assetIndicator: field(line, 171, 1),
    assetCode: field(line, 172, 10),
    assetSubCode: field(line, 182, 5),
    conversionCode: field(line, 187, 5),
    otherAmount: parseAmountJana(field(line, 192, 18), amountRule),
    otherAmountCurrency: field(line, 210, 5),
    baseAmount: parseAmountJana(field(line, 220, 8), amountRule),
    t0: field(line, 242, 15),
    t1: field(line, 257, 15),
    t2: field(line, 272, 15),
    t3: field(line, 287, 15),
    t4: field(line, 302, 15),
    t5: field(line, 317, 15),
    t6: field(line, 332, 15),
    t7: field(line, 347, 15),
    t8: field(line, 362, 15),
    t9: field(line, 377, 15),
    rawLine: raw,
    rawLineNumber: lineNum,
  };
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseSAFFile(content: string, filename?: string): SAFParseResult {
  const rawLines = content.split(/\r?\n/);
  const format = detectFormat(rawLines);
  const errors: SAFParseError[] = [];
  const txLines: SAFTransactionLine[] = [];
  let version: string | null = null;
  let controlRecord: SAFControlRecord | null = null;

  if (format === "pipe_delimited") {
    // ── Opera pipe-delimited parsing ──
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const lineNum = i + 1;
      if (!raw.trim()) continue;

      // VERSION header (unlikely in Opera files, but handle it)
      if (raw.trimStart().startsWith("VERSION")) {
        version = raw.replace(/^.*VERSION\s*/, "").trim();
        continue;
      }

      const txLine = parsePipeLine(raw, lineNum, errors);
      if (txLine) txLines.push(txLine);
    }
  } else {
    // ── Jana fixed-width parsing ──
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const lineNum = i + 1;
      if (!raw.trim()) continue;

      // VERSION header
      if (raw.trimStart().startsWith("VERSION")) {
        version = raw.replace(/^.*VERSION\s*/, "").trim();
        continue;
      }

      const line = raw.padEnd(512);
      const recordType = field(line, 33, 1).toUpperCase();

      if (recordType === "C") {
        controlRecord = {
          recordType: "C",
          highestJournalNumber: field(line, 34, 7),
          lastCleardownSequence: field(line, 41, 5),
          languageId: field(line, 48, 2),
        };
        continue;
      }

      if (recordType === "L" || recordType === "M" || recordType === "E" || recordType === "T" || recordType === "N") {
        const txLine = parseFixedWidthLine(raw, lineNum, errors);
        if (txLine) txLines.push(txLine);
        continue;
      }

      if (raw.trim().length > 0) {
        errors.push({ line: lineNum, message: `Unrecognised record type "${recordType}" at position 33`, raw });
      }
    }
  }

  // ── Summaries ──
  const totalDebits = txLines
    .filter(l => l.dcMarker === "D")
    .reduce((s, l) => s + l.amount, 0);
  const totalCredits = txLines
    .filter(l => l.dcMarker === "C")
    .reduce((s, l) => s + l.amount, 0);

  // Balance check — round to 3 decimal places (Opera uses 3 implied decimals)
  const isBalanced = Math.abs(Math.round(totalDebits * 1000) - Math.round(totalCredits * 1000)) === 0;

  // Date range
  const dates = txLines.map(l => l.transactionDate).filter(d => d.length === 8).sort();
  const dateRange = dates.length > 0
    ? { earliest: dates[0], latest: dates[dates.length - 1] }
    : null;

  // Unique accounts
  const uniqueAccounts = [...new Set(txLines.map(l => l.accountCode))].sort();

  // Currency — take the most common non-empty conversion code
  const currencyCounts = new Map<string, number>();
  for (const l of txLines) {
    if (l.conversionCode) {
      currencyCounts.set(l.conversionCode, (currencyCounts.get(l.conversionCode) ?? 0) + 1);
    }
  }
  let currency: string | null = null;
  let maxCount = 0;
  for (const [code, count] of currencyCounts) {
    if (count > maxCount) { currency = code; maxCount = count; }
  }

  // Journal types
  const journalTypes = [...new Set(txLines.map(l => l.journalType).filter(Boolean))].sort();

  // Determine Opera file type from filename or journal types
  let operaFileType: OperaFileType = null;
  let janaFileType: JanaFileType = null;
  if (format === "pipe_delimited") {
    operaFileType = detectOperaFileType(filename);
    if (!operaFileType && journalTypes.length > 0) {
      for (const jt of journalTypes) {
        const mapped = OPERA_JOURNAL_TYPES[jt];
        if (mapped) { operaFileType = mapped; break; }
      }
    }
  } else {
    // Fixed-width: detect Jana file type from filename and journal type/source
    const journalSources = [...new Set(txLines.map(l => l.journalSource).filter(Boolean))];
    janaFileType = detectJanaFileType(filename, journalTypes, journalSources);
  }

  return {
    format,
    operaFileType,
    janaFileType,
    version,
    controlRecord,
    lines: txLines,
    totalDebits: Math.round(totalDebits * 1000) / 1000,
    totalCredits: Math.round(totalCredits * 1000) / 1000,
    isBalanced,
    lineCount: txLines.length,
    dateRange,
    uniqueAccounts,
    currency,
    journalTypes,
    errors,
  };
}

// ── Account classification helpers ────────────────────────────────────────────

/** Returns true if the SAF account code is a vendor/creditor account (starts with C + alpha) */
export function isVendorAccount(code: string): boolean {
  return /^C[A-Za-z]/.test(code);
}

/** Returns true if the SAF account code is a numeric GL account */
export function isGLAccount(code: string): boolean {
  return /^\d/.test(code);
}

/** Returns true if the account code is a statistical account (Z prefix — Opera stats) */
export function isStatisticalAccount(code: string): boolean {
  return /^Z\d/.test(code);
}

/**
 * Group transaction lines by reference (PO/invoice number).
 * Each group represents a balanced journal entry.
 */
export function groupByReference(lines: SAFTransactionLine[]): Map<string, SAFTransactionLine[]> {
  const groups = new Map<string, SAFTransactionLine[]>();
  for (const line of lines) {
    const ref = line.transactionReference || "__no_ref__";
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref)!.push(line);
  }
  return groups;
}

/**
 * Group transaction lines by journal type.
 * Each group represents all transactions of a given type (e.g. MFMCP, FIDEL).
 */
export function groupByJournalType(lines: SAFTransactionLine[]): Map<string, SAFTransactionLine[]> {
  const groups = new Map<string, SAFTransactionLine[]>();
  for (const line of lines) {
    const jt = line.journalType || "__no_type__";
    if (!groups.has(jt)) groups.set(jt, []);
    groups.get(jt)!.push(line);
  }
  return groups;
}

/**
 * Extract a preview summary suitable for the API response.
 */
export function buildPreviewSummary(result: SAFParseResult) {
  const debitAccounts = result.lines
    .filter(l => l.dcMarker === "D")
    .reduce((acc, l) => {
      if (!acc.has(l.accountCode)) acc.set(l.accountCode, { code: l.accountCode, total: 0, lines: 0, sampleDesc: l.description });
      const entry = acc.get(l.accountCode)!;
      entry.total += l.amount;
      entry.lines++;
      return acc;
    }, new Map<string, { code: string; total: number; lines: number; sampleDesc: string }>());

  const creditAccounts = result.lines
    .filter(l => l.dcMarker === "C")
    .reduce((acc, l) => {
      if (!acc.has(l.accountCode)) acc.set(l.accountCode, { code: l.accountCode, total: 0, lines: 0, sampleDesc: l.description });
      const entry = acc.get(l.accountCode)!;
      entry.total += l.amount;
      entry.lines++;
      return acc;
    }, new Map<string, { code: string; total: number; lines: number; sampleDesc: string }>());

  return {
    format: result.format,
    operaFileType: result.operaFileType,
    janaFileType: result.janaFileType,
    version: result.version,
    lineCount: result.lineCount,
    totalDebits: result.totalDebits,
    totalCredits: result.totalCredits,
    isBalanced: result.isBalanced,
    difference: Math.round((result.totalDebits - result.totalCredits) * 1000) / 1000,
    dateRange: result.dateRange,
    currency: result.currency,
    journalTypes: result.journalTypes,
    debitAccounts: [...debitAccounts.values()].sort((a, b) => b.total - a.total),
    creditAccounts: [...creditAccounts.values()].sort((a, b) => b.total - a.total),
    uniqueAccountCount: result.uniqueAccounts.length,
    errors: result.errors,
  };
}
