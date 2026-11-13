/**
 * Report Generation Job
 *
 * Generates PDF reports for all report types:
 *   USALI_PL      — USALI departmental P&L with comparative columns
 *   BALANCE_SHEET  — Assets/Liabilities/Equity statement
 *   CASHFLOW       — Operating/Investing/Financing cash flow
 *   TRIAL_BALANCE  — Full trial balance with account hierarchy
 *   CUSTOM         — Custom account-based summary (legacy fallback)
 *
 * Uses existing KPI service for data retrieval and PDF renderers for output.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Prisma, type PrismaClient as PrismaClientType } from "../db/client.js";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import React from "react";
import { prisma } from "../db/prisma.js";
import { KPIService } from "../modules/kpi/service.js";
import { sendEmail } from "../shared/email.js";
import { config } from "../config.js";

const kpiService = new KPIService(prisma as unknown as PrismaClientType);

// ── Upload helper ─────────────────────────────────────────────────────────────

async function uploadOutput(reportRunId: string, buffer: Buffer): Promise<string> {
  const { AWS_S3_BUCKET: bucket, AWS_REGION: region } = config();

  if (bucket && region) {
    const s3 = new S3Client({ region });
    const key = `reports/${reportRunId}.pdf`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: "application/pdf"
      })
    );
    return `s3://${bucket}/${key}`;
  }

  const outputDir = join(process.cwd(), "reports");
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, `${reportRunId}.pdf`);
  await writeFile(filePath, buffer);
  return filePath;
}

// ── Main processor ────────────────────────────────────────────────────────────

export async function processReportRun(reportRunId: string): Promise<void> {
  const reportRun = await prisma.reportRun.findUnique({
    where: { id: reportRunId },
    include: { definition: { include: { entity: { select: { id: true, name: true } } } } }
  });

  if (!reportRun) {
    throw new Error(`Report run ${reportRunId} not found.`);
  }

  await prisma.reportRun.update({
    where: { id: reportRunId },
    data: { status: "RUNNING", runAt: new Date(), errorMessage: null }
  });

  try {
    const parameters = (
      reportRun.parameters && typeof reportRun.parameters === "object" ? reportRun.parameters : {}
    ) as Record<string, unknown>;

    const periodId = typeof parameters.periodId === "string" ? parameters.periodId : undefined;
    if (!periodId) throw new Error("Report parameter periodId is required.");

    const entityId = reportRun.definition.entityId;
    const entityName = (reportRun.definition as any).entity?.name ?? "Entity";
    const reportType = reportRun.definition.type;

    let outputBuffer: Buffer;

    switch (reportType) {
      case "USALI_PL":
        outputBuffer = await generateUSALIPdf(entityId, entityName, periodId);
        break;
      case "BALANCE_SHEET":
        outputBuffer = await generateBalanceSheetPdf(entityId, entityName, periodId);
        break;
      case "CASHFLOW":
        outputBuffer = await generateCashFlowPdf(entityId, entityName, periodId);
        break;
      case "TRIAL_BALANCE":
        outputBuffer = await generateTrialBalancePdf(entityId, entityName, periodId);
        break;
      default:
        outputBuffer = await generateCustomPdf(entityId, reportRun.definition.name, periodId);
        break;
    }

    const outputUrl = await uploadOutput(reportRunId, outputBuffer);

    await prisma.reportRun.update({
      where: { id: reportRunId },
      data: { status: "COMPLETE", outputUrl, errorMessage: null }
    });

    // Email notification if requested
    const notifyEmail = typeof parameters.notifyEmail === "string" ? parameters.notifyEmail : null;
    if (notifyEmail) {
      await sendEmail({
        to: notifyEmail,
        subject: `Report ready: ${reportRun.definition.name}`,
        html: `<p>Your report <strong>${reportRun.definition.name}</strong> has been generated.</p>
<p>Report ID: ${reportRunId}</p>
<p>Download it from the Reports page in HospitalityFinance Pro.</p>`
      }).catch(() => {
        /* email failure should not fail the job */
      });
    }

    console.log(`[ReportJob] ${reportType} report ${reportRunId} generated successfully.`);
  } catch (error) {
    await prisma.reportRun.update({
      where: { id: reportRunId },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown report error."
      }
    });
    throw error;
  }
}

// ── USALI P&L ─────────────────────────────────────────────────────────────────

async function generateUSALIPdf(
  entityId: string,
  entityName: string,
  periodId: string
): Promise<Buffer> {
  const report = await kpiService.getUSALIComparative({ entityId, periodId });
  const { renderUSALIPdf } = await import("../modules/reporting/usali-pl-pdf.js");
  return renderUSALIPdf({
    entityName,
    periodName: report.periodName,
    year: report.year,
    month: report.month,
    hasYTD: report.hasYTD,
    hasPriorYear: report.hasPriorYear,
    hasBudget: report.hasBudget,
    departments: report.departments,
    totalRevenue: report.totalRevenue,
    totalDepartmentalExpenses: report.totalDepartmentalExpenses,
    totalDepartmentalIncome: report.totalDepartmentalIncome,
    undistributedExpenses: report.undistributedExpenses,
    grossOperatingProfit: report.grossOperatingProfit,
    gopPct: report.gopPct,
    managementFees: report.managementFees,
    ebitda: report.ebitda,
    ebitdaPct: report.ebitdaPct,
    ytdTotalRevenue: report.ytdTotalRevenue,
    ytdGOP: report.ytdGOP,
    ytdGOPPct: report.ytdGOPPct,
    ytdEBITDA: report.ytdEBITDA,
    ytdEBITDAPct: report.ytdEBITDAPct,
    priorTotalRevenue: report.priorTotalRevenue,
    priorGOP: report.priorGOP,
    priorGOPPct: report.priorGOPPct,
    budgetTotalRevenue: report.budgetTotalRevenue,
    budgetGOP: report.budgetGOP,
    budgetEBITDA: report.budgetEBITDA,
    revenueVariance: report.revenueVariance,
    gopVariance: report.gopVariance,
    gopVariancePct: report.gopVariancePct
  });
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────

async function generateBalanceSheetPdf(
  entityId: string,
  entityName: string,
  periodId: string
): Promise<Buffer> {
  const report = await kpiService.getBalanceSheet({ entityId, periodId });
  const { renderBalanceSheetPdf } = await import("../modules/reporting/balance-sheet-pdf.js");
  return renderBalanceSheetPdf({
    entityName,
    asOf: report.asOf,
    assets: report.assets,
    liabilities: report.liabilities,
    equity: report.equity,
    totalAssets: report.totalAssets,
    totalLiabilities: report.totalLiabilities,
    totalEquity: report.totalEquity,
    totalLiabilitiesAndEquity: report.totalLiabilitiesAndEquity
  });
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────

async function generateCashFlowPdf(
  entityId: string,
  entityName: string,
  periodId: string
): Promise<Buffer> {
  const report = await kpiService.getCashFlow({ entityId, periodId });
  const period = await prisma.period.findUniqueOrThrow({ where: { id: periodId } });
  const { renderCashFlowPdf } = await import("../modules/reporting/cashflow-pdf.js");
  return renderCashFlowPdf({
    entityName,
    periodName: `${period.year}-${String(period.month).padStart(2, "0")}`,
    operating: report.operating,
    investing: report.investing,
    financing: report.financing,
    netChange: report.netChange,
    openingCash: report.openingCash,
    closingCash: report.closingCash
  });
}

// ── Trial Balance ─────────────────────────────────────────────────────────────

async function generateTrialBalancePdf(
  entityId: string,
  entityName: string,
  periodId: string
): Promise<Buffer> {
  const period = await prisma.period.findUniqueOrThrow({ where: { id: periodId } });

  type TBRow = {
    code: string;
    name: string;
    account_type: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    closing_balance: Prisma.Decimal;
  };

  const rows = await prisma.$queryRaw<TBRow[]>`
    SELECT
      account_code AS code,
      account_name AS name,
      account_type,
      COALESCE(period_debits, 0)::numeric(18,4) AS debit,
      COALESCE(period_credits, 0)::numeric(18,4) AS credit,
      COALESCE(closing_balance, 0)::numeric(18,4) AS closing_balance
    FROM mv_period_account_balances
    WHERE "entityId" = ${entityId}
      AND "periodId" = ${periodId}
      AND is_active = true
    ORDER BY account_code ASC;
  `;

  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 9 },
    title: { fontSize: 16, marginBottom: 4, color: "#1a3b6e" },
    subtitle: { fontSize: 10, marginBottom: 12, color: "#64748b" },
    headerRow: {
      flexDirection: "row",
      borderBottomWidth: 2,
      borderBottomColor: "#1a3b6e",
      borderBottomStyle: "solid",
      paddingBottom: 4,
      marginBottom: 4
    },
    row: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: "#e2e8f0",
      borderBottomStyle: "solid",
      paddingVertical: 3
    },
    totalRow: {
      flexDirection: "row",
      borderTopWidth: 2,
      borderTopColor: "#1a3b6e",
      borderTopStyle: "solid",
      paddingTop: 4,
      marginTop: 4
    },
    colCode: { width: "12%" },
    colName: { width: "38%" },
    colType: { width: "14%" },
    colDebit: { width: "12%", textAlign: "right" },
    colCredit: { width: "12%", textAlign: "right" },
    colBalance: { width: "12%", textAlign: "right" }
  });

  const fmt = (v: Prisma.Decimal) => {
    const n = Number(v);
    return n === 0
      ? "-"
      : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  let totalDebits = new Prisma.Decimal(0);
  let totalCredits = new Prisma.Decimal(0);
  for (const row of rows) {
    totalDebits = totalDebits.add(row.debit);
    totalCredits = totalCredits.add(row.credit);
  }

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.title }, `Trial Balance — ${entityName}`),
      React.createElement(
        Text,
        { style: styles.subtitle },
        `Period: ${period.name} (${period.year})`
      ),
      React.createElement(
        View,
        { style: styles.headerRow },
        React.createElement(Text, { style: { ...styles.colCode, fontWeight: 700 } }, "Code"),
        React.createElement(Text, { style: { ...styles.colName, fontWeight: 700 } }, "Account"),
        React.createElement(Text, { style: { ...styles.colType, fontWeight: 700 } }, "Type"),
        React.createElement(Text, { style: { ...styles.colDebit, fontWeight: 700 } }, "Debits"),
        React.createElement(Text, { style: { ...styles.colCredit, fontWeight: 700 } }, "Credits"),
        React.createElement(Text, { style: { ...styles.colBalance, fontWeight: 700 } }, "Balance")
      ),
      ...rows.map((row, i) =>
        React.createElement(
          View,
          {
            key: `tb-${i}`,
            style: { ...styles.row, ...(i % 2 === 1 ? { backgroundColor: "#f8fafc" } : {}) }
          },
          React.createElement(Text, { style: styles.colCode }, row.code),
          React.createElement(Text, { style: styles.colName }, row.name),
          React.createElement(Text, { style: styles.colType }, row.account_type),
          React.createElement(Text, { style: styles.colDebit }, fmt(row.debit)),
          React.createElement(Text, { style: styles.colCredit }, fmt(row.credit)),
          React.createElement(Text, { style: styles.colBalance }, fmt(row.closing_balance))
        )
      ),
      React.createElement(
        View,
        { style: styles.totalRow },
        React.createElement(Text, { style: styles.colCode }, ""),
        React.createElement(Text, { style: { ...styles.colName, fontWeight: 700 } }, "Total"),
        React.createElement(Text, { style: styles.colType }, ""),
        React.createElement(
          Text,
          { style: { ...styles.colDebit, fontWeight: 700 } },
          fmt(totalDebits)
        ),
        React.createElement(
          Text,
          { style: { ...styles.colCredit, fontWeight: 700 } },
          fmt(totalCredits)
        ),
        React.createElement(
          Text,
          { style: { ...styles.colBalance, fontWeight: 700 } },
          fmt(totalDebits.sub(totalCredits))
        )
      )
    )
  );

  return renderToBuffer(doc);
}

// ── Custom / fallback ─────────────────────────────────────────────────────────

async function generateCustomPdf(
  entityId: string,
  reportName: string,
  periodId: string
): Promise<Buffer> {
  type CustomRow = {
    department: string;
    category: string;
    amount: Prisma.Decimal;
  };

  const rows = await prisma.$queryRaw<CustomRow[]>`
    SELECT
      COALESCE(usali_department, 'Unassigned') AS department,
      COALESCE(usali_category, 'Unassigned') AS category,
      COALESCE(SUM(closing_balance), 0)::numeric(18,4) AS amount
    FROM mv_period_account_balances
    WHERE "entityId" = ${entityId}
      AND "periodId" = ${periodId}
    GROUP BY COALESCE(usali_department, 'Unassigned'), COALESCE(usali_category, 'Unassigned')
    ORDER BY department ASC, category ASC;
  `;

  const period = await prisma.period.findUnique({ where: { id: periodId } });
  const periodLabel = period ? period.name : periodId;

  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 10 },
    title: { fontSize: 16, marginBottom: 12, color: "#1a3b6e" },
    subtitle: { fontSize: 11, marginBottom: 10, color: "#64748b" },
    row: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: "#e2e8f0",
      borderBottomStyle: "solid",
      paddingVertical: 4
    },
    colDept: { width: "35%" },
    colCat: { width: "35%" },
    colAmt: { width: "30%", textAlign: "right" }
  });

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.title }, reportName),
      React.createElement(Text, { style: styles.subtitle }, `Period: ${periodLabel}`),
      React.createElement(
        View,
        { style: { ...styles.row, borderBottomWidth: 2, borderBottomColor: "#1a3b6e" } },
        React.createElement(Text, { style: { ...styles.colDept, fontWeight: 700 } }, "Department"),
        React.createElement(Text, { style: { ...styles.colCat, fontWeight: 700 } }, "Category"),
        React.createElement(Text, { style: { ...styles.colAmt, fontWeight: 700 } }, "Amount")
      ),
      ...rows.map((row, i) =>
        React.createElement(
          View,
          { key: `cr-${i}`, style: styles.row },
          React.createElement(Text, { style: styles.colDept }, row.department),
          React.createElement(Text, { style: styles.colCat }, row.category),
          React.createElement(
            Text,
            { style: styles.colAmt },
            Number(row.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })
          )
        )
      )
    )
  );

  return renderToBuffer(doc);
}
