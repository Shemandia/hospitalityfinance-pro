import { Prisma, PrismaClient } from "@prisma/client";

export class ConsolidationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

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

    for (const childEntityId of request.childEntityIds) {
      const childEntity = await this.prisma.entity.findUnique({
        where: { id: childEntityId }
      });
      if (!childEntity) continue;

      const localCurrency = childEntity.functionalCurrency;
      const needsTranslation = localCurrency !== request.reportingCurrency;

      // Get closing and average rates for this entity's currency
      let closingRate = new Prisma.Decimal(1);
      let averageRate = new Prisma.Decimal(1);

      if (needsTranslation) {
        const closingRateRecord = await this.prisma.fXRate.findFirst({
          where: {
            fromCurrency: localCurrency,
            toCurrency: request.reportingCurrency,
            rateType: "CLOSING",
            effectiveDate: {
              lte: new Date(`${period.year}-${String(period.month).padStart(2, "0")}-28`)
            }
          },
          orderBy: [{ effectiveDate: "desc" }]
        });

        const averageRateRecord = await this.prisma.fXRate.findFirst({
          where: {
            fromCurrency: localCurrency,
            toCurrency: request.reportingCurrency,
            rateType: "AVERAGE",
            effectiveDate: {
              lte: new Date(`${period.year}-${String(period.month).padStart(2, "0")}-28`)
            }
          },
          orderBy: [{ effectiveDate: "desc" }]
        });

        if (!closingRateRecord || !averageRateRecord) {
          eliminationWarnings.push(
            `Missing FX rates for ${localCurrency}/${request.reportingCurrency} — entity ${childEntity.name} translated at 1:1`
          );
        } else {
          closingRate = closingRateRecord.rate;
          averageRate = averageRateRecord.rate;
        }
      }

      // Get trial balance for this child entity
      const trialBalance = await this.prisma.$queryRaw<EntityTrialBalanceRow[]>`
        SELECT
          a.id          AS account_id,
          a.code        AS account_code,
          a.name        AS account_name,
          a.type        AS account_type,
          a.usali_category,
          a.usali_department,
          COALESCE(apb.closing_balance, 0)::numeric(18,4) AS closing_balance
        FROM accounts a
        LEFT JOIN account_period_balances apb
          ON apb.account_id = a.id
         AND apb.entity_id = ${childEntityId}
         AND apb.period_id = ${request.periodId}
        WHERE a.entity_id = ${childEntityId}
          AND a.is_active = true
          AND COALESCE(apb.closing_balance, 0) <> 0
        ORDER BY a.code ASC;
      `;

      let translatedDebits = new Prisma.Decimal(0);
      let translatedCredits = new Prisma.Decimal(0);

      for (const row of trialBalance) {
        const balance = new Prisma.Decimal(row.closing_balance);

        // IAS 21: Assets/Liabilities at closing rate; Income/Expenses at average rate; Equity at historical
        const isBalanceSheet = ["ASSET", "LIABILITY", "EQUITY"].includes(row.account_type);
        const rate = isBalanceSheet ? closingRate : averageRate;
        const translatedBalance = balance.mul(rate);

        if (!consolidatedMap.has(row.account_id)) {
          consolidatedMap.set(row.account_id, {
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

        const line = consolidatedMap.get(row.account_id)!;
        line.entityAmounts[childEntityId] = translatedBalance.toFixed(4);
        const current = new Prisma.Decimal(line.consolidatedAmount);
        line.consolidatedAmount = current.add(translatedBalance).toFixed(4);

        if (translatedBalance.greaterThan(0)) {
          translatedDebits = translatedDebits.add(translatedBalance);
        } else {
          translatedCredits = translatedCredits.add(translatedBalance.abs());
        }
      }

      // CTA = difference between balance sheet translation at closing vs average
      const ctaAmount = translatedDebits.sub(translatedCredits);
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

    // Identify and eliminate inter-company balances (dimension1 tagged as IC)
    const intercompanyLines = await this.prisma.journalLine.findMany({
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
    });

    const icGrouped = new Map<string, Prisma.Decimal>();
    for (const line of intercompanyLines) {
      const key = `${line.accountId}`;
      const current = icGrouped.get(key) ?? new Prisma.Decimal(0);
      const netLine = new Prisma.Decimal(line.debitFunctional).sub(
        new Prisma.Decimal(line.creditFunctional)
      );
      icGrouped.set(key, current.add(netLine));
    }

    for (const [accountId, icBalance] of icGrouped) {
      const line = consolidatedMap.get(accountId);
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

    // Persist the run
    const run = await this.prisma.consolidationRun.create({
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
    });

    return {
      runId: run.id,
      consolidatedLines: Array.from(consolidatedMap.values()),
      ctaTotalAmount: totalCtaAmount.toFixed(4),
      eliminationWarnings
    };
  }
}
