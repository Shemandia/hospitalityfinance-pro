import * as XLSX from "xlsx";
import { Prisma, PrismaClient } from "@prisma/client";

export type BudgetExcelRow = {
  rowNumber: number;
  accountCode: string;
  month: number;
  amount: string;
  notes: string | null;
};

export type BudgetExcelPreview = {
  rows: BudgetExcelRow[];
  totalRows: number;
  unmappedCodes: string[];
  mappedCodes: string[];
  errors: string[];
};

export type BudgetExcelImportResult = {
  upserted: number;
  skipped: number;
  errors: string[];
};

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  "1": 1,
  feb: 2,
  february: 2,
  "2": 2,
  mar: 3,
  march: 3,
  "3": 3,
  apr: 4,
  april: 4,
  "4": 4,
  may: 5,
  "5": 5,
  jun: 6,
  june: 6,
  "6": 6,
  jul: 7,
  july: 7,
  "7": 7,
  aug: 8,
  august: 8,
  "8": 8,
  sep: 9,
  september: 9,
  "9": 9,
  oct: 10,
  october: 10,
  "10": 10,
  nov: 11,
  november: 11,
  "11": 11,
  dec: 12,
  december: 12,
  "12": 12
};

function parseMonth(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  return MONTH_MAP[s] ?? null;
}

function parseAmount(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  return n.toFixed(4);
}

/**
 * Parse an Excel/CSV buffer for budget import.
 * Expected columns: accountCode (or account_code/code), month, amount, notes (optional)
 */
export function parseBudgetExcel(buffer: Buffer, filename: string): BudgetExcelRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel file has no sheets.");

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: ""
  });

  const rows: BudgetExcelRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNum = i + 2; // Excel row number (1-indexed + header)

    // Flexible column name matching
    const accountCode = String(
      raw["accountCode"] ??
        raw["account_code"] ??
        raw["AccountCode"] ??
        raw["code"] ??
        raw["Code"] ??
        ""
    ).trim();

    const monthVal = raw["month"] ?? raw["Month"] ?? raw["MONTH"] ?? "";
    const month = parseMonth(monthVal);

    const amountVal =
      raw["amount"] ?? raw["Amount"] ?? raw["AMOUNT"] ?? raw["budget"] ?? raw["Budget"] ?? "";
    const amount = parseAmount(amountVal);

    const notes =
      String(
        raw["notes"] ?? raw["Notes"] ?? raw["description"] ?? raw["Description"] ?? ""
      ).trim() || null;

    if (!accountCode) {
      errors.push(`Row ${rowNum}: missing account code`);
      continue;
    }
    if (month == null) {
      errors.push(`Row ${rowNum}: invalid month "${monthVal}"`);
      continue;
    }
    if (amount == null) {
      errors.push(`Row ${rowNum}: invalid amount "${amountVal}"`);
      continue;
    }

    rows.push({ rowNumber: rowNum, accountCode, month, amount, notes });
  }

  return rows;
}

/**
 * Preview the parsed Excel data and check account code mappings.
 */
export async function previewBudgetExcel(
  prisma: PrismaClient,
  entityId: string,
  buffer: Buffer,
  filename: string
): Promise<BudgetExcelPreview> {
  const rows = parseBudgetExcel(buffer, filename);
  const errors: string[] = [];

  // Get unique account codes
  const codes = [...new Set(rows.map((r) => r.accountCode))];

  // Look up accounts by code
  const accounts = await prisma.account.findMany({
    where: { entityId, code: { in: codes }, isActive: true },
    select: { id: true, code: true }
  });
  const codeSet = new Set(accounts.map((a) => a.code));

  const mappedCodes = codes.filter((c) => codeSet.has(c));
  const unmappedCodes = codes.filter((c) => !codeSet.has(c));

  return { rows, totalRows: rows.length, mappedCodes, unmappedCodes, errors };
}

/**
 * Execute the budget Excel import: upsert lines into a budget definition.
 */
export async function executeBudgetExcelImport(
  prisma: PrismaClient,
  entityId: string,
  budgetDefinitionId: string,
  buffer: Buffer,
  filename: string
): Promise<BudgetExcelImportResult> {
  const rows = parseBudgetExcel(buffer, filename);
  const errors: string[] = [];

  // Verify budget definition belongs to entity
  const def = await prisma.budgetDefinition.findFirst({
    where: { id: budgetDefinitionId, entityId }
  });
  if (!def) {
    return { upserted: 0, skipped: 0, errors: ["Budget definition not found."] };
  }

  // Build account code → ID map
  const codes = [...new Set(rows.map((r) => r.accountCode))];
  const accounts = await prisma.account.findMany({
    where: { entityId, code: { in: codes }, isActive: true },
    select: { id: true, code: true }
  });
  const codeToId = new Map(accounts.map((a) => [a.code, a.id]));

  let upserted = 0;
  let skipped = 0;

  // Batch upsert in a transaction (max 1000 at a time)
  const validRows = rows.filter((r) => {
    const accountId = codeToId.get(r.accountCode);
    if (!accountId) {
      errors.push(`Row ${r.rowNumber}: account code "${r.accountCode}" not found`);
      skipped++;
      return false;
    }
    return true;
  });

  // Process in chunks of 500
  const CHUNK_SIZE = 500;
  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    const ops = chunk.map((row) => {
      const accountId = codeToId.get(row.accountCode)!;
      return prisma.budgetLine.upsert({
        where: {
          budgetDefinitionId_accountId_month: {
            budgetDefinitionId,
            accountId,
            month: row.month
          }
        },
        create: {
          budgetDefinitionId,
          accountId,
          month: row.month,
          amount: new Prisma.Decimal(row.amount),
          notes: row.notes
        },
        update: {
          amount: new Prisma.Decimal(row.amount),
          notes: row.notes
        }
      });
    });

    const results = await prisma.$transaction(ops);
    upserted += results.length;
  }

  return { upserted, skipped, errors };
}
