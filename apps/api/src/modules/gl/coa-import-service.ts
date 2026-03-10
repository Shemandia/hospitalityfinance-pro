/**
 * Chart of Accounts Import Service
 *
 * Imports accounts from CSV or Excel (.xlsx/.xls) files with preview/validation before commit.
 *
 * Expected columns (flexible header names):
 *   code | name | type | normalBalance | allowPosting | isControlAccount |
 *   parentCode | level | usaliCategory | usaliDepartment
 *
 * Type values: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
 * Normal balance values: DEBIT, CREDIT (auto-inferred from type if omitted)
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────

export type COAImportRow = {
  rowNumber: number;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: "DEBIT" | "CREDIT";
  allowPosting: boolean;
  isControlAccount: boolean;
  parentCode: string;
  level: number;
  usaliCategory: string;
  usaliDepartment: string;
};

export type COAPreviewResult = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  newAccounts: number;
  existingAccounts: number;
  rows: COAPreviewRow[];
  errors: COAImportError[];
};

export type COAPreviewRow = COAImportRow & {
  status: "new" | "exists" | "update" | "error";
  existingId?: string;
  issues: string[];
};

export type COAImportError = {
  row: number;
  column: string;
  message: string;
};

export type COAImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: COAImportError[];
};

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

// ── CSV parsing ───────────────────────────────────────────────────────────────

/** Normalise CSV header to canonical field name */
function normaliseHeader(raw: string): string {
  const h = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    code: "code", accountcode: "code", acctcode: "code", glcode: "code", accountno: "code",
    name: "name", accountname: "name", acctname: "name", description: "name", desc: "name",
    type: "type", accounttype: "type", accttype: "type",
    normalbalance: "normalBalance", balance: "normalBalance", normal: "normalBalance", drcr: "normalBalance",
    allowposting: "allowPosting", postable: "allowPosting", posting: "allowPosting",
    iscontrolaccount: "isControlAccount", control: "isControlAccount", controlaccount: "isControlAccount",
    parentcode: "parentCode", parent: "parentCode", parentaccount: "parentCode", parentacctcode: "parentCode",
    level: "level", acctlevel: "level", accountlevel: "level",
    usalicategory: "usaliCategory", category: "usaliCategory", usalicateg: "usaliCategory",
    usalidepartment: "usaliDepartment", department: "usaliDepartment", dept: "usaliDepartment",
  };
  return map[h] ?? h;
}

function parseCSV(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter: tab, semicolon, comma
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  const rawHeaders = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ""));
  const headers = rawHeaders.map(normaliseHeader);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cells[j] ?? "").trim().replace(/^["']|["']$/g, "");
    }
    rows.push(row);
  }

  return { headers, rows };
}

/** Split CSV line handling quoted fields */
function splitCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = false;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Excel parsing ─────────────────────────────────────────────────────────────

function parseExcel(base64: string, sheetName?: string): { headers: string[]; rows: Record<string, string>[] } {
  const buffer = Buffer.from(base64, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  // Use specified sheet or first sheet
  const sheet = sheetName
    ? workbook.Sheets[sheetName]
    : workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    return { headers: [], rows: [] };
  }

  // Convert sheet to array-of-arrays (raw: false gives formatted strings)
  const rawData: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  if (rawData.length === 0) return { headers: [], rows: [] };

  // Find the header row — first row with at least 2 non-empty cells that look like headers
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const nonEmpty = rawData[i].filter(c => String(c ?? "").trim() !== "").length;
    if (nonEmpty >= 2) {
      // Check if this looks like a header (contains "code" or "name" or "account")
      const joined = rawData[i].map(c => String(c).toLowerCase()).join(" ");
      if (joined.includes("code") || joined.includes("name") || joined.includes("account") || joined.includes("type")) {
        headerRowIdx = i;
        break;
      }
      // If no keyword match, still use the first row with 2+ cells
      if (i === 0) headerRowIdx = 0;
    }
  }

  const rawHeaders = rawData[headerRowIdx].map(h => String(h ?? "").trim());
  const headers = rawHeaders.map(normaliseHeader);

  const rows: Record<string, string>[] = [];
  for (let i = headerRowIdx + 1; i < rawData.length; i++) {
    const cells = rawData[i];
    // Skip completely empty rows
    if (!cells || cells.every(c => String(c ?? "").trim() === "")) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = String(cells[j] ?? "").trim();
    }

    // Skip rows where code is empty (likely a blank/total row)
    if (!row["code"]) continue;

    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Get sheet names from an Excel file (for UI to let user pick a sheet).
 */
export function getExcelSheetNames(base64: string): string[] {
  const buffer = Buffer.from(base64, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames;
}

// ── Unified parser (CSV or Excel) ─────────────────────────────────────────────

export type FileInput = {
  /** CSV text content */
  fileContent?: string;
  /** Excel file as base64 string */
  fileBase64?: string;
  /** Sheet name for Excel files (optional, defaults to first sheet) */
  sheetName?: string;
};

function parseFile(input: FileInput): { headers: string[]; rows: Record<string, string>[] } {
  if (input.fileBase64) {
    return parseExcel(input.fileBase64, input.sheetName);
  }
  if (input.fileContent) {
    return parseCSV(input.fileContent);
  }
  return { headers: [], rows: [] };
}

// ── Row validation ────────────────────────────────────────────────────────────

const VALID_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

/** Map common accounting type aliases to canonical types */
const TYPE_ALIASES: Record<string, AccountType> = {
  ASSET: "ASSET", ASSETS: "ASSET",
  LIABILITY: "LIABILITY", LIABILITIES: "LIABILITY",
  EQUITY: "EQUITY", CAPITAL: "EQUITY", "OWNERS EQUITY": "EQUITY",
  REVENUE: "REVENUE", INCOME: "REVENUE", SALES: "REVENUE",
  EXPENSE: "EXPENSE", EXPENSES: "EXPENSE", "COST OF SALES": "EXPENSE", COGS: "EXPENSE",
  "PROFIT AND LOSS": "EXPENSE", "P&L": "EXPENSE", PL: "EXPENSE", "P AND L": "EXPENSE",
  "BALANCE SHEET": "ASSET",
  // Common SunSystems / legacy ERP terms
  DEBTOR: "ASSET", DEBTORS: "ASSET", "ACCOUNTS RECEIVABLE": "ASSET", AR: "ASSET",
  CREDITOR: "LIABILITY", CREDITORS: "LIABILITY", "ACCOUNTS PAYABLE": "LIABILITY", AP: "LIABILITY",
  BANK: "ASSET", CASH: "ASSET",
  "FIXED ASSET": "ASSET", "FIXED ASSETS": "ASSET", FA: "ASSET",
  TAX: "LIABILITY", VAT: "LIABILITY",
  "RETAINED EARNINGS": "EQUITY", "ACCUMULATED PROFIT": "EQUITY",
  "OTHER INCOME": "REVENUE", "NON OPERATING INCOME": "REVENUE",
  "OTHER EXPENSE": "EXPENSE", OVERHEAD: "EXPENSE", OVERHEADS: "EXPENSE",
  PAYROLL: "EXPENSE", "LABOUR COST": "EXPENSE",
};

function resolveAccountType(raw: string): AccountType | null {
  const normalized = raw.toUpperCase().trim();
  if (VALID_TYPES.includes(normalized as AccountType)) return normalized as AccountType;
  return TYPE_ALIASES[normalized] ?? null;
}

const TYPE_DEFAULT_BALANCE: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
  EXPENSE: "DEBIT",
};

function parseBool(val: string): boolean {
  const v = val.toLowerCase().trim();
  return v === "true" || v === "yes" || v === "1" || v === "y";
}

function parseRow(raw: Record<string, string>, rowNum: number): { row: COAImportRow | null; errors: COAImportError[] } {
  const errors: COAImportError[] = [];

  const code = raw["code"] ?? "";
  const name = raw["name"] ?? "";
  const typeStr = (raw["type"] ?? "").toUpperCase().trim();
  const normalBalanceStr = (raw["normalBalance"] ?? "").toUpperCase().trim();
  const parentCode = raw["parentCode"] ?? "";
  const levelStr = raw["level"] ?? "";
  const allowPostingStr = raw["allowPosting"] ?? "";
  const isControlStr = raw["isControlAccount"] ?? "";

  // Required fields
  if (!code) errors.push({ row: rowNum, column: "code", message: "Account code is required" });
  if (!name) errors.push({ row: rowNum, column: "name", message: "Account name is required" });

  // Type — accept canonical types + common aliases (e.g. "Debtor" → ASSET)
  let type: AccountType = "EXPENSE";
  if (typeStr) {
    const resolved = resolveAccountType(typeStr);
    if (resolved) {
      type = resolved;
    } else {
      errors.push({ row: rowNum, column: "type", message: `Invalid type "${typeStr}". Use: ${VALID_TYPES.join(", ")} or aliases like Debtor, Creditor, Income, etc.` });
    }
  } else {
    errors.push({ row: rowNum, column: "type", message: "Account type is required" });
  }

  // Normal balance — auto-infer from type if not specified
  let normalBalance: "DEBIT" | "CREDIT" = TYPE_DEFAULT_BALANCE[type];
  if (normalBalanceStr === "DEBIT" || normalBalanceStr === "CREDIT") {
    normalBalance = normalBalanceStr;
  } else if (normalBalanceStr === "D" || normalBalanceStr === "DR") {
    normalBalance = "DEBIT";
  } else if (normalBalanceStr === "C" || normalBalanceStr === "CR") {
    normalBalance = "CREDIT";
  } else if (normalBalanceStr && normalBalanceStr !== "") {
    errors.push({ row: rowNum, column: "normalBalance", message: `Invalid normal balance "${normalBalanceStr}"` });
  }

  // Level
  let level = 1;
  if (levelStr) {
    level = parseInt(levelStr, 10);
    if (isNaN(level) || level < 1 || level > 10) {
      errors.push({ row: rowNum, column: "level", message: `Invalid level "${levelStr}" (must be 1-10)` });
      level = 1;
    }
  } else if (parentCode) {
    level = 2; // default child level
  }

  // Boolean fields
  const allowPosting = allowPostingStr ? parseBool(allowPostingStr) : true;
  const isControlAccount = isControlStr ? parseBool(isControlStr) : false;

  if (errors.length > 0 && !code && !name) {
    return { row: null, errors };
  }

  return {
    row: {
      rowNumber: rowNum,
      code,
      name,
      type,
      normalBalance,
      allowPosting,
      isControlAccount,
      parentCode,
      level,
      usaliCategory: raw["usaliCategory"] ?? "",
      usaliDepartment: raw["usaliDepartment"] ?? "",
    },
    errors,
  };
}

// ── 1. Preview ────────────────────────────────────────────────────────────────

export async function previewCOAImport(
  prisma: PrismaClient,
  entityId: string,
  input: FileInput
): Promise<COAPreviewResult> {
  const { headers, rows: rawRows } = parseFile(input);

  if (rawRows.length === 0) {
    return { totalRows: 0, validRows: 0, errorRows: 0, newAccounts: 0, existingAccounts: 0, rows: [], errors: [{ row: 0, column: "", message: "File is empty or has no data rows" }] };
  }

  // Check required headers
  const requiredHeaders = ["code", "name"];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      totalRows: 0, validRows: 0, errorRows: 0, newAccounts: 0, existingAccounts: 0, rows: [],
      errors: [{ row: 0, column: "", message: `Missing required column(s): ${missingHeaders.join(", ")}. Found: ${headers.join(", ")}` }],
    };
  }

  // Load existing accounts for this entity
  const existingAccounts = await prisma.account.findMany({
    where: { entityId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  const existingByCode = new Map(existingAccounts.map(a => [a.code, a]));

  // Track codes in the import for duplicate detection
  const importCodes = new Map<string, number>();

  const allErrors: COAImportError[] = [];
  const previewRows: COAPreviewRow[] = [];
  let newCount = 0;
  let existingCount = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2; // 1-based, skip header
    const { row, errors } = parseRow(rawRows[i], rowNum);

    if (!row) {
      allErrors.push(...errors);
      continue;
    }

    const issues: string[] = errors.map(e => `${e.column}: ${e.message}`);

    // Duplicate in file
    if (importCodes.has(row.code)) {
      issues.push(`Duplicate code "${row.code}" — first on row ${importCodes.get(row.code)}`);
    }
    importCodes.set(row.code, rowNum);

    // Parent code validation
    if (row.parentCode) {
      const parentExists = existingByCode.has(row.parentCode) || importCodes.has(row.parentCode);
      if (!parentExists) {
        issues.push(`Parent code "${row.parentCode}" not found (must exist in DB or earlier in file)`);
      }
    }

    const existing = existingByCode.get(row.code);
    let status: "new" | "exists" | "update" | "error" = "new";

    if (errors.some(e => e.column === "code" || e.column === "type")) {
      status = "error";
    } else if (existing?.isActive) {
      status = "update";
      existingCount++;
    } else if (existing && !existing.isActive) {
      status = "update"; // reactivate
      issues.push("Account exists but is inactive — will be reactivated");
    } else {
      newCount++;
    }

    previewRows.push({
      ...row,
      status,
      existingId: existing?.id,
      issues,
    });

    allErrors.push(...errors);
  }

  return {
    totalRows: rawRows.length,
    validRows: previewRows.filter(r => r.status !== "error").length,
    errorRows: previewRows.filter(r => r.status === "error").length,
    newAccounts: newCount,
    existingAccounts: existingCount,
    rows: previewRows,
    errors: allErrors,
  };
}

// ── 2. Execute import ─────────────────────────────────────────────────────────

export type COAExecuteOptions = {
  updateExisting: boolean;      // Update accounts that already exist
  reactivateInactive: boolean;  // Reactivate soft-deleted accounts
  skipErrors: boolean;          // Skip rows with errors instead of aborting
};

const DEFAULT_OPTS: COAExecuteOptions = {
  updateExisting: true,
  reactivateInactive: true,
  skipErrors: true,
};

export async function executeCOAImport(
  prisma: PrismaClient,
  entityId: string,
  input: FileInput,
  options?: Partial<COAExecuteOptions>
): Promise<COAImportResult> {
  const opts = { ...DEFAULT_OPTS, ...options };
  const { rows: rawRows } = parseFile(input);

  const result: COAImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  // Load existing accounts
  const existingAccounts = await prisma.account.findMany({
    where: { entityId },
    select: { id: true, code: true, isActive: true },
  });
  const existingByCode = new Map(existingAccounts.map(a => [a.code, a]));

  // First pass: create/update accounts WITHOUT parent links (to avoid ordering issues)
  const pendingParents: Array<{ code: string; parentCode: string }> = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2;
    const { row, errors } = parseRow(rawRows[i], rowNum);

    if (!row) {
      result.errors.push(...errors);
      result.skipped++;
      continue;
    }

    if (errors.length > 0) {
      if (opts.skipErrors) {
        result.errors.push(...errors);
        result.skipped++;
        continue;
      } else {
        result.errors.push(...errors);
        return result; // Abort
      }
    }

    const existing = existingByCode.get(row.code);

    try {
      if (!existing) {
        // Create new account (parent linked in second pass)
        const created = await prisma.account.create({
          data: {
            entityId,
            code: row.code,
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            allowPosting: row.allowPosting,
            isControlAccount: row.isControlAccount,
            level: row.level,
            usaliCategory: row.usaliCategory || undefined,
            usaliDepartment: row.usaliDepartment || undefined,
          },
        });
        existingByCode.set(row.code, { id: created.id, code: created.code, isActive: true });
        result.created++;
      } else if (existing.isActive && opts.updateExisting) {
        await prisma.account.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            allowPosting: row.allowPosting,
            isControlAccount: row.isControlAccount,
            level: row.level,
            usaliCategory: row.usaliCategory || undefined,
            usaliDepartment: row.usaliDepartment || undefined,
          },
        });
        result.updated++;
      } else if (!existing.isActive && opts.reactivateInactive) {
        await prisma.account.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            allowPosting: row.allowPosting,
            isControlAccount: row.isControlAccount,
            level: row.level,
            isActive: true,
            usaliCategory: row.usaliCategory || undefined,
            usaliDepartment: row.usaliDepartment || undefined,
          },
        });
        result.updated++;
      } else {
        result.skipped++;
      }

      // Queue parent assignment for second pass
      if (row.parentCode) {
        pendingParents.push({ code: row.code, parentCode: row.parentCode });
      }
    } catch (err) {
      result.errors.push({
        row: rowNum,
        column: "code",
        message: `DB error: ${err instanceof Error ? err.message : String(err)}`,
      });
      if (!opts.skipErrors) return result;
      result.skipped++;
    }
  }

  // Second pass: link parents
  for (const { code, parentCode } of pendingParents) {
    const account = existingByCode.get(code);
    const parent = existingByCode.get(parentCode);

    if (account && parent) {
      try {
        await prisma.account.update({
          where: { id: account.id },
          data: { parentId: parent.id },
        });
      } catch (err) {
        result.errors.push({
          row: 0,
          column: "parentCode",
          message: `Failed to link ${code} → ${parentCode}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return result;
}
