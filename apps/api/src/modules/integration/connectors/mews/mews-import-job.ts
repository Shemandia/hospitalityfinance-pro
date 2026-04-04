/**
 * Mews PMS daily import job
 *
 * Fetches accounting items from the Mews Connector API, maps accounting
 * categories to GL accounts, and creates a posted GL journal.
 *
 * Journal structure:
 *   DR  Cash/Settlement (1010)    — total revenue + tax
 *   CR  Revenue accounts          — per mapped accounting category
 *   CR  Tax Payable (2300)        — total tax
 *
 * Idempotent via ImportLog (connectorType: MEWS_PMS).
 * FX conversion if Mews currency differs from entity functional currency.
 * Email notification on completion.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { MewsClient, getMewsCredentials } from "./mews-client.js";
import { mapMewsToGL } from "./mews-mapper.js";
import { sendEmail } from "../../../../shared/email.js";

type ImportInput = {
  entityId: string;
  startUtc: string; // ISO 8601 e.g. "2025-03-20T00:00:00Z"
  endUtc: string; // ISO 8601 e.g. "2025-03-21T00:00:00Z"
  notifyEmail?: string;
};

type ImportResult = {
  importLogId: string;
  imported: number;
  failed: number;
  journalId: string | null;
  summary: {
    totalRevenue: string;
    totalTax: string;
    totalPayments: string;
    categoryCount: number;
    itemCount: number;
  };
};

export async function runMewsImport(
  prisma: PrismaClient,
  input: ImportInput
): Promise<ImportResult> {
  const creds = getMewsCredentials();

  // Derive business date from startUtc for idempotency
  const businessDate = input.startUtc.split("T")[0] ?? input.startUtc;

  // ── Idempotency check ─────────────────────────────────────────────────────
  const existingLog = await prisma.importLog.findFirst({
    where: {
      entityId: input.entityId,
      connectorType: "MEWS_PMS",
      businessDate: new Date(businessDate),
      status: "SUCCESS"
    }
  });

  if (existingLog) {
    return {
      importLogId: existingLog.id,
      imported: existingLog.recordsImported,
      failed: 0,
      journalId: existingLog.glJournalId,
      summary: ((existingLog.errorDetails as Record<string, unknown>)
        ?.summary as ImportResult["summary"]) ?? {
        totalRevenue: 0,
        totalTax: 0,
        totalPayments: 0,
        categoryCount: 0,
        itemCount: 0
      }
    };
  }

  // ── Create import log ─────────────────────────────────────────────────────
  const importLog = await prisma.importLog.create({
    data: {
      entityId: input.entityId,
      connectorType: "MEWS_PMS",
      businessDate: new Date(businessDate),
      status: "RUNNING"
    }
  });

  try {
    // ── Fetch from Mews ───────────────────────────────────────────────────
    const client = new MewsClient(creds);
    const daily = await client.getDailySummary(input.startUtc, input.endUtc);

    const summary = {
      totalRevenue: daily.totalRevenue,
      totalTax: daily.totalTax,
      totalPayments: daily.totalPayments,
      categoryCount: daily.byCategory.length,
      itemCount: daily.items.length + daily.outletItems.length
    };

    // ── Map to GL ─────────────────────────────────────────────────────────
    const { mapped, unmapped } = await mapMewsToGL(prisma, input.entityId, daily.byCategory);

    // ── Period resolution ─────────────────────────────────────────────────
    const dateObj = new Date(businessDate);
    const period = await prisma.period.findFirst({
      where: {
        entityId: input.entityId,
        status: "OPEN",
        year: dateObj.getFullYear(),
        month: dateObj.getMonth() + 1
      }
    });
    if (!period) throw new Error(`No open period for ${businessDate}`);

    // ── Entity user & accounts ────────────────────────────────────────────
    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId: input.entityId },
      include: { user: true }
    });
    if (!entityUser) throw new Error("No entity user found for journal creation");

    // Cash/settlement account (typically 1010 or 1000)
    const cashSettlement = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: { in: ["1010", "1000"] }, allowPosting: true },
      orderBy: { code: "asc" } // prefer 1010 over 1000
    });

    // Tax payable account
    const taxPayable = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: "2300", allowPosting: true }
    });

    // ── FX rate ───────────────────────────────────────────────────────────
    const entity = await prisma.entity.findUniqueOrThrow({
      where: { id: input.entityId },
      select: { functionalCurrency: true }
    });
    const txCurrency = daily.currency.toUpperCase();
    const functionalCcy = entity.functionalCurrency.toUpperCase();

    let fxRate = new Prisma.Decimal(1);
    if (txCurrency !== functionalCcy) {
      const rateRec = await prisma.fXRate.findFirst({
        where: { fromCurrency: txCurrency, toCurrency: functionalCcy, rateType: "SPOT" },
        orderBy: { effectiveDate: "desc" }
      });
      if (!rateRec) {
        throw new Error(`No FX rate for ${txCurrency}->${functionalCcy}. Add a SPOT rate first.`);
      }
      fxRate = rateRec.rate;
    }

    // ── Build journal lines ───────────────────────────────────────────────
    let journalId: string | null = null;

    if (mapped.length > 0 && cashSettlement) {
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

      // Total inflow = revenue + tax
      const totalInflow = new Prisma.Decimal(daily.totalRevenue).add(
        new Prisma.Decimal(daily.totalTax)
      );

      // DR: Cash/Settlement
      lines.push({
        accountId: cashSettlement.id,
        debit: totalInflow,
        credit: new Prisma.Decimal(0),
        currency: txCurrency,
        fxRate,
        debitFunctional: totalInflow.mul(fxRate),
        creditFunctional: new Prisma.Decimal(0),
        description: `Mews PMS daily settlement - ${businessDate}`,
        lineNumber: lineNumber++
      });

      // CR: Revenue lines per mapped accounting category
      for (const line of mapped) {
        if (line.amount === "0" || line.amount === "") continue;
        // Skip tax categories — handled separately below
        if (line.type === "Tax") continue;

        const amt = new Prisma.Decimal(line.amount).abs();
        lines.push({
          accountId: line.glAccountId,
          debit: new Prisma.Decimal(0),
          credit: amt,
          currency: txCurrency,
          fxRate,
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: amt.mul(fxRate),
          description: line.categoryName,
          lineNumber: lineNumber++
        });
      }

      // CR: Tax payable
      if (taxPayable && new Prisma.Decimal(daily.totalTax).greaterThan(0)) {
        const taxAmt = new Prisma.Decimal(daily.totalTax);
        lines.push({
          accountId: taxPayable.id,
          debit: new Prisma.Decimal(0),
          credit: taxAmt,
          currency: txCurrency,
          fxRate,
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: taxAmt.mul(fxRate),
          description: "Mews tax collected",
          lineNumber: lineNumber++
        });
      }

      // ── Create journal, update balances, and mark import log SUCCESS ──
      await prisma.$transaction(async (tx) => {
        const journal = await tx.journal.create({
          data: {
            entityId: input.entityId,
            periodId: period.id,
            reference: `PMS-MEWS-${businessDate}`,
            description: `Mews PMS daily import for ${businessDate} (${summary.itemCount} items, ${summary.categoryCount} categories)`,
            source: "PMS",
            status: "POSTED",
            functionalCurrency: functionalCcy,
            createdById: entityUser.userId,
            postedAt: new Date(),
            lines: { create: lines }
          }
        });

        journalId = journal.id;

        // ── Update account balances ───────────────────────────────────
        for (const line of lines) {
          await tx.accountPeriodBalance.upsert({
            where: {
              entityId_accountId_periodId: {
                entityId: input.entityId,
                accountId: line.accountId,
                periodId: period.id
              }
            },
            create: {
              entityId: input.entityId,
              accountId: line.accountId,
              periodId: period.id,
              openingBalance: new Prisma.Decimal(0),
              periodDebits: line.debitFunctional,
              periodCredits: line.creditFunctional,
              closingBalance: line.debitFunctional.sub(line.creditFunctional)
            },
            update: {
              periodDebits: { increment: line.debitFunctional },
              periodCredits: { increment: line.creditFunctional },
              closingBalance: { increment: line.debitFunctional.sub(line.creditFunctional) }
            }
          });
        }

        // ── Update import log ─────────────────────────────────────────
        await tx.importLog.update({
          where: { id: importLog.id },
          data: {
            status: "SUCCESS",
            recordsTotal: daily.byCategory.length,
            recordsImported: mapped.length,
            recordsFailed: unmapped.length,
            glJournalId: journalId,
            errorDetails: {
              summary,
              ...(unmapped.length > 0
                ? {
                    unmappedCategories: unmapped.map((u) => ({
                      id: u.accountingCategoryId,
                      name: u.categoryName
                    }))
                  }
                : {})
            } as Prisma.InputJsonValue
          }
        });
      });
    } else {
      // No journal lines to create — still mark the import log as SUCCESS
      await prisma.importLog.update({
        where: { id: importLog.id },
        data: {
          status: "SUCCESS",
          recordsTotal: daily.byCategory.length,
          recordsImported: mapped.length,
          recordsFailed: unmapped.length,
          glJournalId: journalId,
          errorDetails: {
            summary,
            ...(unmapped.length > 0
              ? {
                  unmappedCategories: unmapped.map((u) => ({
                    id: u.accountingCategoryId,
                    name: u.categoryName
                  }))
                }
              : {})
          } as Prisma.InputJsonValue
        }
      });
    }

    // ── Email notification ────────────────────────────────────────────────
    if (input.notifyEmail) {
      await sendEmail({
        to: input.notifyEmail,
        subject: `Mews PMS import complete for ${businessDate}`,
        html: `<p>Mews PMS Import Summary:</p>
<ul>
  <li>Date: ${businessDate}</li>
  <li>Total Revenue: ${new Prisma.Decimal(summary.totalRevenue).toFixed(2)}</li>
  <li>Total Tax: ${new Prisma.Decimal(summary.totalTax).toFixed(2)}</li>
  <li>Accounting Items: ${summary.itemCount}</li>
  <li>Categories mapped: ${mapped.length} | Unmapped: ${unmapped.length}</li>
  ${journalId ? `<li>GL Journal: ${journalId}</li>` : ""}
</ul>`
      });
    }

    return {
      importLogId: importLog.id,
      imported: mapped.length,
      failed: unmapped.length,
      journalId,
      summary
    };
  } catch (error) {
    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "FAILED",
        errorDetails: {
          message: error instanceof Error ? error.message : String(error)
        } as Prisma.InputJsonValue
      }
    });
    throw error;
  }
}
