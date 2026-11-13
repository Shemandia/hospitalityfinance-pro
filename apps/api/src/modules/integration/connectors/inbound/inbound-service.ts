/**
 * Inbound Integration Service
 *
 * Handles incoming data from external systems (Material Management, payroll, etc.)
 * via two paths:
 *   1. Real-time API — POST batches of invoices, journals, or suppliers
 *   2. File import  — Upload JSON/CSV file containing the same batch data
 *
 * All operations are idempotent via batchRef + sourceSystem deduplication.
 */

import { Prisma, type PrismaClient } from "../../../../db/client.js";
import type {
  InboundInvoiceBatch,
  InboundJournalBatch,
  InboundSupplierBatch,
  InboundBatchResult
} from "./inbound-types.js";
import { entityActor } from "../../../access/actor.js";

// ── Invoice Import ──────────────────────────────────────────────────────────

export async function importInvoiceBatch(
  prisma: PrismaClient,
  entityId: string,
  batch: InboundInvoiceBatch
): Promise<InboundBatchResult> {
  const result: InboundBatchResult = {
    batchRef: batch.batchRef,
    sourceSystem: batch.sourceSystem,
    created: 0,
    skipped: 0,
    errors: [],
    createdIds: [],
    duplicateRefs: []
  };

  // Resolve actor (first entity user) for journal creation
  const actor = await entityActor(prisma, entityId);
  if (!actor) {
    result.errors.push({ index: -1, message: "No users found for this entity." });
    return result;
  }

  // Find the open period for invoices (most recent open period)
  const openPeriod = await prisma.period.findFirst({
    where: { entityId, status: "OPEN" },
    orderBy: [{ year: "desc" }, { month: "desc" }]
  });
  if (!openPeriod) {
    result.errors.push({ index: -1, message: "No open period found." });
    return result;
  }

  // Get entity functional currency for FX conversion
  const entity = await prisma.entity.findUniqueOrThrow({
    where: { id: entityId },
    select: { functionalCurrency: true }
  });
  const functionalCurrency = entity.functionalCurrency.toUpperCase();

  for (let i = 0; i < batch.invoices.length; i++) {
    const inv = batch.invoices[i];
    try {
      // Idempotency: check if this invoice already exists
      const dupRef = `${batch.sourceSystem}-${inv.invoiceNumber}`;
      const existing = await prisma.aPInvoice.findFirst({
        where: { entityId, reference: dupRef } as any,
        select: { id: true }
      });
      if (existing) {
        result.skipped++;
        result.duplicateRefs.push(dupRef);
        continue;
      }

      // Also check by supplier + invoice number
      const supplier = await prisma.supplier.findFirst({
        where: { entityId, code: inv.supplierCode }
      });
      if (!supplier) {
        result.errors.push({ index: i, message: `Supplier code "${inv.supplierCode}" not found.` });
        result.skipped++;
        continue;
      }

      const existingByNumber = await prisma.aPInvoice.findFirst({
        where: { entityId, supplierId: supplier.id, invoiceNumber: inv.invoiceNumber },
        select: { id: true }
      });
      if (existingByNumber) {
        result.skipped++;
        result.duplicateRefs.push(inv.invoiceNumber);
        continue;
      }

      // Resolve GL account IDs from codes
      const lines = [];
      let hasAccountError = false;
      for (const line of inv.lines) {
        const account = await prisma.account.findFirst({
          where: { entityId, code: line.glAccountCode, isActive: true },
          select: { id: true }
        });
        if (!account) {
          result.errors.push({
            index: i,
            message: `GL account code "${line.glAccountCode}" not found for line: ${line.description}`
          });
          hasAccountError = true;
          break;
        }
        lines.push({
          description: line.description,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: new Prisma.Decimal(line.unitPrice),
          amount: new Prisma.Decimal(line.amount),
          glAccountId: account.id,
          taxCode: line.taxCode
        });
      }
      if (hasAccountError) {
        result.skipped++;
        continue;
      }

      // Determine FX rate: use caller-provided rate, or auto-lookup from FX table
      const invCurrency = inv.currency.toUpperCase();
      let fxRate = new Prisma.Decimal(inv.fxRate);

      if (invCurrency !== functionalCurrency && fxRate.equals(1)) {
        // Caller didn't provide a rate (defaulted to 1) but currencies differ — auto-lookup
        const rateRecord = await prisma.fXRate.findFirst({
          where: { fromCurrency: invCurrency, toCurrency: functionalCurrency, rateType: "SPOT" },
          orderBy: { effectiveDate: "desc" }
        });
        if (rateRecord) {
          fxRate = rateRecord.rate;
        } else {
          result.errors.push({
            index: i,
            message: `No FX rate found for ${invCurrency}→${functionalCurrency}. Provide fxRate or add a SPOT rate.`
          });
          result.skipped++;
          continue;
        }
      }

      const grossAmount = new Prisma.Decimal(inv.grossAmount);
      const functionalAmount = grossAmount.mul(fxRate);

      const created = await (prisma.aPInvoice as any).create({
        data: {
          entityId,
          supplierId: supplier.id,
          periodId: openPeriod.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          currency: inv.currency.toUpperCase(),
          grossAmount,
          taxAmount: new Prisma.Decimal(inv.taxAmount),
          netAmount: new Prisma.Decimal(inv.netAmount),
          functionalAmount,
          fxRate,
          status: batch.autoPost ? "APPROVED" : "DRAFT",
          externalPoRef: inv.externalPoRef ?? null,
          paymentTerms: inv.paymentTerms,
          createdById: actor.userId,
          lines: { create: lines }
        },
        select: { id: true }
      });

      result.created++;
      result.createdIds.push(created.id);

      // Log import
      await (prisma as any).importLog
        ?.create?.({
          data: {
            entityId,
            connectorType: batch.sourceSystem,
            filename: `API-${batch.batchRef}`,
            status: "SUCCESS",
            recordsImported: 1,
            summary: { invoiceNumber: inv.invoiceNumber, supplierId: supplier.id }
          }
        })
        .catch(() => {});
    } catch (err) {
      result.errors.push({
        index: i,
        message: err instanceof Error ? err.message : "Unknown error"
      });
      result.skipped++;
    }
  }

  return result;
}

// ── Journal Import ──────────────────────────────────────────────────────────

export async function importJournalBatch(
  prisma: PrismaClient,
  entityId: string,
  batch: InboundJournalBatch
): Promise<InboundBatchResult> {
  const result: InboundBatchResult = {
    batchRef: batch.batchRef,
    sourceSystem: batch.sourceSystem,
    created: 0,
    skipped: 0,
    errors: [],
    createdIds: [],
    duplicateRefs: []
  };

  const actor = await entityActor(prisma, entityId);
  if (!actor) {
    result.errors.push({ index: -1, message: "No users found for this entity." });
    return result;
  }

  // Get entity functional currency for FX conversion on journal lines
  const jnlEntity = await prisma.entity.findUniqueOrThrow({
    where: { id: entityId },
    select: { functionalCurrency: true }
  });
  const jnlFunctionalCcy = jnlEntity.functionalCurrency.toUpperCase();

  // Cache FX rates per currency pair to avoid repeated lookups
  const fxRateCache = new Map<string, Prisma.Decimal>();

  for (let i = 0; i < batch.journals.length; i++) {
    const jnl = batch.journals[i];
    try {
      // Idempotency: check by reference
      const refKey = `${batch.sourceSystem}-${jnl.reference}`;
      const existing = await prisma.journal.findFirst({
        where: { entityId, reference: refKey, status: { not: "REVERSED" } },
        select: { id: true }
      });
      if (existing) {
        result.skipped++;
        result.duplicateRefs.push(refKey);
        continue;
      }

      // Find period for posting date
      const pd = jnl.postingDate;
      let period = await prisma.period.findFirst({
        where: { entityId, status: "OPEN", year: pd.getFullYear(), month: pd.getMonth() + 1 }
      });
      if (!period) {
        period = await prisma.period.findFirst({
          where: { entityId, status: "OPEN" },
          orderBy: [{ year: "desc" }, { month: "desc" }]
        });
      }
      if (!period) {
        result.errors.push({
          index: i,
          message: `No open period for date ${pd.toISOString().slice(0, 10)}.`
        });
        result.skipped++;
        continue;
      }

      // Resolve journal type if provided
      let journalTypeId: string | null = null;
      if (jnl.journalTypeCode) {
        const jt = await (prisma as any).journalType?.findFirst?.({
          where: { entityId, code: jnl.journalTypeCode, isActive: true },
          select: { id: true }
        });
        if (jt) journalTypeId = jt.id;
      }

      // Resolve account codes → IDs
      const journalLines: Array<{
        accountId: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        currency: string;
        fxRate: Prisma.Decimal;
        debitFunctional: Prisma.Decimal;
        creditFunctional: Prisma.Decimal;
        description?: string;
        dimension1?: string;
        dimension2?: string;
        dimension3?: string;
        dimension4?: string;
        dimension5?: string;
        dimension6?: string;
        lineNumber: number;
      }> = [];
      let hasError = false;
      for (let li = 0; li < jnl.lines.length; li++) {
        const line = jnl.lines[li];
        const account = await prisma.account.findFirst({
          where: { entityId, code: line.accountCode, isActive: true },
          select: { id: true }
        });
        if (!account) {
          result.errors.push({
            index: i,
            message: `Account code "${line.accountCode}" not found (line ${li + 1}).`
          });
          hasError = true;
          break;
        }
        const debit = new Prisma.Decimal(line.debit);
        const credit = new Prisma.Decimal(line.credit);
        const lineCcy = line.currency.toUpperCase();
        let lineFxRate = new Prisma.Decimal(line.fxRate);

        // Auto-lookup FX rate if line currency differs from entity functional currency
        // and caller used the default rate of 1
        if (lineCcy !== jnlFunctionalCcy && lineFxRate.equals(1)) {
          const cacheKey = `${lineCcy}→${jnlFunctionalCcy}`;
          if (fxRateCache.has(cacheKey)) {
            lineFxRate = fxRateCache.get(cacheKey)!;
          } else {
            const rateRec = await prisma.fXRate.findFirst({
              where: { fromCurrency: lineCcy, toCurrency: jnlFunctionalCcy, rateType: "SPOT" },
              orderBy: { effectiveDate: "desc" }
            });
            if (rateRec) {
              lineFxRate = rateRec.rate;
              fxRateCache.set(cacheKey, lineFxRate);
            } else {
              result.errors.push({
                index: i,
                message: `No FX rate for ${cacheKey} (line ${li + 1}). Provide fxRate or add a SPOT rate.`
              });
              hasError = true;
              break;
            }
          }
        }

        journalLines.push({
          accountId: account.id,
          debit,
          credit,
          currency: lineCcy,
          fxRate: lineFxRate,
          debitFunctional: debit.mul(lineFxRate),
          creditFunctional: credit.mul(lineFxRate),
          description: line.description,
          dimension1: line.dimension1,
          dimension2: line.dimension2,
          dimension3: line.dimension3,
          dimension4: line.dimension4,
          dimension5: line.dimension5,
          dimension6: line.dimension6,
          lineNumber: li + 1
        });
      }
      if (hasError) {
        result.skipped++;
        continue;
      }

      // F4: an inbound journal batch must be self-balancing — the source system
      // is asserting a complete journal. If debits != credits it is a data error
      // at the source, so reject the journal (do not post) rather than silently
      // creating an unbalanced entry.
      const totalDebit = journalLines.reduce((s, l) => s.add(l.debit), new Prisma.Decimal(0));
      const totalCredit = journalLines.reduce((s, l) => s.add(l.credit), new Prisma.Decimal(0));
      if (totalDebit.sub(totalCredit).abs().greaterThan(new Prisma.Decimal("0.0001"))) {
        result.errors.push({
          index: i,
          message: `Journal "${jnl.reference}" is unbalanced (debits ${totalDebit.toFixed(2)} != credits ${totalCredit.toFixed(2)}); not posted.`
        });
        result.skipped++;
        continue;
      }

      const journalData: Record<string, unknown> = {
        entityId,
        periodId: period.id,
        journalTypeId,
        reference: refKey,
        description: jnl.description ?? `${batch.sourceSystem} import — ${jnl.reference}`,
        source: jnl.source,
        functionalCurrency: jnlFunctionalCcy,
        status: batch.autoPost ? "POSTED" : "DRAFT",
        postedAt: batch.autoPost ? jnl.postingDate : null,
        createdById: actor.userId,
        lines: { create: journalLines }
      };

      // Wrap journal creation and balance updates in a transaction for atomicity
      const created = await prisma.$transaction(async (tx) => {
        const journal = await (tx.journal as any).create({
          data: journalData,
          select: { id: true }
        });

        // Update account balances atomically if auto-posted
        if (batch.autoPost) {
          for (const line of journalLines) {
            const acct = await tx.account.findFirst({
              where: { id: line.accountId },
              select: { type: true }
            });
            if (!acct) continue;
            const isDebitNormal = ["ASSET", "EXPENSE"].includes(acct.type);
            const sign = isDebitNormal ? 1 : -1;

            // Atomic upsert using INSERT ON CONFLICT — prevents race conditions
            await tx.$executeRaw`
              INSERT INTO account_period_balances
                (id, entity_id, account_id, period_id, opening_balance, period_debits, period_credits, closing_balance, created_at, updated_at)
              VALUES (
                gen_random_uuid()::text,
                ${entityId},
                ${line.accountId},
                ${period.id},
                0,
                ${line.debitFunctional}::decimal,
                ${line.creditFunctional}::decimal,
                ${sign} * (${line.debitFunctional}::decimal - ${line.creditFunctional}::decimal),
                NOW(), NOW()
              )
              ON CONFLICT (entity_id, account_id, period_id) DO UPDATE SET
                period_debits   = account_period_balances.period_debits   + EXCLUDED.period_debits,
                period_credits  = account_period_balances.period_credits  + EXCLUDED.period_credits,
                closing_balance = account_period_balances.opening_balance
                  + ${sign} * (
                    (account_period_balances.period_debits + EXCLUDED.period_debits)
                    - (account_period_balances.period_credits + EXCLUDED.period_credits)
                  ),
                updated_at = NOW()
            `;
          }
        }

        return journal;
      });

      result.created++;
      result.createdIds.push(created.id);
    } catch (err) {
      result.errors.push({
        index: i,
        message: err instanceof Error ? err.message : "Unknown error"
      });
      result.skipped++;
    }
  }

  return result;
}

// ── Supplier Sync ───────────────────────────────────────────────────────────

export async function syncSupplierBatch(
  prisma: PrismaClient,
  entityId: string,
  batch: InboundSupplierBatch
): Promise<InboundBatchResult> {
  const result: InboundBatchResult = {
    batchRef: `supplier-sync-${Date.now()}`,
    sourceSystem: batch.sourceSystem,
    created: 0,
    skipped: 0,
    errors: [],
    createdIds: [],
    duplicateRefs: []
  };

  for (let i = 0; i < batch.suppliers.length; i++) {
    const sup = batch.suppliers[i];
    try {
      const existing = await prisma.supplier.findFirst({
        where: { entityId, code: sup.code },
        select: { id: true }
      });

      if (existing) {
        // Update existing supplier
        await prisma.supplier.updateMany({
          where: { entityId, id: existing.id },
          data: {
            name: sup.name,
            taxId: sup.taxId,
            currency: sup.currency.toUpperCase(),
            paymentTermsDays: sup.paymentTermsDays,
            bankDetails: (sup.bankDetails ?? undefined) as any,
            isActive: sup.isActive
          }
        });
        result.skipped++; // "skipped" = updated, not created
        result.duplicateRefs.push(sup.code);
      } else {
        const created = await prisma.supplier.create({
          data: {
            entityId,
            code: sup.code,
            name: sup.name,
            taxId: sup.taxId,
            currency: sup.currency.toUpperCase(),
            paymentTermsDays: sup.paymentTermsDays,
            bankDetails: (sup.bankDetails ?? undefined) as any,
            isActive: sup.isActive
          },
          select: { id: true }
        });
        result.created++;
        result.createdIds.push(created.id);
      }
    } catch (err) {
      result.errors.push({
        index: i,
        message: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  return result;
}
