import { Prisma, PrismaClient } from "@prisma/client";
import { sendEmail } from "../../../../shared/email.js";
import {
  getOperaCloudCredentials,
  type OperaCloudCredentials,
} from "./opera-cloud-auth.js";
import { OperaCloudClient } from "./opera-cloud-client.js";
import { mapTransactionsToGL } from "./opera-cloud-mapper.js";
import {
  parseSAFFile,
  extractOperaRevenueGroups,
  type SAFParseResult,
} from "./opera-sun-parser.js";

// ── Shared types ──────────────────────────────────────────────────────────────

type ImportResult = {
  importLogId: string;
  imported: number;
  failed: number;
  journalId: string | null;
};

// ── .SUN flat-file import (primary path) ──────────────────────────────────────

type SUNFileImportInput = {
  entityId: string;
  fileContent: string;
  filename: string;
  notifyEmail?: string;
};

/**
 * Import an Opera .SUN flat file (SAF format).
 * This is the primary integration path — Opera exports night-audit
 * revenue data as .SUN files which use the SunSystems SAF format.
 */
export async function importOperaSUNFile(
  prisma: PrismaClient,
  input: SUNFileImportInput
): Promise<ImportResult> {
  const parsed = parseSAFFile(input.fileContent);

  if (!parsed.isBalanced) {
    throw new Error(
      `File out of balance: debits=${parsed.totalDebits}, credits=${parsed.totalCredits}`
    );
  }

  if (parsed.lineCount === 0) {
    throw new Error("No transaction lines found in .SUN file");
  }

  // Check for existing import of same filename (stored in errorDetails metadata)
  const existingLog = await prisma.importLog.findFirst({
    where: {
      entityId: input.entityId,
      connectorType: "OPERA_SUN",
      status: "SUCCESS",
      errorDetails: { path: ["sourceFilename"], equals: input.filename },
    },
  });

  if (existingLog) {
    return {
      importLogId: existingLog.id,
      imported: existingLog.recordsImported,
      failed: 0,
      journalId: existingLog.glJournalId,
    };
  }

  const importLog = await prisma.importLog.create({
    data: {
      entityId: input.entityId,
      connectorType: "OPERA_SUN",
      businessDate: parsed.dateRange
        ? new Date(
            parsed.dateRange.earliest.substring(0, 4) + "-" +
            parsed.dateRange.earliest.substring(4, 6) + "-" +
            parsed.dateRange.earliest.substring(6, 8)
          )
        : new Date(),
      status: "RUNNING",
    },
  });

  try {
    // Build account mapping
    const accountMap = await buildAccountMapping(prisma, input.entityId, parsed.uniqueAccounts);
    const unmappedCodes = accountMap.unmapped;

    // Find open period
    const periodKey = parsed.lines[0]?.accountingPeriod;
    const period = periodKey ? await findPeriod(prisma, input.entityId, periodKey) : null;

    if (!period) {
      throw new Error(`No open period for accounting period ${periodKey}`);
    }

    // Find actor user for journal creation
    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId: input.entityId },
      include: { user: true },
    });
    if (!entityUser) throw new Error("No entity user found for journal creation");

    // Build journal lines from all mapped SAF lines
    const journalLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      currency: string;
      fxRate: Prisma.Decimal;
      debitFunctional: Prisma.Decimal;
      creditFunctional: Prisma.Decimal;
      description: string;
      lineNumber: number;
    }> = [];

    let lineNum = 1;
    let importedCount = 0;
    let failedCount = 0;

    for (const safLine of parsed.lines) {
      const accountId = accountMap.mapped.get(safLine.accountCode);
      if (!accountId) {
        failedCount++;
        continue;
      }

      const debit = new Prisma.Decimal(safLine.dcMarker === "D" ? safLine.amount : 0);
      const credit = new Prisma.Decimal(safLine.dcMarker === "C" ? safLine.amount : 0);

      journalLines.push({
        accountId,
        debit,
        credit,
        currency: safLine.conversionCode || parsed.currency || "USD",
        fxRate: new Prisma.Decimal(1),
        debitFunctional: debit,
        creditFunctional: credit,
        description: safLine.description || `${safLine.journalType}: ${safLine.transactionReference}`,
        lineNumber: lineNum++,
      });

      importedCount++;
    }

    let journalId: string | null = null;

    if (journalLines.length > 0) {
      const dateStr = parsed.dateRange?.earliest ?? "";
      const businessDate = dateStr.length === 8
        ? new Date(dateStr.substring(0, 4) + "-" + dateStr.substring(4, 6) + "-" + dateStr.substring(6, 8))
        : new Date();

      const journalTypes = parsed.journalTypes.join("/") || "PMS";

      const journal = await prisma.journal.create({
        data: {
          entityId: input.entityId,
          periodId: period.id,
          reference: `PMS-OPERA-${dateStr}`,
          description: `Opera night audit import — ${journalTypes} — ${input.filename}`,
          source: "PMS",
          status: "DRAFT",
          functionalCurrency: parsed.currency ?? "USD",
          createdById: entityUser.userId,
          lines: { create: journalLines },
        },
      });

      journalId = journal.id;
    }

    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "SUCCESS",
        recordsTotal: parsed.lineCount,
        recordsImported: importedCount,
        recordsFailed: failedCount,
        glJournalId: journalId,
        errorDetails: {
          sourceFilename: input.filename,
          ...(unmappedCodes.length > 0 ? { unmappedCodes } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    if (input.notifyEmail) {
      await sendEmail({
        to: input.notifyEmail,
        subject: `Opera .SUN import complete — ${input.filename}`,
        html: `<p>Import summary for <strong>${input.filename}</strong>:</p>
<ul>
  <li>Total lines: ${parsed.lineCount}</li>
  <li>Imported: ${importedCount}</li>
  <li>Unmapped/failed: ${failedCount}</li>
  <li>Balanced: ${parsed.isBalanced ? "Yes" : "No"}</li>
  ${journalId ? `<li>GL Journal ID: ${journalId}</li>` : ""}
  ${unmappedCodes.length > 0 ? `<li>Unmapped codes: ${unmappedCodes.join(", ")}</li>` : ""}
</ul>`,
      });
    }

    return { importLogId: importLog.id, imported: importedCount, failed: failedCount, journalId };
  } catch (error) {
    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "FAILED",
        errorDetails: {
          message: error instanceof Error ? error.message : String(error),
        } as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

// ── Legacy OHIP API import (kept for backwards compat) ────────────────────────

type APIImportInput = {
  entityId: string;
  hotelId: string;
  businessDate: string;
  notifyEmail?: string;
};

export async function runOperaCloudImport(
  prisma: PrismaClient,
  input: APIImportInput
): Promise<ImportResult> {
  const creds: OperaCloudCredentials = getOperaCloudCredentials();

  const existingLog = await prisma.importLog.findFirst({
    where: {
      entityId: input.entityId,
      connectorType: "OPERA_CLOUD",
      businessDate: new Date(input.businessDate),
      status: "SUCCESS",
    },
  });

  if (existingLog) {
    return {
      importLogId: existingLog.id,
      imported: existingLog.recordsImported,
      failed: 0,
      journalId: existingLog.glJournalId,
    };
  }

  const importLog = await prisma.importLog.create({
    data: {
      entityId: input.entityId,
      connectorType: "OPERA_CLOUD",
      businessDate: new Date(input.businessDate),
      status: "RUNNING",
    },
  });

  try {
    const client = new OperaCloudClient(creds);
    const revenueSummary = await client.getRevenueSummary(input.hotelId, input.businessDate);
    const { mapped, unmapped } = await mapTransactionsToGL(
      prisma, input.entityId, revenueSummary.transactions
    );

    const businessDateObj = new Date(input.businessDate);
    const period = await prisma.period.findFirst({
      where: {
        entityId: input.entityId,
        status: "OPEN",
        year: businessDateObj.getFullYear(),
        month: businessDateObj.getMonth() + 1,
      },
    });

    if (!period) throw new Error(`No open period for ${input.businessDate}`);

    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId: input.entityId },
      include: { user: true },
    });
    if (!entityUser) throw new Error("No entity user found for journal creation");

    const cashAccount = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: "1000", allowPosting: true },
    });

    let journalId: string | null = null;

    if (mapped.length > 0 && cashAccount) {
      const totalRevenue = mapped.reduce(
        (sum, tx) => sum.add(new Prisma.Decimal(tx.amount)),
        new Prisma.Decimal(0)
      );

      let lineNumber = 1;
      const lines: Array<{
        accountId: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        currency: string;
        fxRate: Prisma.Decimal;
        debitFunctional: Prisma.Decimal;
        creditFunctional: Prisma.Decimal;
        description: string;
        lineNumber: number;
      }> = [];

      lines.push({
        accountId: cashAccount.id,
        debit: totalRevenue,
        credit: new Prisma.Decimal(0),
        currency: mapped[0]?.currency ?? "USD",
        fxRate: new Prisma.Decimal(1),
        debitFunctional: totalRevenue,
        creditFunctional: new Prisma.Decimal(0),
        description: `Opera Cloud PMS revenue — ${input.businessDate}`,
        lineNumber: lineNumber++,
      });

      for (const tx of mapped) {
        lines.push({
          accountId: tx.glAccountId,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(tx.amount),
          currency: tx.currency,
          fxRate: new Prisma.Decimal(1),
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: new Prisma.Decimal(tx.amount),
          description: `${tx.transactionCode}: ${tx.transactionDescription}`,
          lineNumber: lineNumber++,
        });
      }

      const journal = await prisma.journal.create({
        data: {
          entityId: input.entityId,
          periodId: period.id,
          reference: `PMS-OPERA-${input.businessDate}`,
          description: `Opera Cloud night audit import for ${input.businessDate}`,
          source: "PMS",
          status: "POSTED",
          functionalCurrency: mapped[0]?.currency ?? "USD",
          createdById: entityUser.userId,
          postedAt: new Date(),
          lines: { create: lines },
        },
      });

      journalId = journal.id;

      for (const line of lines) {
        await prisma.accountPeriodBalance.upsert({
          where: {
            entityId_accountId_periodId: {
              entityId: input.entityId,
              accountId: line.accountId,
              periodId: period.id,
            },
          },
          create: {
            entityId: input.entityId,
            accountId: line.accountId,
            periodId: period.id,
            openingBalance: new Prisma.Decimal(0),
            periodDebits: line.debitFunctional,
            periodCredits: line.creditFunctional,
            closingBalance: line.debitFunctional.sub(line.creditFunctional),
          },
          update: {
            periodDebits: { increment: line.debitFunctional },
            periodCredits: { increment: line.creditFunctional },
            closingBalance: { increment: line.debitFunctional.sub(line.creditFunctional) },
          },
        });
      }
    }

    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "SUCCESS",
        recordsTotal: revenueSummary.transactions.length,
        recordsImported: mapped.length,
        recordsFailed: unmapped.length,
        glJournalId: journalId,
        errorDetails: unmapped.length > 0
          ? { unmappedCodes: unmapped.map(u => u.transactionCode) } as Prisma.InputJsonValue
          : undefined,
      },
    });

    if (input.notifyEmail) {
      await sendEmail({
        to: input.notifyEmail,
        subject: `Opera Cloud import complete for ${input.businessDate}`,
        html: `<p>Import summary:</p>
<ul>
  <li>Total transactions: ${revenueSummary.transactions.length}</li>
  <li>Imported: ${mapped.length}</li>
  <li>Unmapped/failed: ${unmapped.length}</li>
  ${journalId ? `<li>GL Journal ID: ${journalId}</li>` : ""}
</ul>`,
      });
    }

    return { importLogId: importLog.id, imported: mapped.length, failed: unmapped.length, journalId };
  } catch (error) {
    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "FAILED",
        errorDetails: {
          message: error instanceof Error ? error.message : String(error),
        } as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildAccountMapping(
  prisma: PrismaClient,
  entityId: string,
  safCodes: string[]
): Promise<{ mapped: Map<string, string>; unmapped: string[] }> {
  const mapped = new Map<string, string>();
  const unmapped: string[] = [];

  if (safCodes.length === 0) return { mapped, unmapped };

  const accounts = await prisma.account.findMany({
    where: { entityId, code: { in: safCodes } },
    select: { id: true, code: true },
  });

  const connectorMappings = await prisma.connectorMapping.findMany({
    where: { entityId, connectorType: "OPERA_CLOUD", sourceCode: { in: safCodes } },
    include: { glAccount: true },
  });

  const codeIndex = new Map(accounts.map(a => [a.code, a.id]));
  for (const m of connectorMappings) {
    if (m.glAccount) codeIndex.set(m.sourceCode, m.glAccount.id);
  }

  for (const code of safCodes) {
    const id = codeIndex.get(code);
    if (id) mapped.set(code, id);
    else unmapped.push(code);
  }

  return { mapped, unmapped };
}

async function findPeriod(
  prisma: PrismaClient,
  entityId: string,
  accountingPeriod: string
): Promise<{ id: string } | null> {
  const year = parseInt(accountingPeriod.substring(0, 4), 10);
  const month = parseInt(accountingPeriod.substring(4), 10);
  if (!year || !month || month < 1 || month > 12) return null;

  return prisma.period.findFirst({
    where: { entityId, year, month },
    select: { id: true },
  });
}
