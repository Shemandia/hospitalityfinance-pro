import { Prisma, PrismaClient } from "../../db/client.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { ServiceError } from "../../shared/service-error.js";

export class ConsolidationServiceError extends ServiceError {}

type ConsolidationRequest = {
  parentEntityId: string;
  childEntityIds: string[];
  reportingCurrency: string;
  periodId: string;
};

type EntityTrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  usali_category: string | null;
  usali_department: string | null;
  closing_balance: Prisma.Decimal;
};

type ConsolidatedLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  usaliCategory: string | null;
  usaliDepartment: string | null;
  entityAmounts: Record<string, string>;
  eliminationsAmount: string;
  consolidatedAmount: string;
};

export class ConsolidationService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Walk parent_id upward from an entity (raw SQL — mirrors plugins/auth.ts). */
  private async resolveEntityLineage(entityId: string): Promise<string[]> {
    const lineage: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = entityId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const rows = (await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, parent_id as "parentId" FROM entities WHERE id = $1 LIMIT 1`,
        currentId
      )) as Array<{ id: string; parentId: string | null }>;
      const entity = rows[0];
      if (!entity) break;
      lineage.push(entity.id);
      currentId = entity.parentId;
    }

    return lineage;
  }

  /**
   * NS3: every consolidated child must be a strict descendant of the parent.
   * mv_period_account_balances ignores RLS, so this is the access boundary.
   */
  private async assertChildrenAreSubsidiaries(
    parentEntityId: string,
    childEntityIds: string[]
  ): Promise<void> {
    for (const childId of [...new Set(childEntityIds)]) {
      const lineage = await this.resolveEntityLineage(childId);
      const isStrictDescendant =
        childId !== parentEntityId && lineage.slice(1).includes(parentEntityId);
      if (!isStrictDescendant) {
        throw new ConsolidationServiceError(
          "CONSOL_CHILD_FORBIDDEN",
          `Entity ${childId} is not a subsidiary of the consolidation parent.`,
          403
        );
      }
    }
  }

  listRuns(parentEntityId: string, take = 50, skip = 0) {
    return this.prisma.consolidationRun.findMany({
      where: { parentEntityId },
      orderBy: [{ createdAt: "desc" }],
      include: { entityResults: true },
      take,
      skip
    });
  }

  async getRun(parentEntityId: string, runId: string) {
    const run = await this.prisma.consolidationRun.findFirst({
      where: { parentEntityId, id: runId },
      include: { entityResults: { include: { entity: true } } }
    });
    if (!run) {
      throw new ConsolidationServiceError(
        "CONSOL_RUN_NOT_FOUND",
        "Consolidation run not found.",
        404
      );
    }
    return run;
  }

  async runConsolidation(request: ConsolidationRequest): Promise<{
    runId: string;
    consolidatedLines: ConsolidatedLine[];
    ctaTotalAmount: string;
    eliminationWarnings: string[];
  }> {
    const parentEntity = await this.prisma.entity.findUnique({
      where: { id: request.parentEntityId }
    });
    if (!parentEntity) {
      throw new ConsolidationServiceError(
        "CONSOL_PARENT_NOT_FOUND",
        "Parent entity not found.",
        404
      );
    }

    await this.assertChildrenAreSubsidiaries(request.parentEntityId, request.childEntityIds);

    const period = await this.prisma.period.findFirst({
      where: { id: request.periodId, entityId: request.parentEntityId }
    });
    if (!period) {
      throw new ConsolidationServiceError(
        "CONSOL_PERIOD_NOT_FOUND",
        "Period not found for the parent entity.",
        404
      );
    }

    const consolidatedMap = new Map<string, ConsolidatedLine>();
    const accountIdToCode = new Map<string, string>();
    const entityResults: Array<{
      entityId: string;
      localCurrency: string;
      closingRate: Prisma.Decimal;
      averageRate: Prisma.Decimal;
      translatedDebits: Prisma.Decimal;
      translatedCredits: Prisma.Decimal;
      ctaAmount: Prisma.Decimal;
    }> = [];
    const eliminationWarnings: string[] = [];
    let totalCtaAmount = new Prisma.Decimal(0);

    // ── Batch-load child entities and FX rates (eliminates N+1) ──────────────
    const childEntities = await this.prisma.entity.findMany({
      where: { id: { in: request.childEntityIds } }
    });
    const childEntityMap = new Map(childEntities.map((e) => [e.id, e]));

    // Collect unique currencies that need translation
    const currenciesNeedingRates = new Set<string>();
    for (const entity of childEntities) {
      if (entity.functionalCurrency !== request.reportingCurrency) {
        currenciesNeedingRates.add(entity.functionalCurrency);
      }
    }

    // Batch-load FX rates for all needed currencies (closing + average)
    const periodEndDate = new Date(period.year, period.month, 0);
    const fxRatesMap = new Map<string, { closing: Prisma.Decimal; average: Prisma.Decimal }>();

    if (currenciesNeedingRates.size > 0) {
      const allRates = await this.prisma.fXRate.findMany({
        where: {
          fromCurrency: { in: [...currenciesNeedingRates] },
          toCurrency: request.reportingCurrency,
          rateType: { in: ["CLOSING", "AVERAGE"] },
          effectiveDate: { lte: periodEndDate }
        },
        orderBy: [{ effectiveDate: "desc" }]
      });

      // Group by currency and pick the most recent rate per type
      for (const rate of allRates) {
        const key = rate.fromCurrency;
        const existing = fxRatesMap.get(key) ?? {
          closing: new Prisma.Decimal(0),
          average: new Prisma.Decimal(0)
        };
        if (rate.rateType === "CLOSING" && existing.closing.isZero()) {
          existing.closing = rate.rate;
        }
        if (rate.rateType === "AVERAGE" && existing.average.isZero()) {
          existing.average = rate.rate;
        }
        fxRatesMap.set(key, existing);
      }
    }

    // ── Rate preflight ───────────────────────────────────────────────────────
    // Refuse to consolidate at all if any child needs translation and lacks a
    // rate. This previously fell back to 1:1 with a warning, which silently
    // overstated a TZS child in a USD group by roughly 2,500x — a consolidated
    // balance sheet that looks plausible and is wrong by orders of magnitude is
    // far more dangerous than no report.
    // Populated per child below; eliminations reuse these so they translate at
    // exactly the rates their entity's balances were translated at.
    const entityRates = new Map<
      string,
      { closingRate: Prisma.Decimal; averageRate: Prisma.Decimal }
    >();

    const missingRates: string[] = [];
    for (const childEntityId of request.childEntityIds) {
      const childEntity = childEntityMap.get(childEntityId);
      if (!childEntity) continue;
      const localCurrency = childEntity.functionalCurrency;
      if (localCurrency === request.reportingCurrency) continue;

      const rates = fxRatesMap.get(localCurrency);
      if (!rates || rates.closing.isZero() || rates.average.isZero()) {
        const missing = [
          !rates || rates.closing.isZero() ? "CLOSING" : null,
          !rates || rates.average.isZero() ? "AVERAGE" : null
        ].filter(Boolean);
        missingRates.push(
          `${childEntity.name}: ${localCurrency}/${request.reportingCurrency} (${missing.join(" and ")})`
        );
      }
    }
    if (missingRates.length > 0) {
      throw new ConsolidationServiceError(
        "CONSOLIDATION_MISSING_FX_RATES",
        `Cannot consolidate: FX rates are missing for ${missingRates.length} entity/currency ` +
          `combination(s) — ${missingRates.join("; ")}. Enter the rates for this period first. ` +
          `Balances are no longer translated at 1:1 when a rate is absent.`,
        422
      );
    }

    // ── Process each child entity ────────────────────────────────────────────
    for (const childEntityId of request.childEntityIds) {
      const childEntity = childEntityMap.get(childEntityId);
      if (!childEntity) continue;

      const localCurrency = childEntity.functionalCurrency;
      const needsTranslation = localCurrency !== request.reportingCurrency;

      let closingRate = new Prisma.Decimal(1);
      let averageRate = new Prisma.Decimal(1);

      if (needsTranslation) {
        // Guaranteed present by the preflight above.
        const rates = fxRatesMap.get(localCurrency)!;
        closingRate = rates.closing;
        averageRate = rates.average;
      }

      // Rates each child was translated at, so eliminations can use the same.
      entityRates.set(childEntityId, { closingRate, averageRate });

      // Get trial balance for this child entity (uses materialized view — must stay per-entity)
      const trialBalance = await this.prisma.$queryRaw<EntityTrialBalanceRow[]>`
        SELECT
          "accountId"      AS account_id,
          account_code,
          account_name,
          account_type,
          usali_category,
          usali_department,
          closing_balance
        FROM mv_period_account_balances
        WHERE "entityId" = ${childEntityId}
          AND "periodId" = ${request.periodId}
          AND is_active = true
          AND closing_balance <> 0
        ORDER BY account_code ASC;
      `;

      let translatedDebits = new Prisma.Decimal(0);
      let translatedCredits = new Prisma.Decimal(0);
      // CTA: accumulate the translation difference for balance sheet items only
      let ctaAmount = new Prisma.Decimal(0);

      for (const row of trialBalance) {
        const balance = new Prisma.Decimal(row.closing_balance);

        // IAS 21: Assets/Liabilities at closing rate; Income/Expenses at average rate; Equity at historical
        const isBalanceSheet = ["ASSET", "LIABILITY", "EQUITY"].includes(row.account_type);
        const rate = isBalanceSheet ? closingRate : averageRate;
        const translatedBalance = balance.mul(rate);

        // CTA = (BS items at closing rate) - (BS items at average rate)
        // This isolates the pure translation effect for OCI reporting
        if (isBalanceSheet && row.account_type !== "EQUITY") {
          const atAverage = balance.mul(averageRate);
          ctaAmount = ctaAmount.add(translatedBalance.sub(atAverage));
        }

        // Use account_code as map key so same-named accounts across entities are aggregated
        const mapKey = row.account_code;
        accountIdToCode.set(row.account_id, row.account_code);
        if (!consolidatedMap.has(mapKey)) {
          consolidatedMap.set(mapKey, {
            accountId: row.account_id,
            accountCode: row.account_code,
            accountName: row.account_name,
            accountType: row.account_type,
            usaliCategory: row.usali_category,
            usaliDepartment: row.usali_department,
            entityAmounts: {},
            eliminationsAmount: "0.0000",
            consolidatedAmount: "0.0000"
          });
        }

        const line = consolidatedMap.get(mapKey)!;
        line.entityAmounts[childEntityId] = translatedBalance.toFixed(4);
        const current = new Prisma.Decimal(line.consolidatedAmount);
        line.consolidatedAmount = current.add(translatedBalance).toFixed(4);

        if (translatedBalance.greaterThan(0)) {
          translatedDebits = translatedDebits.add(translatedBalance);
        } else {
          translatedCredits = translatedCredits.add(translatedBalance.abs());
        }
      }
      totalCtaAmount = totalCtaAmount.add(ctaAmount);

      entityResults.push({
        entityId: childEntityId,
        localCurrency,
        closingRate,
        averageRate,
        translatedDebits,
        translatedCredits,
        ctaAmount
      });
    }

    // Identify and eliminate inter-company balances (dimension1 tagged as IC).
    //
    // Bypasses RLS for the same reason the balance read does. This filters on
    // journal.entityId, and `journals` is entity-scoped, so running in the
    // PARENT's context hid every CHILD journal and the query returned nothing —
    // eliminations silently did not happen at all. Child balances are already
    // read through mv_period_account_balances, which has no RLS;
    // assertChildrenAreSubsidiaries above is the access boundary for both.
    const intercompanyLines = await withBypassRLS(this.prisma, async (tx: any) =>
      tx.journalLine.findMany({
        where: {
          journal: {
            entityId: { in: request.childEntityIds },
            periodId: request.periodId
          },
          dimension1: "INTERCOMPANY"
        },
        include: {
          journal: { select: { entityId: true } },
          account: true
        }
      })
    );

    // Aggregate intercompany balances into REPORTING currency.
    //
    // Two defects lived here. The net line was summed in the posting entity's
    // FUNCTIONAL currency and then subtracted from a reporting-currency figure,
    // so eliminating a TZS intercompany balance from a USD consolidation was
    // out by the exchange rate itself. And the lines were grouped by account
    // alone, across every child, so there was no single rate that could have
    // been applied even in principle — each child translates at its own.
    //
    // The sign was wrong too: consolidatedAmount accumulates
    // normal-balance-positive translated balances, while debit - credit is
    // natural-sign. For a credit-normal intercompany payable the two disagree,
    // so the "elimination" increased the balance instead of removing it.
    const icGrouped = new Map<string, Prisma.Decimal>();
    for (const line of intercompanyLines) {
      const postingEntityId = line.journal.entityId;
      const rates = entityRates.get(postingEntityId);
      if (!rates) continue; // line belongs to an entity outside this run

      // Same rate rule as the trial balance: closing for balance-sheet
      // accounts, average for income and expense.
      const isBalanceSheet = ["ASSET", "LIABILITY", "EQUITY"].includes(line.account.type);
      const rate = isBalanceSheet ? rates.closingRate : rates.averageRate;

      // Natural sign, then normalised to normal-balance-positive to match the
      // convention consolidatedAmount is accumulated in.
      const naturalNet = new Prisma.Decimal(line.debitFunctional).sub(
        new Prisma.Decimal(line.creditFunctional)
      );
      const sign = line.account.normalBalance === "DEBIT" ? 1 : -1;
      const normalised = naturalNet.mul(sign);

      const key = line.accountId;
      const current = icGrouped.get(key) ?? new Prisma.Decimal(0);
      icGrouped.set(key, current.add(normalised.mul(rate)));
    }

    for (const [accountId, icBalance] of icGrouped) {
      const accountCode = accountIdToCode.get(accountId);
      const line = accountCode ? consolidatedMap.get(accountCode) : undefined;
      if (line) {
        line.eliminationsAmount = icBalance.neg().toFixed(4);
        const consolidated = new Prisma.Decimal(line.consolidatedAmount).add(icBalance.neg());
        line.consolidatedAmount = consolidated.toFixed(4);
        if (icBalance.abs().greaterThan(new Prisma.Decimal("100"))) {
          eliminationWarnings.push(
            `IC elimination difference of ${icBalance.toFixed(2)} on account ${line.accountCode}`
          );
        }
      }
    }

    // Persist the run.
    //
    // consolidation_run_entities is entity-scoped under RLS, so each row must
    // satisfy entity_id = app_current_entity_id(). A consolidation necessarily
    // runs in the PARENT's context while writing one row per CHILD, so every
    // insert was rejected with 42501 and no consolidation could be saved at all.
    //
    // The access boundary for this operation is assertChildrenAreSubsidiaries
    // above, which already refuses any child that is not a strict descendant of
    // the parent — the same boundary the service relies on when reading child
    // balances through mv_period_account_balances, which has no RLS either.
    const run = await withBypassRLS(this.prisma, async (tx: any) =>
      tx.consolidationRun.create({
        data: {
          parentEntityId: request.parentEntityId,
          reportingCurrency: request.reportingCurrency,
          periodId: request.periodId,
          status: "COMPLETE",
          runAt: new Date(),
          eliminationJournals: Object.fromEntries(icGrouped) as Prisma.InputJsonValue,
          entityResults: {
            create: entityResults.map((er) => ({
              entityId: er.entityId,
              localCurrency: er.localCurrency,
              closingRate: er.closingRate,
              averageRate: er.averageRate,
              translatedDebits: er.translatedDebits,
              translatedCredits: er.translatedCredits,
              ctaAmount: er.ctaAmount
            }))
          }
        }
      })
    );

    return {
      runId: run.id,
      consolidatedLines: Array.from(consolidatedMap.values()),
      ctaTotalAmount: totalCtaAmount.toFixed(4),
      eliminationWarnings
    };
  }
}
