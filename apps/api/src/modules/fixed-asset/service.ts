import type { PrismaClient } from "../../db/client.js";
import { publishEvent } from "../../shared/rabbitmq.js";
import { ProcessLockService, ProcessLockError } from "../process-lock/service.js";

// ── Error ────────────────────────────────────────────────────────────────────

export class FixedAssetServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type DepreciationLineResult = {
  assetId: string;
  assetCode: string;
  description: string;
  depreciationAmount: number;
  bsAccount: string;
  plAccount: string;
};

export type DepreciationRunResult = {
  periodId: string;
  totalDepreciation: number;
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

    const grossValue = Number(input.grossValue ?? 0);
    const finalValue = Number(input.finalValue ?? 0);

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
        accumulatedDepreciation: 0,
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
      if (amount <= 0) continue;

      lines.push({
        assetId: asset.id,
        assetCode: asset.assetCode,
        description: asset.description,
        depreciationAmount: Math.round(amount * 10000) / 10000,
        bsAccount: asset.bsDepreciationAccount,
        plAccount: asset.plDepreciationAccount
      });
    }

    const totalDepreciation = lines.reduce((sum, l) => sum + l.depreciationAmount, 0);

    return {
      periodId,
      totalDepreciation: Math.round(totalDepreciation * 10000) / 10000,
      assetCount: lines.length,
      lines
    };
  }

  /**
   * Calculate monthly depreciation for a single asset.
   */
  private _calculateAssetDepreciation(
    asset: any,
    excludeFinal: boolean,
    fullYearFirst: boolean
  ): number {
    if (asset.depreciationMethod === "NONE") return 0;

    const grossValue = Number(asset.grossValue);
    const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
    const netValue = Number(asset.netValue);
    const finalValue = excludeFinal ? Number(asset.finalValue) : 0;
    const usefulLifeMonths = asset.usefulLifeMonths;

    if (usefulLifeMonths <= 0) return 0;

    // Cannot depreciate below final value
    const depreciableFloor = finalValue;
    if (netValue <= depreciableFloor) return 0;

    let monthlyAmount = 0;

    switch (asset.depreciationMethod) {
      case "STRAIGHT_LINE": {
        // (grossValue - finalValue) / usefulLifeMonths
        const depreciableBase = grossValue - finalValue;
        if (depreciableBase <= 0) return 0;
        monthlyAmount = depreciableBase / usefulLifeMonths;
        break;
      }

      case "REDUCING_BALANCE": {
        // netValue * (annualRate / 100 / 12)
        const annualRate = Number(asset.depreciationRate ?? 0);
        if (annualRate <= 0) return 0;
        const monthlyRate = annualRate / 100 / 12;
        monthlyAmount = netValue * monthlyRate;
        break;
      }

      case "SUM_OF_DIGITS": {
        // Sum-of-years-digits: remaining_months / sum_of_all_months * depreciable_base
        const depreciableBase = grossValue - finalValue;
        if (depreciableBase <= 0) return 0;

        // How many months of depreciation have been charged
        const monthsCharged = this._estimateMonthsCharged(
          grossValue,
          finalValue,
          accumulatedDepreciation,
          usefulLifeMonths
        );
        const remainingMonths = Math.max(usefulLifeMonths - monthsCharged, 0);
        if (remainingMonths <= 0) return 0;

        // Sum of digits for remaining months
        const sumTotal = (usefulLifeMonths * (usefulLifeMonths + 1)) / 2;
        monthlyAmount = (remainingMonths / sumTotal) * depreciableBase;
        break;
      }

      case "USER_TABLE": {
        // Stub — will be implemented in a future sprint
        return 0;
      }

      default:
        return 0;
    }

    // Cap: don't depreciate below final value
    const maxAllowed = netValue - depreciableFloor;
    if (monthlyAmount > maxAllowed) {
      monthlyAmount = maxAllowed;
    }

    return Math.max(monthlyAmount, 0);
  }

  /**
   * Estimate how many months of depreciation have been charged,
   * based on accumulated depreciation vs the straight-line monthly amount.
   */
  private _estimateMonthsCharged(
    grossValue: number,
    finalValue: number,
    accumulatedDepreciation: number,
    usefulLifeMonths: number
  ): number {
    const depreciableBase = grossValue - finalValue;
    if (depreciableBase <= 0 || usefulLifeMonths <= 0) return 0;
    const straightLineMonthly = depreciableBase / usefulLifeMonths;
    if (straightLineMonthly <= 0) return 0;
    return Math.round(accumulatedDepreciation / straightLineMonthly);
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
        const plAcct = accountMap.get(line.plAccount);
        const bsAcct = accountMap.get(line.bsAccount);

        if (!plAcct || !bsAcct) continue;

        // DR Depreciation Expense (P&L)
        journalLines.push({
          accountId: plAcct.id,
          debit: line.depreciationAmount.toFixed(4),
          credit: "0",
          currency: functionalCurrency,
          fxRate: "1",
          debitFunctional: line.depreciationAmount.toFixed(4),
          creditFunctional: "0",
          description: `Depreciation: ${line.assetCode} — ${line.description}`,
          lineNumber: lineNum++
        });

        // CR Accumulated Depreciation (BS)
        journalLines.push({
          accountId: bsAcct.id,
          debit: "0",
          credit: line.depreciationAmount.toFixed(4),
          currency: functionalCurrency,
          fxRate: "1",
          debitFunctional: "0",
          creditFunctional: line.depreciationAmount.toFixed(4),
          description: `Accumulated depreciation: ${line.assetCode}`,
          lineNumber: lineNum++
        });
      }

      if (journalLines.length === 0) {
        return result;
      }

      // Create and post journal + update asset values in a transaction
      const journal = await this.prisma.$transaction(async (tx: any) => {
        const created = await tx.journal.create({
          data: {
            entityId,
            periodId,
            reference: `DEPRC-${period.year}-${String(period.month).padStart(2, "0")}`,
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

        // Update account balances
        for (const jl of created.lines) {
          const debit = Number(jl.debitFunctional);
          const credit = Number(jl.creditFunctional);
          const net = debit - credit;

          await tx.accountPeriodBalance.upsert({
            where: {
              entityId_accountId_periodId: {
                entityId,
                accountId: jl.accountId,
                periodId
              }
            },
            create: {
              entityId,
              accountId: jl.accountId,
              periodId,
              openingBalance: 0,
              periodDebits: debit,
              periodCredits: credit,
              closingBalance: net
            },
            update: {
              periodDebits: { increment: debit },
              periodCredits: { increment: credit },
              closingBalance: { increment: net }
            }
          });
        }

        // Update each asset's accumulatedDepreciation and netValue
        for (const line of result.lines) {
          const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId } });
          if (!asset) continue;

          const newAccumulated = Number(asset.accumulatedDepreciation) + line.depreciationAmount;
          const newNet = Number(asset.grossValue) - newAccumulated;
          const isFullyDepreciated = newNet <= Number(asset.finalValue) + 0.0001;

          await tx.fixedAsset.update({
            where: { id: line.assetId },
            data: {
              accumulatedDepreciation: newAccumulated,
              netValue: Math.max(newNet, 0),
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
        totalDepreciation: result.totalDepreciation,
        assetCount: result.assetCount,
        executedBy
      }).catch(() => {});

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

    const netValue = Number(asset.netValue);
    const proceeds = Number(input.disposalProceeds);
    const gainLoss = proceeds - netValue; // positive = gain, negative = loss

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
    if (proceedsAcct && proceeds > 0) {
      journalLines.push({
        accountId: proceedsAcct.id,
        debit: proceeds.toFixed(4),
        credit: "0",
        currency: functionalCurrency,
        fxRate: "1",
        debitFunctional: proceeds.toFixed(4),
        creditFunctional: "0",
        description: `Disposal proceeds: ${asset.assetCode}`,
        lineNumber: lineNum++
      });
    }

    // DR Accumulated Depreciation (reverse the accumulated balance)
    if (bsAcct) {
      const accumDepr = Number(asset.accumulatedDepreciation);
      if (accumDepr > 0) {
        journalLines.push({
          accountId: bsAcct.id,
          debit: accumDepr.toFixed(4),
          credit: "0",
          currency: functionalCurrency,
          fxRate: "1",
          debitFunctional: accumDepr.toFixed(4),
          creditFunctional: "0",
          description: `Reverse accumulated depreciation: ${asset.assetCode}`,
          lineNumber: lineNum++
        });
      }
    }

    // CR Asset cost account (P&L depreciation account serves as cost clearing here)
    const plAcct = await this._resolveAccount(entityId, asset.plDepreciationAccount);
    if (plAcct) {
      const grossValue = Number(asset.grossValue);
      journalLines.push({
        accountId: plAcct.id,
        debit: "0",
        credit: grossValue.toFixed(4),
        currency: functionalCurrency,
        fxRate: "1",
        debitFunctional: "0",
        creditFunctional: grossValue.toFixed(4),
        description: `Disposal cost clearing: ${asset.assetCode}`,
        lineNumber: lineNum++
      });
    }

    // Gain/Loss line (if non-zero)
    if (Math.abs(gainLoss) > 0.0001 && plAcct) {
      journalLines.push({
        accountId: plAcct.id,
        debit: gainLoss < 0 ? Math.abs(gainLoss).toFixed(4) : "0",
        credit: gainLoss > 0 ? gainLoss.toFixed(4) : "0",
        currency: functionalCurrency,
        fxRate: "1",
        debitFunctional: gainLoss < 0 ? Math.abs(gainLoss).toFixed(4) : "0",
        creditFunctional: gainLoss > 0 ? gainLoss.toFixed(4) : "0",
        description: `Disposal ${gainLoss >= 0 ? "gain" : "loss"}: ${asset.assetCode}`,
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
          netValue: 0,
          accumulatedDepreciation: Number(asset.grossValue)
        }
      });

      return created;
    });

    return {
      asset: await this.getAsset(entityId, assetId),
      gainLoss,
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

    const newGross = Number(input.newGrossValue);
    const accumulated = Number(asset.accumulatedDepreciation);
    const newNet = Math.max(newGross - accumulated, 0);

    return (this.prisma as any).fixedAsset.update({
      where: { id: assetId },
      data: {
        grossValue: newGross,
        netValue: newNet,
        status: newNet <= Number(asset.finalValue) + 0.0001 ? "FULLY_DEPRECIATED" : "ACTIVE"
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

    const grossValue = Number(asset.grossValue);

    return (this.prisma as any).fixedAsset.update({
      where: { id: assetId },
      data: {
        accumulatedDepreciation: grossValue,
        netValue: 0,
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
