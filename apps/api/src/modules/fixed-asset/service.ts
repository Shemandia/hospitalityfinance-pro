import type { PrismaClient } from "../../db/client.js";
import { Prisma } from "../../db/client.js";
import { publishEvent } from "../../shared/rabbitmq.js";
import { ProcessLockService, ProcessLockError } from "../process-lock/service.js";
import { AuditService } from "../audit/service.js";

import { ServiceError } from "../../shared/service-error.js";

import { applyBalanceDeltas } from "../../db/balance-writer.js";
// ── Error ────────────────────────────────────────────────────────────────────

export class FixedAssetServiceError extends ServiceError {}

// ── Decimal Helpers ─────────────────────────────────────────────────────────

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v ?? 0));
const ZERO = new Prisma.Decimal(0);
const FOUR_DP = 4;

// ── Types ────────────────────────────────────────────────────────────────────

export type DepreciationLineResult = {
  assetId: string;
  assetCode: string;
  description: string;
  depreciationAmount: Prisma.Decimal;
  bsAccount: string;
  plAccount: string;
};

export type DepreciationRunResult = {
  periodId: string;
  totalDepreciation: Prisma.Decimal;
  assetCount: number;
  lines: DepreciationLineResult[];
  journalId?: string;
};

// ── Service ──────────────────────────────────────────────────────────────────

export class FixedAssetService {
  private readonly lockService: ProcessLockService;

  constructor(private readonly prisma: PrismaClient) {
    this.lockService = new ProcessLockService(prisma);
  }

  // ── Asset Category CRUD ──────────────────────────────────────────────────

  async createCategory(entityId: string, input: any) {
    const existing = await (this.prisma as any).assetCategory.findFirst({
      where: { entityId, code: input.code }
    });
    if (existing) {
      throw new FixedAssetServiceError(
        "ASSET_CATEGORY_DUPLICATE",
        `Asset category "${input.code}" already exists.`,
        409
      );
    }

    return (this.prisma as any).assetCategory.create({
      data: {
        entityId,
        code: input.code,
        name: input.name,
        defaultUsefulLifeMonths: input.defaultUsefulLifeMonths ?? null,
        defaultDepreciationMethod: input.defaultDepreciationMethod ?? null,
        defaultBsDepreciationAcct: input.defaultBsDepreciationAcct ?? null,
        defaultPlDepreciationAcct: input.defaultPlDepreciationAcct ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0
      }
    });
  }

  async listCategories(entityId: string) {
    return (this.prisma as any).assetCategory.findMany({
      where: { entityId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
  }

  // ── Fixed Asset CRUD ─────────────────────────────────────────────────────

  async createAsset(entityId: string, userId: string, input: any) {
    const existing = await (this.prisma as any).fixedAsset.findFirst({
      where: { entityId, assetCode: input.assetCode }
    });
    if (existing) {
      throw new FixedAssetServiceError(
        "ASSET_DUPLICATE_CODE",
        `Asset code "${input.assetCode}" already exists.`,
        409
      );
    }

    const grossValue = D(input.grossValue);
    const finalValue = D(input.finalValue);

    return (this.prisma as any).fixedAsset.create({
      data: {
        entityId,
        assetCode: input.assetCode,
        lookupCode: input.lookupCode ?? null,
        description: input.description,
        categoryId: input.categoryId ?? null,
        bsDepreciationAccount: input.bsDepreciationAccount,
        plDepreciationAccount: input.plDepreciationAccount,
        depreciationMethod: input.depreciationMethod ?? "STRAIGHT_LINE",
        depreciationRate: input.depreciationRate ?? null,
        usefulLifeMonths: input.usefulLifeMonths,
        depreciationStartPeriodId: input.depreciationStartPeriodId ?? null,
        firstPeriodDays: input.firstPeriodDays ?? null,
        finalValue,
        grossValue,
        accumulatedDepreciation: ZERO,
        netValue: grossValue,
        assetQuantity: input.assetQuantity ?? null,
        acquisitionDate: new Date(input.acquisitionDate),
        status: "ACTIVE",
        analysisCode1: input.analysisCode1 ?? null,
        analysisCode2: input.analysisCode2 ?? null,
        analysisCode3: input.analysisCode3 ?? null,
        analysisCode4: input.analysisCode4 ?? null,
        analysisCode5: input.analysisCode5 ?? null,
        createdById: userId
      },
      include: { category: true }
    });
  }

  async getAsset(entityId: string, id: string) {
    const asset = await (this.prisma as any).fixedAsset.findFirst({
      where: { entityId, id },
      include: { category: true }
    });
    if (!asset) {
      throw new FixedAssetServiceError("ASSET_NOT_FOUND", "Asset not found.", 404);
    }
    return asset;
  }

  async listAssets(
    entityId: string,
    query: { status?: string; categoryId?: string; search?: string }
  ) {
    const where: any = { entityId };
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) {
      where.OR = [
        { assetCode: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
        { lookupCode: { contains: query.search, mode: "insensitive" } }
      ];
    }

    return (this.prisma as any).fixedAsset.findMany({
      where,
      include: { category: true },
      orderBy: [{ assetCode: "asc" }]
    });
  }

  async updateAsset(entityId: string, id: string, input: any) {
    await this.getAsset(entityId, id);

    const data: any = {};
    if (input.description !== undefined) data.description = input.description;
    if (input.lookupCode !== undefined) data.lookupCode = input.lookupCode;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.analysisCode1 !== undefined) data.analysisCode1 = input.analysisCode1;
    if (input.analysisCode2 !== undefined) data.analysisCode2 = input.analysisCode2;
    if (input.analysisCode3 !== undefined) data.analysisCode3 = input.analysisCode3;
    if (input.analysisCode4 !== undefined) data.analysisCode4 = input.analysisCode4;
    if (input.analysisCode5 !== undefined) data.analysisCode5 = input.analysisCode5;
    if (input.assetQuantity !== undefined) data.assetQuantity = input.assetQuantity;

    return (this.prisma as any).fixedAsset.update({
      where: { id },
      data,
      include: { category: true }
    });
  }

  // ── Depreciation Engine ──────────────────────────────────────────────────

  /**
   * Calculate monthly depreciation for all ACTIVE assets (dry-run).
   */
  async calculateDepreciation(entityId: string, periodId: string): Promise<DepreciationRunResult> {
    const assets = await (this.prisma as any).fixedAsset.findMany({
      where: { entityId, status: "ACTIVE" }
    });

    const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
      where: { entityId, ledger: "A" }
    });

    const excludeFinal = ledgerSetup?.excludeFinalValueFromDepn ?? true;
    const fullYearFirst = ledgerSetup?.fullYearDepreciationFirstYear ?? false;

    const lines: DepreciationLineResult[] = [];

    for (const asset of assets) {
      const amount = this._calculateAssetDepreciation(asset, excludeFinal, fullYearFirst);
      if (amount.lte(ZERO)) continue;

      lines.push({
        assetId: asset.id,
        assetCode: asset.assetCode,
        description: asset.description,
        depreciationAmount: amount.toDecimalPlaces(FOUR_DP),
        bsAccount: asset.bsDepreciationAccount,
        plAccount: asset.plDepreciationAccount
      });
    }

    const totalDepreciation = lines
      .reduce((sum, l) => sum.add(l.depreciationAmount), ZERO)
      .toDecimalPlaces(FOUR_DP);

    return {
      periodId,
      totalDepreciation,
      assetCount: lines.length,
      lines
    };
  }

  /**
   * Calculate monthly depreciation for a single asset.
   * All arithmetic uses Prisma.Decimal to avoid IEEE 754 precision loss.
   */
  private _calculateAssetDepreciation(
    asset: any,
    excludeFinal: boolean,
    _fullYearFirst: boolean
  ): Prisma.Decimal {
    if (asset.depreciationMethod === "NONE") return ZERO;

    const grossValue = D(asset.grossValue);
    const accumulatedDepreciation = D(asset.accumulatedDepreciation);
    const netValue = D(asset.netValue);
    const finalValue = excludeFinal ? D(asset.finalValue) : ZERO;
    const usefulLifeMonths = asset.usefulLifeMonths;

    if (usefulLifeMonths <= 0) return ZERO;

    // Cannot depreciate below final value
    if (netValue.lte(finalValue)) return ZERO;

    let monthlyAmount: Prisma.Decimal;

    switch (asset.depreciationMethod) {
      case "STRAIGHT_LINE": {
        const depreciableBase = grossValue.sub(finalValue);
        if (depreciableBase.lte(ZERO)) return ZERO;
        monthlyAmount = depreciableBase.div(usefulLifeMonths).toDecimalPlaces(FOUR_DP);
        break;
      }

      case "REDUCING_BALANCE": {
        const annualRate = D(asset.depreciationRate);
        if (annualRate.lte(ZERO)) return ZERO;
        const monthlyRate = annualRate.div(100).div(12);
        monthlyAmount = netValue.mul(monthlyRate).toDecimalPlaces(FOUR_DP);
        break;
      }

      case "SUM_OF_DIGITS": {
        const depreciableBase = grossValue.sub(finalValue);
        if (depreciableBase.lte(ZERO)) return ZERO;

        const monthsCharged = this._estimateMonthsCharged(
          grossValue,
          finalValue,
          accumulatedDepreciation,
          usefulLifeMonths
        );
        const remainingMonths = Math.max(usefulLifeMonths - monthsCharged, 0);
        if (remainingMonths <= 0) return ZERO;

        const sumTotal = (usefulLifeMonths * (usefulLifeMonths + 1)) / 2;
        monthlyAmount = depreciableBase.mul(remainingMonths).div(sumTotal).toDecimalPlaces(FOUR_DP);
        break;
      }

      case "USER_TABLE": {
        return ZERO;
      }

      default:
        return ZERO;
    }

    // Cap: don't depreciate below final value
    const maxAllowed = netValue.sub(finalValue);
    if (monthlyAmount.gt(maxAllowed)) {
      monthlyAmount = maxAllowed;
    }

    return Prisma.Decimal.max(monthlyAmount, ZERO);
  }

  /**
   * Estimate how many months of depreciation have been charged,
   * based on accumulated depreciation vs the straight-line monthly amount.
   */
  private _estimateMonthsCharged(
    grossValue: Prisma.Decimal,
    finalValue: Prisma.Decimal,
    accumulatedDepreciation: Prisma.Decimal,
    usefulLifeMonths: number
  ): number {
    const depreciableBase = grossValue.sub(finalValue);
    if (depreciableBase.lte(ZERO) || usefulLifeMonths <= 0) return 0;
    const straightLineMonthly = depreciableBase.div(usefulLifeMonths);
    if (straightLineMonthly.lte(ZERO)) return 0;
    return accumulatedDepreciation.div(straightLineMonthly).round().toNumber();
  }

  /**
   * Run depreciation for a period: calculate, post journal, update asset values.
   * Acquires DEPRECIATION process lock.
   */
  async runDepreciation(
    entityId: string,
    periodId: string,
    executedBy: string
  ): Promise<DepreciationRunResult> {
    // Acquire lock
    try {
      await this.lockService.acquireLock({
        entityId,
        processType: "DEPRECIATION",
        userId: executedBy,
        timeoutMinutes: 15
      });
    } catch (error) {
      if (error instanceof ProcessLockError && error.code === "LOCK_HELD") {
        throw new FixedAssetServiceError(
          "DEPRECIATION_LOCKED",
          "Another depreciation run is already in progress.",
          409
        );
      }
      throw error;
    }

    try {
      // Validate period
      const period = await (this.prisma as any).period.findFirst({
        where: { id: periodId, entityId }
      });
      if (!period) {
        throw new FixedAssetServiceError("DEPRECIATION_PERIOD_NOT_FOUND", "Period not found.", 404);
      }
      if (period.status !== "OPEN" && period.status !== "SOFT_CLOSE") {
        throw new FixedAssetServiceError(
          "DEPRECIATION_PERIOD_NOT_OPEN",
          "Depreciation can only run on OPEN or SOFT_CLOSE periods.",
          409
        );
      }

      const journalReference = `DEPRC-${period.year}-${String(period.month).padStart(2, "0")}`;

      // Idempotency guard: a posted depreciation journal for this period means
      // the run already completed — a second run would double depreciation.
      const completedRun = await (this.prisma as any).journal.findFirst({
        where: {
          entityId,
          periodId,
          source: "DEPRC",
          reference: journalReference,
          status: "POSTED"
        }
      });
      if (completedRun) {
        throw new FixedAssetServiceError(
          "DEPRECIATION_ALREADY_RUN",
          `Depreciation has already been posted for this period (journal ${completedRun.id}).`,
          409
        );
      }

      // Calculate
      const result = await this.calculateDepreciation(entityId, periodId);

      if (result.lines.length === 0) {
        return result;
      }

      // Get functional currency
      const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
        where: { entityId, ledger: "A" }
      });
      const functionalCurrency = ledgerSetup?.baseCurrency ?? "USD";

      // Resolve account IDs for all BS and PL accounts
      const accountCodes = new Set<string>();
      for (const line of result.lines) {
        accountCodes.add(line.bsAccount);
        accountCodes.add(line.plAccount);
      }
      const accounts = await (this.prisma as any).account.findMany({
        where: { entityId, code: { in: [...accountCodes] }, isActive: true },
        select: { id: true, code: true, type: true }
      });
      const accountMap = new Map(accounts.map((a: any) => [a.code, a]));

      // Build journal lines
      const journalLines: any[] = [];
      let lineNum = 1;
      for (const line of result.lines) {
        const plAcct: any = accountMap.get(line.plAccount);
        const bsAcct: any = accountMap.get(line.bsAccount);

        if (!plAcct || !bsAcct) continue;

        const amt = line.depreciationAmount.toFixed(FOUR_DP);

        // DR Depreciation Expense (P&L)
        journalLines.push({
          accountId: plAcct.id,
          debit: amt,
          credit: "0",
          currency: functionalCurrency,
          fxRate: "1",
          debitFunctional: amt,
          creditFunctional: "0",
          description: `Depreciation: ${line.assetCode} — ${line.description}`,
          lineNumber: lineNum++
        });

        // CR Accumulated Depreciation (BS)
        journalLines.push({
          accountId: bsAcct.id,
          debit: "0",
          credit: amt,
          currency: functionalCurrency,
          fxRate: "1",
          debitFunctional: "0",
          creditFunctional: amt,
          description: `Accumulated depreciation: ${line.assetCode}`,
          lineNumber: lineNum++
        });
      }

      if (journalLines.length === 0) {
        return result;
      }

      // Create and post journal + update asset values in a transaction
      const journal = await this.prisma.$transaction(async (tx: any) => {
        // Authoritative idempotency recheck inside the transaction
        const completedInTx = await tx.journal.findFirst({
          where: {
            entityId,
            periodId,
            source: "DEPRC",
            reference: journalReference,
            status: "POSTED"
          }
        });
        if (completedInTx) {
          throw new FixedAssetServiceError(
            "DEPRECIATION_ALREADY_RUN",
            `Depreciation has already been posted for this period (journal ${completedInTx.id}).`,
            409
          );
        }

        const created = await tx.journal.create({
          data: {
            entityId,
            periodId,
            reference: journalReference,
            description: `Fixed asset depreciation for ${period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`}`,
            source: "DEPRC",
            functionalCurrency,
            status: "POSTED",
            createdById: executedBy,
            approvedById: executedBy,
            postedAt: new Date(),
            lines: { create: journalLines }
          },
          include: { lines: true }
        });

        // Update account balances through the canonical signed writer.
        //
        // This previously computed `debit - credit` unsigned and incremented
        // the closing balance by it. Accumulated depreciation is a credit-normal
        // contra-asset, so every depreciation run drove its balance negative
        // instead of building it up, and the trial balance drifted by twice the
        // depreciation charge.
        await applyBalanceDeltas(
          tx,
          entityId,
          periodId,
          created.lines.map(
            (jl: { accountId: string; debitFunctional: unknown; creditFunctional: unknown }) => ({
              accountId: jl.accountId,
              debitFunctional: D(jl.debitFunctional),
              creditFunctional: D(jl.creditFunctional)
            })
          )
        );

        // Update each asset's accumulatedDepreciation and netValue
        for (const line of result.lines) {
          const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId } });
          if (!asset) continue;

          const newAccumulated = D(asset.accumulatedDepreciation).add(line.depreciationAmount);
          const newNet = D(asset.grossValue).sub(newAccumulated);
          const threshold = D(asset.finalValue).add(new Prisma.Decimal("0.0001"));
          const isFullyDepreciated = newNet.lte(threshold);

          await tx.fixedAsset.update({
            where: { id: line.assetId },
            data: {
              accumulatedDepreciation: newAccumulated,
              netValue: Prisma.Decimal.max(newNet, ZERO),
              status: isFullyDepreciated ? "FULLY_DEPRECIATED" : "ACTIVE"
            }
          });
        }

        // Update PeriodCloseStatus.depreciationRun flag
        const pcs = await tx.periodCloseStatus.findFirst({
          where: { entityId, periodId, ledger: "A" }
        });
        if (pcs) {
          await tx.periodCloseStatus.update({
            where: { id: pcs.id },
            data: { depreciationRun: true }
          });
        }

        return created;
      });

      result.journalId = journal.id;

      await publishEvent("depreciation.run", {
        entityId,
        periodId,
        journalId: journal.id,
        totalDepreciation: result.totalDepreciation.toFixed(FOUR_DP),
        assetCount: result.assetCount,
        executedBy
      }).catch(() => {});

      // Synchronous audit trail
      const auditService = new AuditService(this.prisma);
      await auditService.createEvent({
        entityId,
        userId: executedBy,
        eventType: "DEPRECIATION_EXECUTED",
        resourceType: "DEPRECIATION",
        resourceId: journal.id,
        afterState: {
          journalId: journal.id,
          periodId,
          totalDepreciation: result.totalDepreciation.toFixed(FOUR_DP),
          assetCount: result.assetCount
        }
      });

      return result;
    } finally {
      await this.lockService.releaseLock({ entityId, processType: "DEPRECIATION" }).catch(() => {});
    }
  }

  // ── Lifecycle Operations ─────────────────────────────────────────────────

  /**
   * Dispose an asset: calculate gain/loss, post disposal journal, set DISPOSED.
   */
  async disposeAsset(
    entityId: string,
    assetId: string,
    userId: string,
    input: {
      disposalDate: string;
      disposalProceeds: number;
      proceedsAccountCode: string;
      periodId: string;
    }
  ) {
    const asset = await this.getAsset(entityId, assetId);

    if (asset.status === "DISPOSED") {
      throw new FixedAssetServiceError("ASSET_ALREADY_DISPOSED", "Asset is already disposed.", 409);
    }

    const netValue = D(asset.netValue);
    const proceeds = D(input.disposalProceeds);
    const gainLoss = proceeds.sub(netValue); // positive = gain, negative = loss

    const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
      where: { entityId, ledger: "A" }
    });
    const functionalCurrency = ledgerSetup?.baseCurrency ?? "USD";

    // Resolve accounts
    const proceedsAcct = await this._resolveAccount(entityId, input.proceedsAccountCode);
    const bsAcct = await this._resolveAccount(entityId, asset.bsDepreciationAccount);

    const journalLines: any[] = [];
    let lineNum = 1;

    // DR Proceeds account (Bank/AR)
    if (proceedsAcct && proceeds.gt(ZERO)) {
      const amt = proceeds.toFixed(FOUR_DP);
      journalLines.push({
        accountId: proceedsAcct.id,
        debit: amt,
        credit: "0",
        currency: functionalCurrency,
        fxRate: "1",
        debitFunctional: amt,
        creditFunctional: "0",
        description: `Disposal proceeds: ${asset.assetCode}`,
        lineNumber: lineNum++
      });
    }

    // DR Accumulated Depreciation (reverse the accumulated balance)
    if (bsAcct) {
      const accumDepr = D(asset.accumulatedDepreciation);
      if (accumDepr.gt(ZERO)) {
        const amt = accumDepr.toFixed(FOUR_DP);
        journalLines.push({
          accountId: bsAcct.id,
          debit: amt,
          credit: "0",
          currency: functionalCurrency,
          fxRate: "1",
          debitFunctional: amt,
          creditFunctional: "0",
          description: `Reverse accumulated depreciation: ${asset.assetCode}`,
          lineNumber: lineNum++
        });
      }
    }

    // CR Asset cost account (P&L depreciation account serves as cost clearing here)
    const plAcct = await this._resolveAccount(entityId, asset.plDepreciationAccount);
    if (plAcct) {
      const grossAmt = D(asset.grossValue).toFixed(FOUR_DP);
      journalLines.push({
        accountId: plAcct.id,
        debit: "0",
        credit: grossAmt,
        currency: functionalCurrency,
        fxRate: "1",
        debitFunctional: "0",
        creditFunctional: grossAmt,
        description: `Disposal cost clearing: ${asset.assetCode}`,
        lineNumber: lineNum++
      });
    }

    // Gain/Loss line (if non-zero)
    if (gainLoss.abs().gt(new Prisma.Decimal("0.0001")) && plAcct) {
      const absGainLoss = gainLoss.abs().toFixed(FOUR_DP);
      journalLines.push({
        accountId: plAcct.id,
        debit: gainLoss.isNeg() ? absGainLoss : "0",
        credit: gainLoss.isPos() ? gainLoss.toFixed(FOUR_DP) : "0",
        currency: functionalCurrency,
        fxRate: "1",
        debitFunctional: gainLoss.isNeg() ? absGainLoss : "0",
        creditFunctional: gainLoss.isPos() ? gainLoss.toFixed(FOUR_DP) : "0",
        description: `Disposal ${gainLoss.gte(ZERO) ? "gain" : "loss"}: ${asset.assetCode}`,
        lineNumber: lineNum++
      });
    }

    // Post journal and update asset
    const journal = await this.prisma.$transaction(async (tx: any) => {
      const created =
        journalLines.length > 0
          ? await tx.journal.create({
              data: {
                entityId,
                periodId: input.periodId,
                reference: `DISP-${asset.assetCode}`,
                description: `Asset disposal: ${asset.assetCode} — ${asset.description}`,
                source: "DEPRC",
                functionalCurrency,
                status: "POSTED",
                createdById: userId,
                approvedById: userId,
                postedAt: new Date(),
                lines: { create: journalLines }
              },
              include: { lines: true }
            })
          : null;

      await tx.fixedAsset.update({
        where: { id: assetId },
        data: {
          status: "DISPOSED",
          disposalDate: new Date(input.disposalDate),
          netValue: ZERO,
          accumulatedDepreciation: D(asset.grossValue)
        }
      });

      return created;
    });

    return {
      asset: await this.getAsset(entityId, assetId),
      gainLoss: gainLoss.toFixed(FOUR_DP),
      journalId: journal?.id ?? null
    };
  }

  /**
   * Transfer an asset between departments/locations (updates analysis codes).
   */
  async transferAsset(
    entityId: string,
    assetId: string,
    userId: string,
    input: {
      analysisCode1?: string;
      analysisCode2?: string;
      analysisCode3?: string;
      analysisCode4?: string;
      analysisCode5?: string;
    }
  ) {
    await this.getAsset(entityId, assetId);

    const data: any = {};
    if (input.analysisCode1 !== undefined) data.analysisCode1 = input.analysisCode1;
    if (input.analysisCode2 !== undefined) data.analysisCode2 = input.analysisCode2;
    if (input.analysisCode3 !== undefined) data.analysisCode3 = input.analysisCode3;
    if (input.analysisCode4 !== undefined) data.analysisCode4 = input.analysisCode4;
    if (input.analysisCode5 !== undefined) data.analysisCode5 = input.analysisCode5;

    return (this.prisma as any).fixedAsset.update({
      where: { id: assetId },
      data,
      include: { category: true }
    });
  }

  /**
   * Revalue an asset: adjust gross value, recalculate net value.
   */
  async revalueAsset(
    entityId: string,
    assetId: string,
    userId: string,
    input: { newGrossValue: number }
  ) {
    const asset = await this.getAsset(entityId, assetId);

    if (asset.status === "DISPOSED") {
      throw new FixedAssetServiceError("ASSET_DISPOSED", "Cannot revalue a disposed asset.", 409);
    }

    const newGross = D(input.newGrossValue);
    const accumulated = D(asset.accumulatedDepreciation);
    const newNet = Prisma.Decimal.max(newGross.sub(accumulated), ZERO);
    const threshold = D(asset.finalValue).add(new Prisma.Decimal("0.0001"));

    return (this.prisma as any).fixedAsset.update({
      where: { id: assetId },
      data: {
        grossValue: newGross,
        netValue: newNet,
        status: newNet.lte(threshold) ? "FULLY_DEPRECIATED" : "ACTIVE"
      },
      include: { category: true }
    });
  }

  /**
   * Write off an asset: full impairment — zero net value.
   */
  async writeOffAsset(entityId: string, assetId: string, userId: string) {
    const asset = await this.getAsset(entityId, assetId);

    if (asset.status === "DISPOSED") {
      throw new FixedAssetServiceError("ASSET_DISPOSED", "Cannot write off a disposed asset.", 409);
    }

    return (this.prisma as any).fixedAsset.update({
      where: { id: assetId },
      data: {
        accumulatedDepreciation: D(asset.grossValue),
        netValue: ZERO,
        status: "FULLY_DEPRECIATED"
      },
      include: { category: true }
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async _resolveAccount(entityId: string, code: string) {
    return (this.prisma as any).account.findFirst({
      where: { entityId, code, isActive: true },
      select: { id: true, code: true, type: true }
    });
  }
}
