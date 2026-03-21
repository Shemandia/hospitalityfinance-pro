import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

// ─── Data Types ──────────────────────────────────────────────────────────────

export type USALIPdfData = {
  entityName: string;
  periodName: string;
  year: number;
  month: number;
  hasYTD: boolean;
  hasPriorYear: boolean;
  hasBudget: boolean;
  departments: Array<{
    name: string;
    revenue: string;
    expenses: string;
    departmentalIncome: string;
    incomePct: string;
    ytdDeptIncome: string;
    ytdIncomePct: string;
    budgetDeptIncome: string;
    varianceAmount: string;
    variancePct: string;
    priorDeptIncome: string;
    priorIncomePct: string;
  }>;
  totalRevenue: string;
  totalDepartmentalExpenses: string;
  totalDepartmentalIncome: string;
  undistributedExpenses: string;
  grossOperatingProfit: string;
  gopPct: string;
  managementFees: string;
  ebitda: string;
  ebitdaPct: string;
  ytdTotalRevenue: string;
  ytdGOP: string;
  ytdGOPPct: string;
  ytdEBITDA: string;
  ytdEBITDAPct: string;
  priorTotalRevenue: string;
  priorGOP: string;
  priorGOPPct: string;
  budgetTotalRevenue: string;
  budgetGOP: string;
  budgetEBITDA: string;
  revenueVariance: string;
  gopVariance: string;
  gopVariancePct: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatGeneratedDate(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const NAVY = "#1a3b6e";
const ALT_ROW = "#f8fafc";
const WHITE = "#ffffff";

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 8,
    fontFamily: "Helvetica"
  },

  // Header
  entityName: {
    fontSize: 12,
    fontWeight: "bold",
    color: NAVY
  },
  title: {
    fontSize: 14,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 2
  },
  periodLabel: {
    fontSize: 9,
    textAlign: "center",
    color: "#555",
    marginBottom: 12
  },

  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 5,
    paddingHorizontal: 2
  },
  headerText: {
    fontSize: 7,
    fontWeight: "bold",
    color: WHITE,
    textAlign: "center"
  },
  headerTextLeft: {
    fontSize: 7,
    fontWeight: "bold",
    color: WHITE,
    textAlign: "left",
    paddingLeft: 4
  },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0"
  },
  rowAlt: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    backgroundColor: ALT_ROW
  },
  highlightRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: "#e8edf4",
    borderBottomWidth: 1,
    borderBottomColor: NAVY
  },
  separatorRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: NAVY,
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    backgroundColor: "#f0f4f8"
  },
  cellLeft: {
    fontSize: 7,
    textAlign: "left",
    paddingLeft: 4
  },
  cellRight: {
    fontSize: 7,
    textAlign: "right",
    paddingRight: 4
  },
  cellBoldLeft: {
    fontSize: 7,
    fontWeight: "bold",
    textAlign: "left",
    paddingLeft: 4
  },
  cellBoldRight: {
    fontSize: 7,
    fontWeight: "bold",
    textAlign: "right",
    paddingRight: 4
  },

  // Footer
  footer: {
    fontSize: 6,
    color: "#999",
    textAlign: "right",
    marginTop: 16
  }
});

// ─── Column Widths ───────────────────────────────────────────────────────────

/** Returns column width specs based on which optional columns are visible. */
function getColumnWidths(hasYTD: boolean, hasBudget: boolean, hasPriorYear: boolean) {
  // Base columns: Department, Revenue, Expenses, Dept Income, Income%
  // Optional: YTD Income, YTD%, Budget, Variance, Var%, Prior Year, Prior%
  const optionalCount = (hasYTD ? 2 : 0) + (hasBudget ? 3 : 0) + (hasPriorYear ? 2 : 0);

  // Total = 5 base + optionalCount
  const totalCols = 5 + optionalCount;

  // Allocate widths: department name gets more space
  const deptW = totalCols <= 5 ? "24%" : totalCols <= 7 ? "20%" : totalCols <= 9 ? "17%" : "14%";
  const deptNum = parseFloat(deptW);
  const remaining = 100 - deptNum;
  const dataCols = totalCols - 1;
  const colW = `${(remaining / dataCols).toFixed(1)}%`;

  return { deptW, colW };
}

// ─── Document Builder ────────────────────────────────────────────────────────

function buildUSALIDocument(data: USALIPdfData) {
  const el = React.createElement;
  const { hasYTD, hasBudget, hasPriorYear } = data;
  const { deptW, colW } = getColumnWidths(hasYTD, hasBudget, hasPriorYear);

  // Helper to create a text cell
  const cell = (text: string, width: string, style: Record<string, unknown>) =>
    el(View, { style: { width } }, el(Text, { style: style as never }, text));

  const cellL = (text: string, width: string) => cell(text, width, styles.cellLeft);
  const cellR = (text: string, width: string) => cell(text, width, styles.cellRight);
  const cellBL = (text: string, width: string) => cell(text, width, styles.cellBoldLeft);
  const cellBR = (text: string, width: string) => cell(text, width, styles.cellBoldRight);
  const headerL = (text: string, width: string) => cell(text, width, styles.headerTextLeft);
  const headerC = (text: string, width: string) => cell(text, width, styles.headerText);

  // Build header columns
  const headerCols = [
    headerL("Department", deptW),
    headerC("Revenue", colW),
    headerC("Expenses", colW),
    headerC("Dept Income", colW),
    headerC("Income %", colW)
  ];
  if (hasYTD) {
    headerCols.push(headerC("YTD Income", colW));
    headerCols.push(headerC("YTD %", colW));
  }
  if (hasBudget) {
    headerCols.push(headerC("Budget", colW));
    headerCols.push(headerC("Variance", colW));
    headerCols.push(headerC("Var %", colW));
  }
  if (hasPriorYear) {
    headerCols.push(headerC("Prior Year", colW));
    headerCols.push(headerC("Prior %", colW));
  }

  // Build a data row
  function buildDeptRow(dept: USALIPdfData["departments"][number], idx: number) {
    const rowStyle = idx % 2 === 0 ? styles.row : styles.rowAlt;
    const cols = [
      cellL(dept.name, deptW),
      cellR(dept.revenue, colW),
      cellR(dept.expenses, colW),
      cellR(dept.departmentalIncome, colW),
      cellR(dept.incomePct, colW)
    ];
    if (hasYTD) {
      cols.push(cellR(dept.ytdDeptIncome, colW));
      cols.push(cellR(dept.ytdIncomePct, colW));
    }
    if (hasBudget) {
      cols.push(cellR(dept.budgetDeptIncome, colW));
      cols.push(cellR(dept.varianceAmount, colW));
      cols.push(cellR(dept.variancePct, colW));
    }
    if (hasPriorYear) {
      cols.push(cellR(dept.priorDeptIncome, colW));
      cols.push(cellR(dept.priorIncomePct, colW));
    }
    return el(View, { key: `dept-${idx}`, style: rowStyle }, ...cols);
  }

  // Build a separator / total row
  function buildSeparatorRow(label: string, values: string[], bold: boolean, highlight: boolean) {
    const rowStyle = highlight ? styles.highlightRow : styles.separatorRow;
    const lCell = bold ? cellBL(label, deptW) : cellL(label, deptW);
    const vCells = values.map((v, i) => (bold ? cellBR(v, colW) : cellR(v, colW)));
    return el(View, { style: rowStyle }, lCell, ...vCells);
  }

  // Assemble total operated departments values
  const totalDeptValues = [
    data.totalRevenue,
    data.totalDepartmentalExpenses,
    data.totalDepartmentalIncome,
    ""
  ];
  if (hasYTD) {
    totalDeptValues.push("", "");
  }
  if (hasBudget) {
    totalDeptValues.push("", "", "");
  }
  if (hasPriorYear) {
    totalDeptValues.push("", "");
  }

  // Undistributed expenses row
  const undistValues = ["", data.undistributedExpenses, "", ""];
  if (hasYTD) {
    undistValues.push("", "");
  }
  if (hasBudget) {
    undistValues.push("", "", "");
  }
  if (hasPriorYear) {
    undistValues.push("", "");
  }

  // GOP row values
  const gopValues = [data.totalRevenue, "", data.grossOperatingProfit, data.gopPct];
  if (hasYTD) {
    gopValues.push(data.ytdGOP, data.ytdGOPPct);
  }
  if (hasBudget) {
    gopValues.push(data.budgetGOP, data.gopVariance, data.gopVariancePct);
  }
  if (hasPriorYear) {
    gopValues.push(data.priorGOP, data.priorGOPPct);
  }

  // Management fees row
  const mgmtValues = ["", data.managementFees, "", ""];
  if (hasYTD) {
    mgmtValues.push("", "");
  }
  if (hasBudget) {
    mgmtValues.push("", "", "");
  }
  if (hasPriorYear) {
    mgmtValues.push("", "");
  }

  // EBITDA row values
  const ebitdaValues = [data.totalRevenue, "", data.ebitda, data.ebitdaPct];
  if (hasYTD) {
    ebitdaValues.push(data.ytdEBITDA, data.ytdEBITDAPct);
  }
  if (hasBudget) {
    ebitdaValues.push(data.budgetEBITDA, "", "");
  }
  if (hasPriorYear) {
    ebitdaValues.push("", "");
  }

  return el(
    Document,
    null,
    el(
      Page,
      { size: "A4", orientation: "landscape", style: styles.page },

      // ── Header
      el(Text, { style: styles.entityName }, data.entityName.toUpperCase()),
      el(Text, { style: styles.title }, "USALI SUMMARY OPERATING STATEMENT"),
      el(Text, { style: styles.periodLabel }, `${data.periodName} | ${data.year}`),

      // ── Table header
      el(View, { style: styles.tableHeader }, ...headerCols),

      // ── Department rows
      ...data.departments.map((dept, idx) => buildDeptRow(dept, idx)),

      // ── Total Operated Departments
      buildSeparatorRow("Total Operated Departments", totalDeptValues, true, false),

      // ── Undistributed Operating Expenses
      buildSeparatorRow("Undistributed Operating Expenses", undistValues, false, false),

      // ── GROSS OPERATING PROFIT
      buildSeparatorRow("GROSS OPERATING PROFIT", gopValues, true, true),

      // ── Management Fees
      buildSeparatorRow("Management Fees", mgmtValues, false, false),

      // ── EBITDA
      buildSeparatorRow("EBITDA", ebitdaValues, true, true),

      // ── Footer
      el(Text, { style: styles.footer }, `Generated on ${formatGeneratedDate()}`)
    )
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function renderUSALIPdf(data: USALIPdfData): Promise<Buffer> {
  const document = buildUSALIDocument(data);
  return renderToBuffer(document);
}
