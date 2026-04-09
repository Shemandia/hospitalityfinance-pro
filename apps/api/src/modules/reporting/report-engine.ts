import type { PrismaClient } from "../../db/client.js";
import type {
  FALTemplate,
  FSLTemplate,
  FSLRow,
  FSLColumn,
  FTLTemplate,
  ReportTemplate,
  ReportColumnDef,
  ReportRow,
  ReportResult,
  ExecuteReportInput
} from "./report-types.js";

// ── Execute Report (dispatcher) ─────────────────────────────────────────────

export async function executeReport(
  prisma: PrismaClient,
  entityId: string,
  reportName: string,
  template: ReportTemplate,
  params: {
    periodId: string;
    comparativePeriodId?: string;
    budgetDefinitionId?: string;
  }
): Promise<ReportResult> {
  const period = await (prisma as any).period.findFirst({
    where: { id: params.periodId, entityId }
  });
  if (!period) {
    throw new Error("Period not found.");
  }

  const periodName = period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`;

  let columns: ReportColumnDef[];
  let rows: ReportRow[];

  switch (template.writer) {
    case "FAL":
      ({ columns, rows } = await executeFAL(prisma, entityId, template, params));
      break;
    case "FSL":
      ({ columns, rows } = await executeFSL(prisma, entityId, template, params, period));
      break;
    case "FTL":
      ({ columns, rows } = await executeFTL(prisma, entityId, template, params));
      break;
    default:
      throw new Error(`Unknown report writer: ${(template as any).writer}`);
  }

  return {
    columns,
    rows,
    metadata: {
      reportName,
      reportType: template.writer,
      entityId,
      periodName,
      generatedAt: new Date().toISOString()
    }
  };
}

// ── FAL — Financial Account Listing ─────────────────────────────────────────

async function executeFAL(
  prisma: PrismaClient,
  entityId: string,
  template: FALTemplate,
  params: { periodId: string; budgetDefinitionId?: string }
): Promise<{ columns: ReportColumnDef[]; rows: ReportRow[] }> {
  // Build account filter
  const accountWhere: any = { entityId, isActive: true };
  if (template.accountCodeFrom || template.accountCodeTo) {
    accountWhere.code = {};
    if (template.accountCodeFrom) accountWhere.code.gte = template.accountCodeFrom;
    if (template.accountCodeTo) accountWhere.code.lte = template.accountCodeTo;
  }
  if (template.accountTypes?.length) {
    accountWhere.type = { in: template.accountTypes };
  }

  const accounts = await (prisma as any).account.findMany({
    where: accountWhere,
    orderBy: { code: template.sortDirection === "DESC" ? "desc" : "asc" }
  });

  // Get balances for the period
  const balanceMap = new Map<string, any>();
  if (accounts.length > 0) {
    const balances = await (prisma as any).accountPeriodBalance.findMany({
      where: {
        entityId,
        periodId: params.periodId,
        accountId: { in: accounts.map((a: any) => a.id) }
      }
    });
    for (const b of balances) {
      balanceMap.set(b.accountId, b);
    }
  }

  // Get budget data if requested
  const budgetMap = new Map<string, number>();
  if (template.columns.includes("budget") && params.budgetDefinitionId) {
    const budgetLines = await (prisma as any).budgetLine.findMany({
      where: { budgetDefinitionId: params.budgetDefinitionId }
    });
    for (const bl of budgetLines) {
      budgetMap.set(bl.accountId, Number(bl.amount));
    }
  }

  // Build column definitions
  const colDefs: ReportColumnDef[] = template.columns.map((col) => {
    switch (col) {
      case "code":
        return { key: "code", label: "Account Code", align: "left" as const };
      case "name":
        return { key: "name", label: "Account Name", align: "left" as const };
      case "type":
        return { key: "type", label: "Type", align: "left" as const };
      case "opening":
        return { key: "opening", label: "Opening Balance", align: "right" as const };
      case "debit":
        return { key: "debit", label: "Debits", align: "right" as const };
      case "credit":
        return { key: "credit", label: "Credits", align: "right" as const };
      case "closing":
        return { key: "closing", label: "Closing Balance", align: "right" as const };
      case "budget":
        return { key: "budget", label: "Budget", align: "right" as const };
      case "variance":
        return { key: "variance", label: "Variance", align: "right" as const };
      case "variancePct":
        return { key: "variancePct", label: "Variance %", align: "right" as const };
      default:
        return { key: col, label: col, align: "right" as const };
    }
  });

  // Build data rows
  const dataRows: ReportRow[] = [];
  let rowIndex = 0;

  for (const account of accounts) {
    const bal = balanceMap.get(account.id);
    const opening = bal ? Number(bal.openingBalance) : 0;
    const debit = bal ? Number(bal.periodDebits) : 0;
    const credit = bal ? Number(bal.periodCredits) : 0;
    const closing = bal ? Number(bal.closingBalance) : 0;

    if (
      !template.showZeroBalances &&
      opening === 0 &&
      debit === 0 &&
      credit === 0 &&
      closing === 0
    ) {
      continue;
    }

    const budgetAmt = budgetMap.get(account.id) ?? 0;
    const variance = closing - budgetAmt;
    const variancePct = budgetAmt !== 0 ? (variance / Math.abs(budgetAmt)) * 100 : 0;

    const values: Record<string, number | null> = {};
    for (const col of template.columns) {
      switch (col) {
        case "code":
          values.code = null;
          break; // text handled via label
        case "name":
          values.name = null;
          break;
        case "type":
          values.type = null;
          break;
        case "opening":
          values.opening = opening;
          break;
        case "debit":
          values.debit = debit;
          break;
        case "credit":
          values.credit = credit;
          break;
        case "closing":
          values.closing = closing;
          break;
        case "budget":
          values.budget = budgetAmt;
          break;
        case "variance":
          values.variance = variance;
          break;
        case "variancePct":
          values.variancePct = round2(variancePct);
          break;
      }
    }

    dataRows.push({
      rowIndex,
      type: "data",
      label: `${account.code} — ${account.name}`,
      values,
      drillDown: {
        accountCodeFrom: account.code,
        accountCodeTo: account.code,
        periodId: params.periodId,
        accountTypes: [account.type]
      }
    });
    rowIndex++;
  }

  return { columns: colDefs, rows: dataRows };
}

// ── FSL — Financial Statement Listing ───────────────────────────────────────

async function executeFSL(
  prisma: PrismaClient,
  entityId: string,
  template: FSLTemplate,
  params: { periodId: string; comparativePeriodId?: string; budgetDefinitionId?: string },
  period: any
): Promise<{ columns: ReportColumnDef[]; rows: ReportRow[] }> {
  // Preload all account balances for the entity/period in one query
  const periodBalances = await loadBalancesByCode(prisma, entityId, params.periodId);

  // YTD: load all periods in same year up to current month
  let ytdBalances: Map<string, BalanceData> | null = null;
  const needsYTD = template.columns.some((c) => c.type === "YTD");
  if (needsYTD) {
    const ytdPeriods = await (prisma as any).period.findMany({
      where: { entityId, year: period.year, month: { lte: period.month } },
      select: { id: true }
    });
    ytdBalances = await loadBalancesByCodeMultiPeriod(
      prisma,
      entityId,
      ytdPeriods.map((p: any) => p.id)
    );
  }

  // Comparative period balances
  let compBalances: Map<string, BalanceData> | null = null;
  const needsComp = template.columns.some(
    (c) =>
      c.type === "COMPARATIVE" ||
      (c.type === "VARIANCE" && c.against === "COMPARATIVE") ||
      (c.type === "VARIANCE_PCT" && c.against === "COMPARATIVE")
  );
  if (needsComp) {
    let compPeriodId = params.comparativePeriodId;
    if (!compPeriodId) {
      // Default: same month, prior year
      const priorPeriod = await (prisma as any).period.findFirst({
        where: { entityId, year: period.year - 1, month: period.month }
      });
      compPeriodId = priorPeriod?.id;
    }
    if (compPeriodId) {
      compBalances = await loadBalancesByCode(prisma, entityId, compPeriodId);
    }
  }

  // Budget data
  let budgetMap: Map<string, number> | null = null;
  const needsBudget = template.columns.some(
    (c) =>
      c.type === "BUDGET" ||
      (c.type === "VARIANCE" && c.against === "BUDGET") ||
      (c.type === "VARIANCE_PCT" && c.against === "BUDGET")
  );
  if (needsBudget) {
    let budgetDefId = params.budgetDefinitionId;
    if (!budgetDefId) {
      const budgetDef = await (prisma as any).budgetDefinition.findFirst({
        where: { entityId, year: period.year, isActive: true }
      });
      budgetDefId = budgetDef?.id;
    }
    if (budgetDefId) {
      budgetMap = await loadBudgetByCode(prisma, budgetDefId, period.month);
    }
  }

  // Build column definitions
  const colDefs: ReportColumnDef[] = [{ key: "label", label: "", align: "left" }];

  for (let ci = 0; ci < template.columns.length; ci++) {
    const col = template.columns[ci];
    const key = `col_${ci}`;
    const label = col.label ?? getDefaultColumnLabel(col, period);
    colDefs.push({ key, label, align: "right" });
  }

  // Process rows
  const resultRows: ReportRow[] = [];
  // Store computed row values for subtotal/formula references
  const rowValuesMap: Map<number, Record<string, number>> = new Map();

  for (let ri = 0; ri < template.rows.length; ri++) {
    const rowDef = template.rows[ri];

    if (rowDef.type === "BLANK") {
      resultRows.push({
        rowIndex: ri,
        type: "blank",
        label: "",
        values: {}
      });
      continue;
    }

    if (rowDef.type === "HEADING") {
      resultRows.push({
        rowIndex: ri,
        type: "heading",
        label: rowDef.label,
        values: {},
        formatting: { bold: true, level: rowDef.level }
      });
      continue;
    }

    if (rowDef.type === "ACCOUNTS") {
      const colValues: Record<string, number> = {};

      for (let ci = 0; ci < template.columns.length; ci++) {
        const col = template.columns[ci];
        const key = `col_${ci}`;
        const val = computeAccountsColumnValue(
          col,
          rowDef,
          periodBalances,
          ytdBalances,
          compBalances,
          budgetMap
        );
        colValues[key] = val;
      }

      rowValuesMap.set(ri, colValues);
      resultRows.push({
        rowIndex: ri,
        type: "data",
        label: rowDef.label,
        values: colValues,
        formatting: { indent: rowDef.indent },
        drillDown: {
          accountCodeFrom: rowDef.accountCodeFrom,
          accountCodeTo: rowDef.accountCodeTo,
          periodId: params.periodId,
          accountTypes: rowDef.accountTypes
        }
      });
      continue;
    }

    if (rowDef.type === "SUBTOTAL") {
      const colValues: Record<string, number> = {};

      for (let ci = 0; ci < template.columns.length; ci++) {
        const key = `col_${ci}`;
        let sum = 0;
        for (const refRow of rowDef.sumRows) {
          const refVals = rowValuesMap.get(refRow);
          if (refVals) sum += refVals[key] ?? 0;
        }
        colValues[key] = round2(sum);
      }

      rowValuesMap.set(ri, colValues);
      resultRows.push({
        rowIndex: ri,
        type: "subtotal",
        label: rowDef.label,
        values: colValues,
        formatting: { bold: rowDef.bold, underline: rowDef.underline }
      });
      continue;
    }

    if (rowDef.type === "FORMULA") {
      const colValues: Record<string, number> = {};

      for (let ci = 0; ci < template.columns.length; ci++) {
        const key = `col_${ci}`;
        colValues[key] = round2(evaluateFormula(rowDef.formula, rowValuesMap, key));
      }

      rowValuesMap.set(ri, colValues);
      resultRows.push({
        rowIndex: ri,
        type: "formula",
        label: rowDef.label,
        values: colValues,
        formatting: { bold: rowDef.bold, underline: rowDef.underline }
      });
      continue;
    }
  }

  return { columns: colDefs, rows: resultRows };
}

// ── FTL — Financial Transaction Listing ─────────────────────────────────────

async function executeFTL(
  prisma: PrismaClient,
  entityId: string,
  template: FTLTemplate,
  params: { periodId: string }
): Promise<{ columns: ReportColumnDef[]; rows: ReportRow[] }> {
  const periodId = template.periodId ?? params.periodId;

  // Build journal line query
  const lineWhere: any = { journal: { entityId, periodId } };

  if (template.accountCodeFrom || template.accountCodeTo) {
    lineWhere.account = { code: {} };
    if (template.accountCodeFrom) lineWhere.account.code.gte = template.accountCodeFrom;
    if (template.accountCodeTo) lineWhere.account.code.lte = template.accountCodeTo;
  }
  if (template.accountTypes?.length) {
    if (!lineWhere.account) lineWhere.account = {};
    lineWhere.account.type = { in: template.accountTypes };
  }
  if (template.reference) {
    lineWhere.journal.reference = { contains: template.reference, mode: "insensitive" };
  }
  if (template.journalTypeId) {
    lineWhere.journal.journalTypeId = template.journalTypeId;
  }
  if (template.source) {
    lineWhere.journal.source = template.source;
  }
  if (template.dateFrom || template.dateTo) {
    lineWhere.journal.createdAt = {};
    if (template.dateFrom) lineWhere.journal.createdAt.gte = new Date(template.dateFrom);
    if (template.dateTo) lineWhere.journal.createdAt.lte = new Date(template.dateTo);
  }

  const lines = await (prisma as any).journalLine.findMany({
    where: lineWhere,
    include: {
      journal: {
        select: {
          id: true,
          reference: true,
          description: true,
          source: true,
          createdAt: true,
          status: true
        }
      },
      account: { select: { code: true, name: true, type: true } }
    },
    orderBy: getFTLOrderBy(template.sortBy, template.sortDirection),
    take: template.limit
  });

  // Apply amount filter in-memory (since it needs computation)
  let filteredLines = lines;
  if (template.amountMin !== undefined || template.amountMax !== undefined) {
    filteredLines = lines.filter((line: any) => {
      const amount =
        Math.abs(Number(line.debitFunctional ?? 0)) + Math.abs(Number(line.creditFunctional ?? 0));
      if (template.amountMin !== undefined && amount < template.amountMin) return false;
      if (template.amountMax !== undefined && amount > template.amountMax) return false;
      return true;
    });
  }

  const columns: ReportColumnDef[] = [
    { key: "date", label: "Date", align: "left" },
    { key: "reference", label: "Reference", align: "left" },
    { key: "account", label: "Account", align: "left" },
    { key: "description", label: "Description", align: "left" },
    { key: "debit", label: "Debit", align: "right" },
    { key: "credit", label: "Credit", align: "right" },
    { key: "source", label: "Source", align: "left" }
  ];

  const rows: ReportRow[] = filteredLines.map((line: any, i: number) => ({
    rowIndex: i,
    type: "data" as const,
    label: `${line.account.code} — ${line.account.name}`,
    values: {
      date: null,
      reference: null,
      account: null,
      description: null,
      debit: Number(line.debitFunctional ?? 0),
      credit: Number(line.creditFunctional ?? 0),
      source: null
    },
    // Stash text fields in formatting metadata for frontend
    formatting: {
      _date: line.journal.createdAt?.toISOString?.() ?? "",
      _reference: line.journal.reference ?? "",
      _account: `${line.account.code} — ${line.account.name}`,
      _description: line.journal.description ?? "",
      _source: line.journal.source ?? ""
    } as any
  }));

  return { columns, rows };
}

// ── Helper Functions ────────────────────────────────────────────────────────

type BalanceData = {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

async function loadBalancesByCode(
  prisma: PrismaClient,
  entityId: string,
  periodId: string
): Promise<Map<string, BalanceData>> {
  const balances = await (prisma as any).accountPeriodBalance.findMany({
    where: { entityId, periodId },
    include: { account: { select: { code: true } } }
  });
  const map = new Map<string, BalanceData>();
  for (const b of balances) {
    map.set(b.account.code, {
      opening: Number(b.openingBalance),
      debit: Number(b.periodDebits),
      credit: Number(b.periodCredits),
      closing: Number(b.closingBalance)
    });
  }
  return map;
}

async function loadBalancesByCodeMultiPeriod(
  prisma: PrismaClient,
  entityId: string,
  periodIds: string[]
): Promise<Map<string, BalanceData>> {
  if (periodIds.length === 0) return new Map();
  const balances = await (prisma as any).accountPeriodBalance.findMany({
    where: { entityId, periodId: { in: periodIds } },
    include: { account: { select: { code: true } } }
  });
  const map = new Map<string, BalanceData>();
  for (const b of balances) {
    const existing = map.get(b.account.code) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
    existing.debit += Number(b.periodDebits);
    existing.credit += Number(b.periodCredits);
    existing.closing += Number(b.closingBalance);
    map.set(b.account.code, existing);
  }
  return map;
}

async function loadBudgetByCode(
  prisma: PrismaClient,
  budgetDefId: string,
  month: number
): Promise<Map<string, number>> {
  const lines = await (prisma as any).budgetLine.findMany({
    where: { budgetDefinitionId: budgetDefId, month },
    include: { account: { select: { code: true } } }
  });
  const map = new Map<string, number>();
  for (const l of lines) {
    const existing = map.get(l.account.code) ?? 0;
    map.set(l.account.code, existing + Number(l.amount));
  }
  return map;
}

function sumBalancesInRange(
  balances: Map<string, BalanceData>,
  codeFrom: string,
  codeTo: string,
  field: keyof BalanceData,
  accountTypes?: string[]
): number {
  let sum = 0;
  for (const [code, data] of balances) {
    if (code >= codeFrom && code <= codeTo) {
      sum += data[field];
    }
  }
  return sum;
}

function sumBudgetInRange(
  budgetMap: Map<string, number> | null,
  codeFrom: string,
  codeTo: string
): number {
  if (!budgetMap) return 0;
  let sum = 0;
  for (const [code, amount] of budgetMap) {
    if (code >= codeFrom && code <= codeTo) {
      sum += amount;
    }
  }
  return sum;
}

function computeAccountsColumnValue(
  col: FSLColumn,
  rowDef: Extract<FSLRow, { type: "ACCOUNTS" }>,
  periodBalances: Map<string, BalanceData>,
  ytdBalances: Map<string, BalanceData> | null,
  compBalances: Map<string, BalanceData> | null,
  budgetMap: Map<string, number> | null
): number {
  const sign = rowDef.sign === "REVERSE" ? -1 : 1;
  const from = rowDef.accountCodeFrom;
  const to = rowDef.accountCodeTo;

  switch (col.type) {
    case "PERIOD": {
      const val = sumBalancesInRange(periodBalances, from, to, "closing");
      return round2(val * sign);
    }
    case "YTD": {
      if (!ytdBalances) return 0;
      const val = sumBalancesInRange(ytdBalances, from, to, "closing");
      return round2(val * sign);
    }
    case "COMPARATIVE": {
      if (!compBalances) return 0;
      const val = sumBalancesInRange(compBalances, from, to, "closing");
      return round2(val * sign);
    }
    case "BUDGET": {
      return round2(sumBudgetInRange(budgetMap, from, to) * sign);
    }
    case "VARIANCE": {
      const actual = sumBalancesInRange(periodBalances, from, to, "closing") * sign;
      let base: number;
      if (col.against === "BUDGET") {
        base = sumBudgetInRange(budgetMap, from, to) * sign;
      } else {
        base = compBalances ? sumBalancesInRange(compBalances, from, to, "closing") * sign : 0;
      }
      return round2(actual - base);
    }
    case "VARIANCE_PCT": {
      const actual = sumBalancesInRange(periodBalances, from, to, "closing") * sign;
      let base: number;
      if (col.against === "BUDGET") {
        base = sumBudgetInRange(budgetMap, from, to) * sign;
      } else {
        base = compBalances ? sumBalancesInRange(compBalances, from, to, "closing") * sign : 0;
      }
      if (base === 0) return 0;
      return round2(((actual - base) / Math.abs(base)) * 100);
    }
  }
}

/**
 * Evaluate a formula like "R0+R1-R4" or "R2+R3"
 * Rn refers to the computed value of row n for the given column key.
 */
function evaluateFormula(
  formula: string,
  rowValuesMap: Map<number, Record<string, number>>,
  colKey: string
): number {
  // Parse formula tokens: R0, +, R1, -, R4, etc.
  const tokens = formula.match(/[+\-]?R\d+/g);
  if (!tokens) return 0;

  let result = 0;
  for (const token of tokens) {
    const match = token.match(/([+\-]?)R(\d+)/);
    if (!match) continue;
    const sign = match[1] === "-" ? -1 : 1;
    const rowIdx = parseInt(match[2], 10);
    const rowVals = rowValuesMap.get(rowIdx);
    result += sign * (rowVals?.[colKey] ?? 0);
  }
  return result;
}

function getDefaultColumnLabel(col: FSLColumn, period: any): string {
  switch (col.type) {
    case "PERIOD":
      return `${period.year}-${String(period.month).padStart(2, "0")}`;
    case "YTD":
      return `YTD ${period.year}`;
    case "COMPARATIVE":
      return `${period.year - 1}-${String(period.month).padStart(2, "0")}`;
    case "BUDGET":
      return "Budget";
    case "VARIANCE":
      return `Var. vs ${col.against === "BUDGET" ? "Budget" : "Prior"}`;
    case "VARIANCE_PCT":
      return `Var. % vs ${col.against === "BUDGET" ? "Budget" : "Prior"}`;
  }
}

function getFTLOrderBy(sortBy: string, sortDirection: string) {
  const dir = sortDirection === "ASC" ? "asc" : "desc";
  switch (sortBy) {
    case "date":
      return { journal: { createdAt: dir } };
    case "reference":
      return { journal: { reference: dir } };
    case "amount":
      return { debitFunctional: dir };
    case "account":
      return { account: { code: dir } };
    default:
      return { journal: { createdAt: dir } };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── System Report Definitions ───────────────────────────────────────────────

export const SYSTEM_DEFINITIONS: Array<{
  name: string;
  type: string;
  template: ReportTemplate;
}> = [
  {
    name: "Trial Balance",
    type: "FAL",
    template: {
      writer: "FAL",
      columns: ["code", "name", "type", "opening", "debit", "credit", "closing"],
      showZeroBalances: false,
      groupBy: "type",
      sortBy: "code",
      sortDirection: "ASC"
    }
  },
  {
    name: "Balance Sheet",
    type: "FSL",
    template: {
      writer: "FSL",
      rows: [
        { type: "HEADING", label: "ASSETS", level: 1 },
        { type: "HEADING", label: "Current Assets", level: 2 },
        {
          type: "ACCOUNTS",
          label: "Cash & Cash Equivalents",
          accountCodeFrom: "1000",
          accountCodeTo: "1199",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Accounts Receivable",
          accountCodeFrom: "1200",
          accountCodeTo: "1299",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Inventories",
          accountCodeFrom: "1300",
          accountCodeTo: "1399",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Prepaid Expenses",
          accountCodeFrom: "1400",
          accountCodeTo: "1499",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Current Assets",
          sumRows: [2, 3, 4, 5],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        { type: "HEADING", label: "Non-Current Assets", level: 2 },
        {
          type: "ACCOUNTS",
          label: "Property, Plant & Equipment",
          accountCodeFrom: "1500",
          accountCodeTo: "1699",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Intangible Assets",
          accountCodeFrom: "1700",
          accountCodeTo: "1799",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Other Assets",
          accountCodeFrom: "1800",
          accountCodeTo: "1999",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Non-Current Assets",
          sumRows: [9, 10, 11],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        {
          type: "FORMULA",
          label: "TOTAL ASSETS",
          formula: "R6+R12",
          bold: true,
          underline: "DOUBLE"
        },
        { type: "BLANK" },
        { type: "HEADING", label: "LIABILITIES", level: 1 },
        { type: "HEADING", label: "Current Liabilities", level: 2 },
        {
          type: "ACCOUNTS",
          label: "Accounts Payable",
          accountCodeFrom: "2000",
          accountCodeTo: "2099",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Accrued Liabilities",
          accountCodeFrom: "2100",
          accountCodeTo: "2299",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Short-Term Debt",
          accountCodeFrom: "2300",
          accountCodeTo: "2499",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Current Liabilities",
          sumRows: [18, 19, 20],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        {
          type: "ACCOUNTS",
          label: "Long-Term Debt",
          accountCodeFrom: "2500",
          accountCodeTo: "2699",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Liabilities",
          sumRows: [21, 23],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        { type: "HEADING", label: "EQUITY", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Share Capital & Retained Earnings",
          accountCodeFrom: "3000",
          accountCodeTo: "3999",
          sign: "REVERSE",
          indent: 1
        },
        { type: "SUBTOTAL", label: "Total Equity", sumRows: [27], bold: true, underline: "SINGLE" },
        { type: "BLANK" },
        {
          type: "FORMULA",
          label: "TOTAL LIABILITIES & EQUITY",
          formula: "R24+R28",
          bold: true,
          underline: "DOUBLE"
        }
      ],
      columns: [{ type: "PERIOD" }, { type: "COMPARATIVE" }]
    }
  },
  {
    name: "Income Statement",
    type: "FSL",
    template: {
      writer: "FSL",
      rows: [
        { type: "HEADING", label: "REVENUE", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Room Revenue",
          accountCodeFrom: "3000",
          accountCodeTo: "3019",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Food & Beverage Revenue",
          accountCodeFrom: "3100",
          accountCodeTo: "3399",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Other Revenue",
          accountCodeFrom: "3400",
          accountCodeTo: "3999",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Revenue",
          sumRows: [1, 2, 3],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        { type: "HEADING", label: "EXPENSES", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Cost of Sales",
          accountCodeFrom: "4000",
          accountCodeTo: "4999",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Payroll & Related",
          accountCodeFrom: "5000",
          accountCodeTo: "5999",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Operating Expenses",
          accountCodeFrom: "6000",
          accountCodeTo: "6999",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Depreciation & Amortization",
          accountCodeFrom: "7000",
          accountCodeTo: "7999",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Expenses",
          sumRows: [7, 8, 9, 10],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        { type: "FORMULA", label: "NET INCOME", formula: "R4-R11", bold: true, underline: "DOUBLE" }
      ],
      columns: [
        { type: "PERIOD" },
        { type: "BUDGET" },
        { type: "VARIANCE", against: "BUDGET" },
        { type: "VARIANCE_PCT", against: "BUDGET" }
      ]
    }
  },
  {
    name: "USALI Departmental P&L",
    type: "FSL",
    template: {
      writer: "FSL",
      rows: [
        { type: "HEADING", label: "OPERATED DEPARTMENTS", level: 1 },
        // Rooms
        { type: "HEADING", label: "Rooms", level: 2 },
        {
          type: "ACCOUNTS",
          label: "Rooms Revenue",
          accountCodeFrom: "3000",
          accountCodeTo: "3019",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Rooms Expenses",
          accountCodeFrom: "6100",
          accountCodeTo: "6199",
          sign: "NATURAL",
          indent: 1
        },
        { type: "FORMULA", label: "Rooms Departmental Income", formula: "R2-R3", bold: true },
        { type: "BLANK" },
        // Food & Beverage
        { type: "HEADING", label: "Food & Beverage", level: 2 },
        {
          type: "ACCOUNTS",
          label: "F&B Revenue",
          accountCodeFrom: "3100",
          accountCodeTo: "3399",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "F&B Cost of Sales",
          accountCodeFrom: "4200",
          accountCodeTo: "4399",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "F&B Other Expenses",
          accountCodeFrom: "6200",
          accountCodeTo: "6299",
          sign: "NATURAL",
          indent: 1
        },
        { type: "FORMULA", label: "F&B Departmental Income", formula: "R7-R8-R9", bold: true },
        { type: "BLANK" },
        // Other Operated
        { type: "HEADING", label: "Other Operated Departments", level: 2 },
        {
          type: "ACCOUNTS",
          label: "Other Revenue",
          accountCodeFrom: "3400",
          accountCodeTo: "3699",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Other Expenses",
          accountCodeFrom: "6300",
          accountCodeTo: "6399",
          sign: "NATURAL",
          indent: 1
        },
        { type: "FORMULA", label: "Other Dept Income", formula: "R13-R14", bold: true },
        { type: "BLANK" },
        // Total Departmental
        {
          type: "FORMULA",
          label: "TOTAL DEPARTMENTAL INCOME",
          formula: "R4+R10+R15",
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        // Undistributed Expenses
        { type: "HEADING", label: "UNDISTRIBUTED OPERATING EXPENSES", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Administrative & General",
          accountCodeFrom: "6400",
          accountCodeTo: "6499",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Sales & Marketing",
          accountCodeFrom: "6600",
          accountCodeTo: "6699",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Property Operations & Maintenance",
          accountCodeFrom: "6700",
          accountCodeTo: "6799",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Utilities",
          accountCodeFrom: "6800",
          accountCodeTo: "6899",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "IT & Telecom",
          accountCodeFrom: "6500",
          accountCodeTo: "6599",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Undistributed Expenses",
          sumRows: [20, 21, 22, 23, 24],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        {
          type: "FORMULA",
          label: "GROSS OPERATING PROFIT",
          formula: "R17-R25",
          bold: true,
          underline: "DOUBLE"
        },
        { type: "BLANK" },
        // Below GOP
        {
          type: "ACCOUNTS",
          label: "Management Fees",
          accountCodeFrom: "7100",
          accountCodeTo: "7199",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Fixed Charges & Insurance",
          accountCodeFrom: "7200",
          accountCodeTo: "7299",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Depreciation & Amortization",
          accountCodeFrom: "7300",
          accountCodeTo: "7999",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Total Below-GOP Charges",
          sumRows: [29, 30, 31],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        {
          type: "FORMULA",
          label: "NET OPERATING INCOME",
          formula: "R27-R32",
          bold: true,
          underline: "DOUBLE"
        }
      ],
      columns: [
        { type: "PERIOD" },
        { type: "YTD" },
        { type: "BUDGET" },
        { type: "VARIANCE", against: "BUDGET" }
      ]
    }
  },
  {
    name: "Cash Flow Statement",
    type: "FSL",
    template: {
      writer: "FSL",
      rows: [
        { type: "HEADING", label: "OPERATING ACTIVITIES", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Revenue",
          accountCodeFrom: "3000",
          accountCodeTo: "3999",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Expenses",
          accountCodeFrom: "4000",
          accountCodeTo: "7999",
          sign: "NATURAL",
          indent: 1
        },
        { type: "FORMULA", label: "Net Income", formula: "R1-R2", bold: false },
        {
          type: "ACCOUNTS",
          label: "Change in Receivables",
          accountCodeFrom: "1200",
          accountCodeTo: "1299",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Change in Payables",
          accountCodeFrom: "2000",
          accountCodeTo: "2099",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Change in Inventory",
          accountCodeFrom: "1300",
          accountCodeTo: "1399",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "FORMULA",
          label: "Net Cash from Operating",
          formula: "R3+R4+R5+R6",
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        { type: "HEADING", label: "INVESTING ACTIVITIES", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Capital Expenditures",
          accountCodeFrom: "1500",
          accountCodeTo: "1999",
          sign: "REVERSE",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Net Cash from Investing",
          sumRows: [10],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        { type: "HEADING", label: "FINANCING ACTIVITIES", level: 1 },
        {
          type: "ACCOUNTS",
          label: "Borrowings",
          accountCodeFrom: "2500",
          accountCodeTo: "2699",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "ACCOUNTS",
          label: "Equity Transactions",
          accountCodeFrom: "3000",
          accountCodeTo: "3199",
          sign: "NATURAL",
          indent: 1
        },
        {
          type: "SUBTOTAL",
          label: "Net Cash from Financing",
          sumRows: [14, 15],
          bold: true,
          underline: "SINGLE"
        },
        { type: "BLANK" },
        {
          type: "FORMULA",
          label: "NET CHANGE IN CASH",
          formula: "R7+R11+R16",
          bold: true,
          underline: "DOUBLE"
        }
      ],
      columns: [{ type: "PERIOD" }, { type: "COMPARATIVE" }]
    }
  }
];
