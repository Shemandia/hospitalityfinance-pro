/**
 * Transfer Desk — Universal Data Transformation Engine
 *
 * SunSystems-style interface definition engine that can accept ANY data format
 * from ANY external system (procurement, PMS, payroll, POS, banks, custom)
 * and transform it into GL journals, AP invoices, or supplier records.
 *
 * Supported source formats:
 *   CSV, TSV, JSON, XML, FIXED_WIDTH, EXCEL, MT940, SAF
 *
 * Supported target types:
 *   GL_JOURNAL    — General Ledger journal entries
 *   AP_INVOICE    — Accounts Payable supplier invoices
 *   SUPPLIER_SYNC — Supplier master data sync
 *
 * Field mapping source types:
 *   CONSTANT    — Fixed value for all rows
 *   COLUMN      — Direct column reference
 *   LOOKUP      — Translate via ConnectorMapping table
 *   FORMULA     — Template with {column} substitution
 *   EXPRESSION  — Simple math expression with column refs
 *   CONDITIONAL — IF/THEN/ELSE based on column value
 *
 * Transforms:
 *   NONE, UPPERCASE, LOWERCASE, TRIM, ABS, NEGATE, ROUND,
 *   SUBSTRING, REPLACE, SPLIT, LEFT, RIGHT, PAD_LEFT, PAD_RIGHT,
 *   DATE_FORMAT, DATE_PARSE, MULTIPLY, DIVIDE, ADD, CONCAT,
 *   MAP_VALUE, STRIP_NON_NUMERIC, DEFAULT_IF_EMPTY
 */

import * as XLSX from "xlsx";
import type { PrismaClient } from "../../db/client.js";
import { Prisma } from "../../db/client.js";

// ── Decimal helpers ──────────────────────────────────────────────────────────

/** Convert a string to Prisma.Decimal, returning 0 for invalid input. */
function safeDecimal(v: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(v || "0");
  } catch {
    return new Prisma.Decimal(0);
  }
}

/**
 * Evaluate a simple arithmetic expression using Decimal precision.
 * Supports +, -, *, / and parentheses. No eval/Function needed.
 */
function safeDecimalEval(expr: string): Prisma.Decimal {
  // Tokenize: numbers (incl decimals) and operators
  const tokens: string[] = [];
  let i = 0;
  const s = expr.replace(/\s/g, "");
  while (i < s.length) {
    if ("+-*/()".includes(s[i])) {
      tokens.push(s[i]);
      i++;
    } else if (/[0-9.]/.test(s[i])) {
      let num = "";
      while (i < s.length && /[0-9.]/.test(s[i])) {
        num += s[i];
        i++;
      }
      tokens.push(num);
    } else {
      i++; // skip unknown chars
    }
  }

  let pos = 0;

  function parseExpr(): Prisma.Decimal {
    let result = parseTerm();
    while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
      const op = tokens[pos++];
      const right = parseTerm();
      result = op === "+" ? result.add(right) : result.sub(right);
    }
    return result;
  }

  function parseTerm(): Prisma.Decimal {
    let result = parseFactor();
    while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
      const op = tokens[pos++];
      const right = parseFactor();
      result = op === "*" ? result.mul(right) : right.equals(0) ? result : result.div(right);
    }
    return result;
  }

  function parseFactor(): Prisma.Decimal {
    if (tokens[pos] === "(") {
      pos++;
      const result = parseExpr();
      if (tokens[pos] === ")") pos++;
      return result;
    }
    if (tokens[pos] === "-") {
      pos++;
      return parseFactor().neg();
    }
    const token = tokens[pos++] ?? "0";
    return safeDecimal(token);
  }

  return parseExpr();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceFormat = "CSV" | "JSON" | "XML" | "FIXED_WIDTH" | "EXCEL" | "MT940" | "SAF";

export type TargetType = "GL_JOURNAL" | "AP_INVOICE" | "SUPPLIER_SYNC";

export type SourceType =
  | "CONSTANT"
  | "COLUMN"
  | "LOOKUP"
  | "FORMULA"
  | "EXPRESSION"
  | "CONDITIONAL";

export type FieldTransform =
  | "NONE"
  | "UPPERCASE"
  | "LOWERCASE"
  | "TRIM"
  | "ABS"
  | "NEGATE"
  | "ROUND"
  | "SUBSTRING"
  | "REPLACE"
  | "SPLIT"
  | "LEFT"
  | "RIGHT"
  | "PAD_LEFT"
  | "PAD_RIGHT"
  | "DATE_FORMAT"
  | "DATE_PARSE"
  | "MULTIPLY"
  | "DIVIDE"
  | "ADD"
  | "CONCAT"
  | "MAP_VALUE"
  | "STRIP_NON_NUMERIC"
  | "DEFAULT_IF_EMPTY";

export type FieldMappingRule = {
  targetField: string;
  sourceType: SourceType;
  sourceValue: string;
  transform?: FieldTransform;
  transformArg?: string;
  defaultValue?: string;
  required?: boolean;
};

export type ParseOptions = {
  delimiter?: string;
  hasHeader?: boolean;
  skipRows?: number;
  encoding?: string;
  dateFormat?: string;
  decimalSeparator?: string;
  thousandsSeparator?: string;
  /** Fixed-width column definitions: [{name, start, length}] */
  fixedWidthColumns?: Array<{ name: string; start: number; length: number }>;
  /** XML: XPath/tag name for repeating row element */
  xmlRowTag?: string;
  /** Filter: only include rows where column matches value */
  filterRules?: Array<{
    column: string;
    operator: "EQUALS" | "NOT_EQUALS" | "CONTAINS" | "STARTS_WITH" | "GT" | "LT" | "NOT_EMPTY";
    value: string;
  }>;
  /** Grouping: group rows by these column values before creating journals */
  groupBy?: string[];
  maxRows?: number;
};

export type TransformResult = {
  parsedRows: number;
  mappedRows: Array<Record<string, string | null>>;
  errors: Array<{ row: number; field: string; message: string }>;
  unmappedLookups: string[];
  skippedByFilter: number;
  groups?: Array<{
    groupKey: string;
    rows: Array<Record<string, string | null>>;
  }>;
};

// ── Parsers ───────────────────────────────────────────────────────────────────

/**
 * Parse raw data into an array of row objects.
 */
export function parseSourceData(
  data: string | Buffer,
  format: SourceFormat,
  options: ParseOptions = {}
): Record<string, string>[] {
  const text = typeof data === "string" ? data : data.toString("utf-8");

  switch (format) {
    case "CSV":
      return parseCSV(
        text,
        options.delimiter ?? ",",
        options.hasHeader ?? true,
        options.skipRows ?? 0
      );
    case "JSON":
      return parseJSON(text);
    case "XML":
      return parseXML(text, options.xmlRowTag ?? "row");
    case "FIXED_WIDTH":
      return parseFixedWidth(text, options.fixedWidthColumns ?? [], options.skipRows ?? 0);
    case "EXCEL":
      return parseExcel(
        typeof data === "string" ? Buffer.from(data, "base64") : data,
        options.hasHeader ?? true,
        options.skipRows ?? 0
      );
    case "MT940":
      return parseMT940(text);
    case "SAF":
      return parseCSV(text, "|", true, options.skipRows ?? 0);
    default:
      return parseCSV(text, ",", true, 0);
  }
}

function parseCSV(
  text: string,
  delimiter: string,
  hasHeader: boolean,
  skipRows: number
): Record<string, string>[] {
  let lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (skipRows > 0) lines = lines.slice(skipRows);
  if (lines.length === 0) return [];

  // Handle quoted CSV fields
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuotes) {
        inQuotes = true;
        continue;
      }
      if (ch === '"' && inQuotes) {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    result.push(current.trim());
    return result;
  };

  const headers = hasHeader
    ? parseLine(lines[0])
    : parseLine(lines[0]).map((_, i) => `col${i + 1}`);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function parseJSON(text: string): Record<string, string>[] {
  try {
    const parsed = JSON.parse(text);
    const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => {
      const flat: Record<string, string> = {};
      flattenObject(item as Record<string, unknown>, flat, "");
      return flat;
    });
  } catch {
    return [];
  }
}

function flattenObject(
  obj: Record<string, unknown>,
  out: Record<string, string>,
  prefix: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      flattenObject(value as Record<string, unknown>, out, fullKey);
    } else {
      out[fullKey] = value == null ? "" : String(value);
    }
  }
}

function parseXML(text: string, rowTag: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];

  // Simple XML parser — extracts elements matching rowTag
  const rowRegex = new RegExp(`<${rowTag}[^>]*>([\\s\\S]*?)</${rowTag}>`, "gi");
  const elementRegex = /<(\w+)[^>]*>([^<]*)<\/\1>/g;

  let rowMatch;
  while ((rowMatch = rowRegex.exec(text)) !== null) {
    const rowContent = rowMatch[1];
    const row: Record<string, string> = {};
    let elemMatch;
    elementRegex.lastIndex = 0;
    while ((elemMatch = elementRegex.exec(rowContent)) !== null) {
      row[elemMatch[1]] = elemMatch[2].trim();
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }

  return rows;
}

function parseFixedWidth(
  text: string,
  columns: Array<{ name: string; start: number; length: number }>,
  skipRows: number
): Record<string, string>[] {
  if (columns.length === 0) return [];

  let lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (skipRows > 0) lines = lines.slice(skipRows);

  return lines.map((line) => {
    const row: Record<string, string> = {};
    for (const col of columns) {
      row[col.name] = line.substring(col.start, col.start + col.length).trim();
    }
    return row;
  });
}

function parseExcel(
  buffer: Buffer,
  hasHeader: boolean,
  skipRows: number
): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    range: skipRows,
    header: hasHeader ? undefined : 1
  });

  return rawRows.map((raw) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      row[String(k)] = v == null ? "" : String(v);
    }
    return row;
  });
}

function parseMT940(text: string): Record<string, string>[] {
  // MT940 SWIFT format — extract :61: transaction lines
  const rows: Record<string, string>[] = [];
  const lines = text.split(/\r?\n/);

  let currentAccount = "";
  let statementDate = "";

  for (const line of lines) {
    if (line.startsWith(":25:")) {
      currentAccount = line.substring(4).trim();
    } else if (line.startsWith(":60F:") || line.startsWith(":60M:")) {
      const content = line.substring(5);
      statementDate = content.substring(1, 7); // YYMMDD
    } else if (line.startsWith(":61:")) {
      const content = line.substring(4);
      const dateStr = content.substring(0, 6); // YYMMDD
      const dcMark = content.substring(6, 7); // D or C
      const amountMatch = content.match(/[DC](\d+[,.]?\d*)/);
      const amount = amountMatch ? amountMatch[1].replace(",", ".") : "0";
      const refMatch = content.match(/[DC]\d+[,.]?\d*N\w{3}(.+)/);
      const reference = refMatch ? refMatch[1].trim() : "";

      rows.push({
        account: currentAccount,
        valueDate: `20${dateStr.substring(0, 2)}-${dateStr.substring(2, 4)}-${dateStr.substring(4, 6)}`,
        debitCredit: dcMark,
        amount: dcMark === "D" ? `-${amount}` : amount,
        reference,
        statementDate
      });
    } else if (line.startsWith(":86:")) {
      // Additional info — append to last transaction
      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        last.description = (last.description ?? "") + line.substring(4).trim() + " ";
      }
    }
  }

  return rows;
}

// ── Transforms ────────────────────────────────────────────────────────────────

export function applyTransform(value: string, transform: FieldTransform, arg?: string): string {
  switch (transform) {
    case "NONE":
      return value;
    case "UPPERCASE":
      return value.toUpperCase();
    case "LOWERCASE":
      return value.toLowerCase();
    case "TRIM":
      return value.trim();
    case "ABS": {
      const d = safeDecimal(value);
      return d.abs().toString();
    }
    case "NEGATE": {
      const d = safeDecimal(value);
      return d.neg().toString();
    }
    case "ROUND": {
      const decimals = parseInt(arg ?? "2", 10);
      const d = safeDecimal(value);
      return d.toFixed(decimals);
    }
    case "SUBSTRING": {
      // arg: "start,length"
      const [s, l] = (arg ?? "0,10").split(",").map(Number);
      return value.substring(s, s + l);
    }
    case "LEFT": {
      const n = parseInt(arg ?? "1", 10);
      return value.substring(0, n);
    }
    case "RIGHT": {
      const n = parseInt(arg ?? "1", 10);
      return value.substring(value.length - n);
    }
    case "PAD_LEFT": {
      // arg: "length,char"
      const [len, ch] = (arg ?? "10,0").split(",");
      return value.padStart(parseInt(len, 10), ch ?? "0");
    }
    case "PAD_RIGHT": {
      const [len, ch] = (arg ?? "10, ").split(",");
      return value.padEnd(parseInt(len, 10), ch ?? " ");
    }
    case "REPLACE": {
      // arg: "search|replace"
      const [search, replace] = (arg ?? "|").split("|");
      return value.split(search).join(replace ?? "");
    }
    case "SPLIT": {
      // arg: "delimiter,index"
      const [delim, idx] = (arg ?? ",|0").split("|");
      const parts = value.split(delim ?? ",");
      return parts[parseInt(idx ?? "0", 10)] ?? value;
    }
    case "DATE_FORMAT": {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
      } catch {
        /* ignore */
      }
      return value;
    }
    case "DATE_PARSE": {
      // arg: input format hint (e.g., "DD/MM/YYYY", "YYYYMMDD")
      return parseDateString(value, arg ?? "YYYY-MM-DD");
    }
    case "MULTIPLY": {
      const d = safeDecimal(value);
      const factor = safeDecimal(arg ?? "1");
      return d.mul(factor).toString();
    }
    case "DIVIDE": {
      const d = safeDecimal(value);
      const divisor = safeDecimal(arg ?? "1");
      if (divisor.equals(0)) return value;
      return d.div(divisor).toString();
    }
    case "ADD": {
      const d = safeDecimal(value);
      const addend = safeDecimal(arg ?? "0");
      return d.add(addend).toString();
    }
    case "CONCAT": {
      // arg is the suffix to append
      return value + (arg ?? "");
    }
    case "MAP_VALUE": {
      // arg: "key1=val1,key2=val2,*=default"
      const pairs = (arg ?? "").split(",");
      for (const pair of pairs) {
        const [k, v] = pair.split("=");
        if (k === "*") return v ?? value;
        if (k === value) return v ?? value;
      }
      return value;
    }
    case "STRIP_NON_NUMERIC":
      return value.replace(/[^0-9.\-]/g, "");
    case "DEFAULT_IF_EMPTY":
      return value.trim() === "" ? (arg ?? "") : value;
    default:
      return value;
  }
}

function parseDateString(value: string, format: string): string {
  try {
    // Handle common date formats
    if (format === "YYYYMMDD" && /^\d{8}$/.test(value)) {
      return `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;
    }
    if (format === "DD/MM/YYYY" && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [d, m, y] = value.split("/");
      return `${y}-${m}-${d}`;
    }
    if (format === "MM/DD/YYYY" && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [m, d, y] = value.split("/");
      return `${y}-${m}-${d}`;
    }
    if (format === "DD-MM-YYYY" && /^\d{2}-\d{2}-\d{4}$/.test(value)) {
      const [d, m, y] = value.split("-");
      return `${y}-${m}-${d}`;
    }
    if (format === "DD.MM.YYYY" && /^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
      const [d, m, y] = value.split(".");
      return `${y}-${m}-${d}`;
    }
    // Fallback to JS Date
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch {
    /* ignore */
  }
  return value;
}

// ── Filter engine ─────────────────────────────────────────────────────────────

export function applyFilters(
  rows: Record<string, string>[],
  rules: ParseOptions["filterRules"]
): { passed: Record<string, string>[]; skipped: number } {
  if (!rules || rules.length === 0) return { passed: rows, skipped: 0 };

  let skipped = 0;
  const passed = rows.filter((row) => {
    for (const rule of rules!) {
      const val = row[rule.column] ?? "";
      let match = false;
      switch (rule.operator) {
        case "EQUALS":
          match = val === rule.value;
          break;
        case "NOT_EQUALS":
          match = val !== rule.value;
          break;
        case "CONTAINS":
          match = val.includes(rule.value);
          break;
        case "STARTS_WITH":
          match = val.startsWith(rule.value);
          break;
        case "GT":
          match = Number(val) > Number(rule.value);
          break;
        case "LT":
          match = Number(val) < Number(rule.value);
          break;
        case "NOT_EMPTY":
          match = val.trim() !== "";
          break;
      }
      if (!match) {
        skipped++;
        return false;
      }
    }
    return true;
  });

  return { passed, skipped };
}

// ── Transformation engine ─────────────────────────────────────────────────────

export async function runTransformEngine(
  prisma: PrismaClient,
  entityId: string,
  connectorType: string,
  fieldMappings: FieldMappingRule[],
  rows: Record<string, string>[],
  options: ParseOptions = {}
): Promise<TransformResult> {
  // Apply filters
  const { passed: filteredRows, skipped: skippedByFilter } = applyFilters(
    rows,
    options.filterRules
  );

  // Limit rows
  const limitedRows = options.maxRows ? filteredRows.slice(0, options.maxRows) : filteredRows;

  // Load LOOKUP mappings
  const lookupRules = fieldMappings.filter((fm) => fm.sourceType === "LOOKUP");
  const connectorMappings =
    lookupRules.length > 0
      ? await prisma.connectorMapping.findMany({
          where: { entityId, connectorType },
          include: { glAccount: { select: { code: true, name: true } } }
        })
      : [];
  const lookupMap = new Map(
    connectorMappings.map((m) => [m.sourceCode, m.glAccount?.code ?? null])
  );

  const mappedRows: Array<Record<string, string | null>> = [];
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const unmappedLookups = new Set<string>();

  for (let i = 0; i < limitedRows.length; i++) {
    const row = limitedRows[i];
    const mapped: Record<string, string | null> = {};

    for (const rule of fieldMappings) {
      let value: string | null = null;

      switch (rule.sourceType) {
        case "CONSTANT":
          value = rule.sourceValue;
          break;

        case "COLUMN":
          value = row[rule.sourceValue] ?? null;
          if ((value === null || value === "") && rule.required) {
            errors.push({
              row: i + 1,
              field: rule.targetField,
              message: `Column "${rule.sourceValue}" is empty or missing`
            });
          }
          if (value === null || value === "") value = rule.defaultValue ?? null;
          break;

        case "LOOKUP": {
          const sourceKey = row[rule.sourceValue] ?? "";
          const resolved = sourceKey ? (lookupMap.get(sourceKey) ?? null) : null;
          if (resolved === null && sourceKey) unmappedLookups.add(sourceKey);
          value = resolved ?? rule.defaultValue ?? null;
          break;
        }

        case "FORMULA":
          // Template: {columnName} → row[columnName]
          value = rule.sourceValue.replace(/\{(\w[\w.]*)\}/g, (_, col) => row[col] ?? "");
          break;

        case "EXPRESSION": {
          // Simple math: "{amount} * {fxRate}" or "{qty} * {price}"
          try {
            const expr = rule.sourceValue.replace(/\{(\w[\w.]*)\}/g, (_, col) => row[col] ?? "0");
            value = safeDecimalEval(expr).toString();
          } catch {
            value = rule.defaultValue ?? "0";
            errors.push({
              row: i + 1,
              field: rule.targetField,
              message: `Expression error: "${rule.sourceValue}"`
            });
          }
          break;
        }

        case "CONDITIONAL": {
          // Format: "columnName=value?thenValue:elseValue"
          const condMatch = rule.sourceValue.match(/^(.+?)([=!<>]+)(.+?)\?(.+?):(.+)$/);
          if (condMatch) {
            const [, col, op, testVal, thenVal, elseVal] = condMatch;
            const actual = row[col.trim()] ?? "";
            let passes = false;
            if (op === "==" || op === "=") passes = actual === testVal.trim();
            else if (op === "!=") passes = actual !== testVal.trim();
            else if (op === ">") passes = Number(actual) > Number(testVal);
            else if (op === "<") passes = Number(actual) < Number(testVal);
            value = passes ? thenVal.trim() : elseVal.trim();
            // Resolve column references in result
            value = value.replace(/\{(\w[\w.]*)\}/g, (_, c) => row[c] ?? "");
          } else {
            value = rule.defaultValue ?? null;
          }
          break;
        }
      }

      // Apply transformation
      if (value !== null && rule.transform && rule.transform !== "NONE") {
        value = applyTransform(value, rule.transform, rule.transformArg);
      }

      mapped[rule.targetField] = value;
    }

    mappedRows.push(mapped);
  }

  // Group rows if configured
  let groups: TransformResult["groups"] | undefined;
  if (options.groupBy && options.groupBy.length > 0) {
    const groupMap = new Map<string, Array<Record<string, string | null>>>();
    for (const row of mappedRows) {
      const key = options.groupBy.map((col) => row[col] ?? "").join("|");
      const existing = groupMap.get(key);
      if (existing) {
        existing.push(row);
      } else {
        groupMap.set(key, [row]);
      }
    }
    groups = Array.from(groupMap.entries()).map(([groupKey, rows]) => ({ groupKey, rows }));
  }

  return {
    parsedRows: limitedRows.length,
    mappedRows,
    errors,
    unmappedLookups: Array.from(unmappedLookups),
    skippedByFilter,
    groups
  };
}

// ── Target field definitions ──────────────────────────────────────────────────

export const GL_JOURNAL_TARGET_FIELDS = [
  "postingDate",
  "reference",
  "accountCode",
  "debitAmount",
  "creditAmount",
  "currency",
  "lineDescription",
  "dimension1",
  "dimension2",
  "dimension3",
  "dimension4",
  "dimension5",
  "dimension6"
] as const;

export const AP_INVOICE_TARGET_FIELDS = [
  "supplierCode",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "currency",
  "grossAmount",
  "taxAmount",
  "netAmount",
  "lineDescription",
  "lineAmount",
  "lineGLAccountCode",
  "lineTaxCode",
  "lineCostCentre",
  "lineDepartment",
  "externalPoRef",
  "paymentTerms"
] as const;

export const SUPPLIER_SYNC_TARGET_FIELDS = [
  "code",
  "name",
  "taxId",
  "currency",
  "paymentTermsDays",
  "bankAccountName",
  "bankAccountNumber",
  "bankRoutingCode",
  "bankSwiftCode",
  "isActive",
  "contactEmail",
  "contactPhone",
  "address"
] as const;

export const ALL_SOURCE_TYPES: SourceType[] = [
  "CONSTANT",
  "COLUMN",
  "LOOKUP",
  "FORMULA",
  "EXPRESSION",
  "CONDITIONAL"
];

export const ALL_TRANSFORMS: FieldTransform[] = [
  "NONE",
  "UPPERCASE",
  "LOWERCASE",
  "TRIM",
  "ABS",
  "NEGATE",
  "ROUND",
  "SUBSTRING",
  "LEFT",
  "RIGHT",
  "PAD_LEFT",
  "PAD_RIGHT",
  "REPLACE",
  "SPLIT",
  "CONCAT",
  "DATE_FORMAT",
  "DATE_PARSE",
  "MULTIPLY",
  "DIVIDE",
  "ADD",
  "MAP_VALUE",
  "STRIP_NON_NUMERIC",
  "DEFAULT_IF_EMPTY"
];

export const ALL_SOURCE_FORMATS: SourceFormat[] = [
  "CSV",
  "JSON",
  "XML",
  "FIXED_WIDTH",
  "EXCEL",
  "MT940",
  "SAF"
];

export const ALL_CONNECTOR_TYPES = [
  "OPERA_CLOUD",
  "OPERA_SUN",
  "SIMPHONY_POS",
  "SKY_JANA",
  "BANK",
  "PAYROLL",
  "PROCUREMENT",
  "CUSTOM"
] as const;
