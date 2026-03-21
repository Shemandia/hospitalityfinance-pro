/**
 * Simphony POS daily import job
 *
 * Fetches POS transaction summary from OHIP, maps revenue class codes to GL,
 * and creates a posted GL journal.
 *
 * Journal structure:
 *   DR  Cash/POS settlement (1010)  — total net sales + tax + svc charge
 *   CR  Food Revenue (4200)         — per mapped revenue line
 *   CR  Beverage Revenue (4210)     — per mapped revenue line
 *   CR  Tax Payable (2300)          — total tax
 *   CR  Service Charge (4220)       — total service charge
 *   CR  Tips Payable (2310)         — total tips (if any)
 *   DR  Discounts (4290)            — total discount (contra-revenue)
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type OperaCloudCredentials,
  getOperaCloudCredentials
} from "../opera-cloud/opera-cloud-auth.js";
import { SimphonyClient } from "./simphony-client.js";
import { mapSimphonyToGL } from "./simphony-mapper.js";
import { sendEmail } from "../../../../shared/email.js";

type ImportInput = {
  entityId: string;
  locationId: string;
  businessDate: string; // YYYY-MM-DD
  notifyEmail?: string;
};

type ImportResult = {
  importLogId: string;
  imported: number;
  failed: number;
  journalId: string | null;
  summary: {
    grossSales: number;
    netSales: number;
    tax: number;
    serviceCharge: number;
    tips: number;
    discounts: number;
    checkCount: number;
    coverCount: number;
  };
};

export async function runSimphonyImport(
  prisma: PrismaClient,
  input: ImportInput
): Promise<ImportResult> {
  const creds: OperaCloudCredentials = getOperaCloudCredentials();

  // ── Idempotency check ─────────────────────────────────────────────────────
  const existingLog = await prisma.importLog.findFirst({
    where: {
      entityId: input.entityId,
      connectorType: "SIMPHONY_POS",
      businessDate: new Date(input.businessDate),
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
        grossSales: 0,
        netSales: 0,
        tax: 0,
        serviceCharge: 0,
        tips: 0,
        discounts: 0,
        checkCount: 0,
        coverCount: 0
      }
    };
  }

  // ── Create import log ─────────────────────────────────────────────────────
  const importLog = await prisma.importLog.create({
    data: {
      entityId: input.entityId,
      connectorType: "SIMPHONY_POS",
      businessDate: new Date(input.businessDate),
      status: "RUNNING"
    }
  });

  try {
    // ── Fetch from OHIP ───────────────────────────────────────────────────
    const client = new SimphonyClient(creds);
    const daily = await client.getDailyTransactionSummary(input.locationId, input.businessDate);

    const summary = {
      grossSales: daily.totalGrossSales,
      netSales: daily.totalNetSales,
      tax: daily.totalTax,
      serviceCharge: daily.totalServiceCharge,
      tips: daily.totalTips,
      discounts: daily.totalDiscount,
      checkCount: daily.checkCount,
      coverCount: daily.coverCount
    };

    // ── Map to GL ─────────────────────────────────────────────────────────
    const { mapped, unmapped } = await mapSimphonyToGL(prisma, input.entityId, daily.lines);

    // ── Period resolution ─────────────────────────────────────────────────
    const dateObj = new Date(input.businessDate);
    const period = await prisma.period.findFirst({
      where: {
        entityId: input.entityId,
        status: "OPEN",
        year: dateObj.getFullYear(),
        month: dateObj.getMonth() + 1
      }
    });
    if (!period) throw new Error(`No open period for ${input.businessDate}`);

    // ── Entity user & accounts ────────────────────────────────────────────
    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId: input.entityId },
      include: { user: true }
    });
    if (!entityUser) throw new Error("No entity user found for journal creation");

    // POS settlement account (typically 1010 - POS Clearing or 1000 - Cash)
    const posSettlement = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: { in: ["1010", "1000"] }, allowPosting: true },
      orderBy: { code: "asc" } // prefer 1010 over 1000
    });

    // Tax payable account
    const taxPayable = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: "2300", allowPosting: true }
    });

    // Service charge revenue
    const svcChargeAccount = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: "4220", allowPosting: true }
    });

    // Tips payable
    const tipsAccount = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: "2310", allowPosting: true }
    });

    // Discount contra-revenue
    const discountAccount = await prisma.account.findFirst({
      where: { entityId: input.entityId, code: "4290", allowPosting: true }
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
        throw new Error(`No FX rate for ${txCurrency}→${functionalCcy}. Add a SPOT rate first.`);
      }
      fxRate = rateRec.rate;
    }

    // ── Build journal lines ───────────────────────────────────────────────
    let journalId: string | null = null;

    if (mapped.length > 0 && posSettlement) {
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

      // Total inflow = net sales + tax + service charge + tips
      const totalInflow = new Prisma.Decimal(daily.totalNetSales)
        .add(new Prisma.Decimal(daily.totalTax))
        .add(new Prisma.Decimal(daily.totalServiceCharge))
        .add(new Prisma.Decimal(daily.totalTips));

      // DR: POS Settlement
      lines.push({
        accountId: posSettlement.id,
        debit: totalInflow,
        credit: new Prisma.Decimal(0),
        currency: txCurrency,
        fxRate,
        debitFunctional: totalInflow.mul(fxRate),
        creditFunctional: new Prisma.Decimal(0),
        description: `Simphony POS daily settlement — ${input.businessDate}`,
        lineNumber: lineNumber++
      });

      // CR: Revenue lines (grouped by GL account to reduce journal lines)
      const revenueByAccount = new Map<
        string,
        { accountId: string; code: string; amount: Prisma.Decimal; desc: string[] }
      >();
      for (const line of mapped) {
        const key = line.glAccountId;
        const existing = revenueByAccount.get(key);
        if (existing) {
          existing.amount = existing.amount.add(new Prisma.Decimal(line.amount));
          if (!existing.desc.includes(line.revenueClassName)) {
            existing.desc.push(line.revenueClassName);
          }
        } else {
          revenueByAccount.set(key, {
            accountId: line.glAccountId,
            code: line.glAccountCode,
            amount: new Prisma.Decimal(line.amount),
            desc: [line.revenueClassName || line.revenueCentreName]
          });
        }
      }

      for (const [, entry] of revenueByAccount) {
        lines.push({
          accountId: entry.accountId,
          debit: new Prisma.Decimal(0),
          credit: entry.amount,
          currency: txCurrency,
          fxRate,
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: entry.amount.mul(fxRate),
          description: entry.desc.join(", "),
          lineNumber: lineNumber++
        });
      }

      // CR: Tax payable
      if (taxPayable && daily.totalTax > 0) {
        const taxAmt = new Prisma.Decimal(daily.totalTax);
        lines.push({
          accountId: taxPayable.id,
          debit: new Prisma.Decimal(0),
          credit: taxAmt,
          currency: txCurrency,
          fxRate,
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: taxAmt.mul(fxRate),
          description: "POS tax collected",
          lineNumber: lineNumber++
        });
      }

      // CR: Service charge
      if (svcChargeAccount && daily.totalServiceCharge > 0) {
        const svcAmt = new Prisma.Decimal(daily.totalServiceCharge);
        lines.push({
          accountId: svcChargeAccount.id,
          debit: new Prisma.Decimal(0),
          credit: svcAmt,
          currency: txCurrency,
          fxRate,
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: svcAmt.mul(fxRate),
          description: "POS service charge",
          lineNumber: lineNumber++
        });
      }

      // CR: Tips payable
      if (tipsAccount && daily.totalTips > 0) {
        const tipsAmt = new Prisma.Decimal(daily.totalTips);
        lines.push({
          accountId: tipsAccount.id,
          debit: new Prisma.Decimal(0),
          credit: tipsAmt,
          currency: txCurrency,
          fxRate,
          debitFunctional: new Prisma.Decimal(0),
          creditFunctional: tipsAmt.mul(fxRate),
          description: "POS tips collected",
          lineNumber: lineNumber++
        });
      }

      // DR: Discounts (contra-revenue — increases debit side)
      if (discountAccount && daily.totalDiscount > 0) {
        const discAmt = new Prisma.Decimal(daily.totalDiscount);
        lines.push({
          accountId: discountAccount.id,
          debit: discAmt,
          credit: new Prisma.Decimal(0),
          currency: txCurrency,
          fxRate,
          debitFunctional: discAmt.mul(fxRate),
          creditFunctional: new Prisma.Decimal(0),
          description: "POS discounts & allowances",
          lineNumber: lineNumber++
        });
      }

      // ── Create journal ────────────────────────────────────────────────
      const journal = await prisma.journal.create({
        data: {
          entityId: input.entityId,
          periodId: period.id,
          reference: `POS-SIMPHONY-${input.businessDate}`,
          description: `Simphony POS daily import for ${input.businessDate} (${daily.checkCount} checks, ${daily.coverCount} covers)`,
          source: "POS",
          status: "POSTED",
          functionalCurrency: functionalCcy,
          createdById: entityUser.userId,
          postedAt: new Date(),
          lines: { create: lines }
        }
      });

      journalId = journal.id;

      // ── Update account balances ─────────────────────────────────────
      for (const line of lines) {
        await prisma.accountPeriodBalance.upsert({
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
    }

    // ── Update import log ─────────────────────────────────────────────────
    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "SUCCESS",
        recordsTotal: daily.lines.length,
        recordsImported: mapped.length,
        recordsFailed: unmapped.length,
        glJournalId: journalId,
        errorDetails: {
          summary,
          ...(unmapped.length > 0 ? { unmappedCodes: unmapped.map((u) => u.revenueClassCode) } : {})
        } as Prisma.InputJsonValue
      }
    });

    // ── Email notification ────────────────────────────────────────────────
    if (input.notifyEmail) {
      await sendEmail({
        to: input.notifyEmail,
        subject: `Simphony POS import complete for ${input.businessDate}`,
        html: `<p>POS Import Summary:</p>
<ul>
  <li>Checks: ${summary.checkCount} | Covers: ${summary.coverCount}</li>
  <li>Gross Sales: ${summary.grossSales.toFixed(2)}</li>
  <li>Net Sales: ${summary.netSales.toFixed(2)}</li>
  <li>Tax: ${summary.tax.toFixed(2)}</li>
  <li>Service Charge: ${summary.serviceCharge.toFixed(2)}</li>
  <li>Revenue lines imported: ${mapped.length} | Unmapped: ${unmapped.length}</li>
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
