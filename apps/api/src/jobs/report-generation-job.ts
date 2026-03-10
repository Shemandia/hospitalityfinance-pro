import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View
} from "@react-pdf/renderer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import React from "react";
import { prisma } from "../db/prisma.js";

type UsaliRow = {
  department: string;
  category: string;
  amount: Prisma.Decimal;
};

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 10
  },
  title: {
    fontSize: 16,
    marginBottom: 12
  },
  subtitle: {
    fontSize: 11,
    marginBottom: 10
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
    paddingVertical: 4
  },
  colDepartment: {
    width: "35%"
  },
  colCategory: {
    width: "35%"
  },
  colAmount: {
    width: "30%",
    textAlign: "right"
  }
});

function buildUsaliDocument(
  reportName: string,
  periodLabel: string,
  rows: UsaliRow[]
) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.title }, reportName),
      React.createElement(Text, { style: styles.subtitle }, `Period: ${periodLabel}`),
      React.createElement(
        View,
        { style: styles.row },
        React.createElement(Text, { style: styles.colDepartment }, "Department"),
        React.createElement(Text, { style: styles.colCategory }, "Category"),
        React.createElement(Text, { style: styles.colAmount }, "Amount")
      ),
      ...rows.map((row, index) =>
        React.createElement(
          View,
          { key: `${row.department}-${row.category}-${index}`, style: styles.row },
          React.createElement(Text, { style: styles.colDepartment }, row.department),
          React.createElement(Text, { style: styles.colCategory }, row.category),
          React.createElement(Text, { style: styles.colAmount }, row.amount.toFixed(4))
        )
      )
    )
  );
}

async function uploadOutput(reportRunId: string, buffer: Buffer): Promise<string> {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;

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

export async function processReportRun(reportRunId: string): Promise<void> {
  const reportRun = await prisma.reportRun.findUnique({
    where: { id: reportRunId },
    include: {
      definition: true
    }
  });

  if (!reportRun) {
    throw new Error(`Report run ${reportRunId} not found.`);
  }

  await prisma.reportRun.update({
    where: { id: reportRunId },
    data: {
      status: "RUNNING",
      runAt: new Date(),
      errorMessage: null
    }
  });

  try {
    const parameters =
      reportRun.parameters && typeof reportRun.parameters === "object"
        ? (reportRun.parameters as Record<string, unknown>)
        : {};
    const periodId =
      typeof parameters.periodId === "string" ? parameters.periodId : undefined;

    if (!periodId) {
      throw new Error("Report parameter periodId is required.");
    }

    const rows = await prisma.$queryRaw<UsaliRow[]>`
      SELECT
        COALESCE(a.usali_department, 'Unassigned') AS department,
        COALESCE(a.usali_category, 'Unassigned') AS category,
        COALESCE(SUM(apb.closing_balance), 0)::numeric(18,4) AS amount
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      JOIN report_definitions rd ON rd.id = ${reportRun.definitionId}
      WHERE apb.entity_id = rd.entity_id
        AND apb.period_id = ${periodId}
      GROUP BY COALESCE(a.usali_department, 'Unassigned'), COALESCE(a.usali_category, 'Unassigned')
      ORDER BY department ASC, category ASC;
    `;

    const period = await prisma.period.findUnique({
      where: { id: periodId }
    });
    const periodLabel = period ? period.name : periodId;

    const document = buildUsaliDocument(reportRun.definition.name, periodLabel, rows);
    const outputBuffer = await renderToBuffer(document);
    const outputUrl = await uploadOutput(reportRunId, outputBuffer);

    await prisma.reportRun.update({
      where: { id: reportRunId },
      data: {
        status: "COMPLETE",
        outputUrl,
        errorMessage: null
      }
    });
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
