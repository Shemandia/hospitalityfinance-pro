import { Prisma, type PrismaClient } from "../../db/client.js";
import { publishEvent } from "../../shared/rabbitmq.js";
import { ProcessLockService, ProcessLockError } from "../process-lock/service.js";
import { GLRepository } from "../gl/repository.js";
import { AuditService } from "../audit/service.js";
import { ServiceError } from "../../shared/service-error.js";

const D = (v: unknown) => new Prisma.Decimal(String(v));
const ZERO = new Prisma.Decimal(0);

// ── Error ────────────────────────────────────────────────────────────────────

export class AllocationServiceError extends ServiceError {}

// ── Types ────────────────────────────────────────────────────────────────────

export type AllocationLineResult = {
  accountId: string;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
  analysisCodes?: Record<string, string>;
};

export type AllocationResult = {
  definitionId: string;
  definitionName: string;
  allocationType: string;
  sourceAmount: string;
  lines: AllocationLineResult[];
  journalId?: string;
};

type SourceRow = {
  accountId: string;
  accountCode: string;
  openingBalance: Prisma.Decimal;
  periodDebits: Prisma.Decimal;
  periodCredits: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
};

type TargetRow = {
  id: string;
  targetAccountCode: string;
  offsetAccountCode: string | null;
  basisType: string;
  fixedPercentage: Prisma.Decimal | null;
  fixedAmount: Prisma.Decimal | null;
  ratioAccountCodeFrom: string | null;
  ratioAccountCodeTo: string | null;
  statisticalKey: string | null;
  statisticalValue: Prisma.Decimal | null;
  analysisCodes: Record<string, string> | null;
  targetOrder: number;
};

// ── Service ──────────────────────────────────────────────────────────────────

export class AllocationService {
  private readonly lockService: ProcessLockService;

  constructor(private readonly prisma: PrismaClient) {
    this.lockService = new ProcessLockService(prisma);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async createDefinition(entityId: string, createdById: string, input: any) {
    const existing = await (this.prisma as any).allocationDefinition.findFirst({
      where: { entityId, name: input.name }
    });
    if (existing) {
      throw new AllocationServiceError(
        "ALLOCATION_DUPLICATE_NAME",
        `An allocation definition named "${input.name}" already exists.`,
        409
      );
    }

    return (this.prisma as any).allocationDefinition.create({
      data: {
        entityId,
        name: input.name,
        description: input.description ?? null,
        allocationType: input.allocationType,
        periodId: input.periodId ?? null,
        isSteppedSequence: input.isSteppedSequence ?? false,
        sequenceOrder: input.sequenceOrder ?? 0,
        isActive: input.isActive ?? true,
        createdById,
        sources: {
          create: (input.sources ?? []).map((s: any, i: number) => ({
            accountCodeFrom: s.accountCodeFrom,
            accountCodeTo: s.accountCodeTo ?? s.accountCodeFrom,
            analysisCode1: s.analysisCode1 ?? null,
            analysisCode2: s.analysisCode2 ?? null,
            analysisCode3: s.analysisCode3 ?? null,
            balanceType: s.balanceType ?? "MOVEMENTS",
            minimumThreshold: s.minimumThreshold ?? null,
            maximumThreshold: s.maximumThreshold ?? null,
            sourceOrder: s.sourceOrder ?? i
          }))
        },
        targets: {
          create: (input.targets ?? []).map((t: any, i: number) => ({
            targetAccountCode: t.targetAccountCode,
            offsetAccountCode: t.offsetAccountCode ?? null,
            basisType: t.basisType,
            fixedPercentage: t.fixedPercentage ?? null,
            fixedAmount: t.fixedAmount ?? null,
            ratioAccountCodeFrom: t.ratioAccountCodeFrom ?? null,
            ratioAccountCodeTo: t.ratioAccountCodeTo ?? null,
            statisticalKey: t.statisticalKey ?? null,
            statisticalValue: t.statisticalValue ?? null,
            analysisCodes: t.analysisCodes ?? null,
            targetOrder: t.targetOrder ?? i
          }))
        }
      },
      include: { sources: true, targets: true }
    });
  }

  async getDefinition(entityId: string, id: string) {
    const def = await (this.prisma as any).allocationDefinition.findFirst({
      where: { entityId, id },
      include: {
        sources: { orderBy: { sourceOrder: "asc" } },
        targets: { orderBy: { targetOrder: "asc" } }
      }
    });
    if (!def) {
      throw new AllocationServiceError(
        "ALLOCATION_NOT_FOUND",
        "Allocation definition not found.",
        404
      );
    }
    return def;
  }

  async listDefinitions(
    entityId: string,
    query: { isActive?: boolean; isSteppedSequence?: boolean }
  ) {
    return (this.prisma as any).allocationDefinition.findMany({
      where: {
        entityId,
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.isSteppedSequence !== undefined
          ? { isSteppedSequence: query.isSteppedSequence }
          : {})
      },
      include: {
        sources: { orderBy: { sourceOrder: "asc" } },
        targets: { orderBy: { targetOrder: "asc" } }
      },
      orderBy: [{ sequenceOrder: "asc" }, { name: "asc" }]
    });
  }

  async updateDefinition(entityId: string, id: string, input: any) {
    const existing = await this.getDefinition(entityId, id);
    if (existing.isSystem) {
      throw new AllocationServiceError(
        "ALLOCATION_SYSTEM_READONLY",
        "System allocation definitions cannot be modified.",
        403
      );
    }

    // If sources or targets provided, replace them (delete + recreate)
    return this.prisma.$transaction(async (tx: any) => {
      if (input.sources) {
        await tx.allocationSource.deleteMany({ where: { definitionId: id } });
        for (let i = 0; i < input.sources.length; i++) {
          const s = input.sources[i];
          await tx.allocationSource.create({
            data: {
              definitionId: id,
              accountCodeFrom: s.accountCodeFrom,
              accountCodeTo: s.accountCodeTo ?? s.accountCodeFrom,
              analysisCode1: s.analysisCode1 ?? null,
              analysisCode2: s.analysisCode2 ?? null,
              analysisCode3: s.analysisCode3 ?? null,
              balanceType: s.balanceType ?? "MOVEMENTS",
              minimumThreshold: s.minimumThreshold ?? null,
              maximumThreshold: s.maximumThreshold ?? null,
              sourceOrder: s.sourceOrder ?? i
            }
          });
        }
      }

      if (input.targets) {
        await tx.allocationTarget.deleteMany({ where: { definitionId: id } });
        for (let i = 0; i < input.targets.length; i++) {
          const t = input.targets[i];
          await tx.allocationTarget.create({
            data: {
              definitionId: id,
              targetAccountCode: t.targetAccountCode,
              offsetAccountCode: t.offsetAccountCode ?? null,
              basisType: t.basisType,
              fixedPercentage: t.fixedPercentage ?? null,
              fixedAmount: t.fixedAmount ?? null,
              ratioAccountCodeFrom: t.ratioAccountCodeFrom ?? null,
              ratioAccountCodeTo: t.ratioAccountCodeTo ?? null,
              statisticalKey: t.statisticalKey ?? null,
              statisticalValue: t.statisticalValue ?? null,
              analysisCodes: t.analysisCodes ?? null,
              targetOrder: t.targetOrder ?? i
            }
          });
        }
      }

      return tx.allocationDefinition.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.allocationType !== undefined ? { allocationType: input.allocationType } : {}),
          ...(input.periodId !== undefined ? { periodId: input.periodId } : {}),
          ...(input.isSteppedSequence !== undefined
            ? { isSteppedSequence: input.isSteppedSequence }
            : {}),
          ...(input.sequenceOrder !== undefined ? { sequenceOrder: input.sequenceOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
        },
        include: { sources: true, targets: true }
      });
    });
  }

  async deleteDefinition(entityId: string, id: string) {
    const existing = await this.getDefinition(entityId, id);
    if (existing.isSystem) {
      throw new AllocationServiceError(
        "ALLOCATION_SYSTEM_READONLY",
        "System allocation definitions cannot be deleted.",
        403
      );
    }
    await (this.prisma as any).allocationDefinition.delete({ where: { id } });
  }

  // ── Calculation (dry-run) ────────────────────────────────────────────────

  /**
   * Calculate allocation amounts without posting.
   * Returns the journal lines that would be created.
   */
  async calculateAllocation(
    entityId: string,
    definitionId: string,
    periodId?: string
  ): Promise<AllocationResult> {
    const definition = await this.getDefinition(entityId, definitionId);

    const effectivePeriodId = periodId ?? definition.periodId;
    if (!effectivePeriodId) {
      // Use current period from LedgerSetup
      const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
        where: { entityId, ledger: "A" }
      });
      if (!ledgerSetup?.currentPeriodId) {
        throw new AllocationServiceError(
          "ALLOCATION_NO_PERIOD",
          "No period specified and no current period configured.",
          400
        );
      }
      return this._calculate(entityId, definition, ledgerSetup.currentPeriodId);
    }

    return this._calculate(entityId, definition, effectivePeriodId);
  }

  private async _calculate(
    entityId: string,
    definition: any,
    periodId: string
  ): Promise<AllocationResult> {
    // 1. Calculate total source amount
    const sourceAmount = await this._calculateSourceAmount(entityId, definition.sources, periodId);

    if (sourceAmount.isZero()) {
      return {
        definitionId: definition.id,
        definitionName: definition.name,
        allocationType: definition.allocationType,
        sourceAmount: "0",
        lines: []
      };
    }

    // 2. Calculate target amounts
    const lines = await this._calculateTargetAmounts(entityId, definition, periodId, sourceAmount);

    return {
      definitionId: definition.id,
      definitionName: definition.name,
      allocationType: definition.allocationType,
      sourceAmount: sourceAmount.toFixed(4),
      lines
    };
  }

  /**
   * Sum up source amounts from AccountPeriodBalance matching source account ranges.
   */
  private async _calculateSourceAmount(
    entityId: string,
    sources: any[],
    periodId: string
  ): Promise<Prisma.Decimal> {
    let total = ZERO;

    for (const source of sources) {
      const rows = await this._getSourceBalances(entityId, source, periodId);

      let sourceSum = ZERO;
      for (const row of rows) {
        sourceSum = sourceSum.add(this._extractBalance(row, source.balanceType ?? "MOVEMENTS"));
      }

      // Apply thresholds
      const minThreshold = source.minimumThreshold ? D(source.minimumThreshold) : null;
      const maxThreshold = source.maximumThreshold ? D(source.maximumThreshold) : null;

      if (minThreshold !== null && sourceSum.abs().lt(minThreshold)) {
        continue; // Skip this source — below minimum threshold
      }
      if (maxThreshold !== null && sourceSum.abs().gt(maxThreshold)) {
        sourceSum = sourceSum.gt(ZERO) ? maxThreshold : maxThreshold.neg();
      }

      total = total.add(sourceSum);
    }

    return total;
  }

  /**
   * Query AccountPeriodBalance for accounts in the source's code range,
   * optionally filtered by analysis codes on journal lines.
   */
  private async _getSourceBalances(
    entityId: string,
    source: any,
    periodId: string
  ): Promise<SourceRow[]> {
    // Find accounts in the code range
    const accounts = await (this.prisma as any).account.findMany({
      where: {
        entityId,
        code: {
          gte: source.accountCodeFrom,
          lte: source.accountCodeTo
        },
        isActive: true
      },
      select: { id: true, code: true }
    });

    if (accounts.length === 0) return [];

    const accountIds = accounts.map((a: any) => a.id);
    const accountCodeMap = new Map(accounts.map((a: any) => [a.id, a.code]));

    // Get balances for these accounts in the period
    const balances = await (this.prisma as any).accountPeriodBalance.findMany({
      where: {
        entityId,
        periodId,
        accountId: { in: accountIds }
      }
    });

    return balances.map((b: any) => ({
      accountId: b.accountId,
      accountCode: accountCodeMap.get(b.accountId) ?? "",
      openingBalance: D(b.openingBalance),
      periodDebits: D(b.periodDebits),
      periodCredits: D(b.periodCredits),
      closingBalance: D(b.closingBalance)
    }));
  }

  private _extractBalance(row: SourceRow, balanceType: string): Prisma.Decimal {
    switch (balanceType) {
      case "OPENING":
        return row.openingBalance;
      case "CLOSING":
        return row.closingBalance;
      case "MOVEMENTS":
      default:
        return row.periodDebits.sub(row.periodCredits);
    }
  }

  /**
   * Distribute the source amount across targets based on their basis type.
   * Returns journal lines for the allocation.
   */
  private async _calculateTargetAmounts(
    entityId: string,
    definition: any,
    periodId: string,
    sourceAmount: Prisma.Decimal
  ): Promise<AllocationLineResult[]> {
    const targets: TargetRow[] = definition.targets.map((t: any) => ({
      ...t,
      fixedPercentage: t.fixedPercentage ? D(t.fixedPercentage) : null,
      fixedAmount: t.fixedAmount ? D(t.fixedAmount) : null,
      statisticalValue: t.statisticalValue ? D(t.statisticalValue) : null
    }));

    // Calculate ratios for ACCOUNT_BALANCE and STATISTICAL_KEY targets
    const ratios = await this._resolveTargetRatios(entityId, periodId, targets, sourceAmount);

    const lines: AllocationLineResult[] = [];
    const isSplit = definition.allocationType === "SPLIT";
    let allocatedTotal = ZERO;

    // First pass: round each target amount to 4dp and track the total
    const roundedAmounts: Prisma.Decimal[] = [];
    for (let i = 0; i < targets.length; i++) {
      const amount = ratios[i].toDecimalPlaces(4);
      roundedAmounts.push(amount);
      allocatedTotal = allocatedTotal.add(amount);
    }

    // Remainder adjustment: apply penny difference to the last non-zero target
    const hasFixedAmount = targets.some((t) => t.basisType === "FIXED_AMOUNT");
    if (!hasFixedAmount) {
      const remainder = sourceAmount.sub(allocatedTotal).toDecimalPlaces(4);
      if (!remainder.isZero()) {
        for (let i = roundedAmounts.length - 1; i >= 0; i--) {
          if (!roundedAmounts[i].isZero()) {
            roundedAmounts[i] = roundedAmounts[i].add(remainder).toDecimalPlaces(4);
            break;
          }
        }
      }
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const amount = roundedAmounts[i];

      if (amount.isZero()) continue;

      const targetAccount = await this._resolveAccount(entityId, target.targetAccountCode);
      if (!targetAccount) continue;

      const isPositive = amount.gt(ZERO);
      const absAmount = amount.abs().toFixed(4);

      // Target line: debit if positive, credit if negative
      lines.push({
        accountId: targetAccount.id,
        accountCode: target.targetAccountCode,
        debit: isPositive ? absAmount : "0",
        credit: !isPositive ? absAmount : "0",
        description: `Allocation: ${definition.name}`,
        analysisCodes: target.analysisCodes ?? undefined
      });

      // Offset line (contra entry)
      if (isSplit) {
        const sourceAccount = definition.sources[0];
        const sourceAcct = await this._resolveAccount(entityId, sourceAccount.accountCodeFrom);
        if (sourceAcct) {
          lines.push({
            accountId: sourceAcct.id,
            accountCode: sourceAccount.accountCodeFrom,
            debit: !isPositive ? absAmount : "0",
            credit: isPositive ? absAmount : "0",
            description: `Allocation reversal: ${definition.name}`
          });
        }
      } else {
        if (target.offsetAccountCode) {
          const offsetAccount = await this._resolveAccount(entityId, target.offsetAccountCode);
          if (offsetAccount) {
            lines.push({
              accountId: offsetAccount.id,
              accountCode: target.offsetAccountCode,
              debit: !isPositive ? absAmount : "0",
              credit: isPositive ? absAmount : "0",
              description: `Allocation offset: ${definition.name}`
            });
          }
        }
      }
    }

    return lines;
  }

  /**
   * Resolve allocation amounts per target based on their basis type.
   * Returns an array of amounts (one per target, same order).
   */
  private async _resolveTargetRatios(
    entityId: string,
    periodId: string,
    targets: TargetRow[],
    sourceAmount: Prisma.Decimal
  ): Promise<Prisma.Decimal[]> {
    const amounts: Prisma.Decimal[] = new Array(targets.length).fill(ZERO);

    // Pass 1: resolve ACCOUNT_BALANCE ratios
    const balanceTargets = targets.filter((t) => t.basisType === "ACCOUNT_BALANCE");
    const balanceRatioTotals: Prisma.Decimal[] = [];

    for (const target of balanceTargets) {
      if (!target.ratioAccountCodeFrom || !target.ratioAccountCodeTo) {
        balanceRatioTotals.push(ZERO);
        continue;
      }
      const balances = await this._getSourceBalances(
        entityId,
        {
          accountCodeFrom: target.ratioAccountCodeFrom,
          accountCodeTo: target.ratioAccountCodeTo
        },
        periodId
      );
      let sum = ZERO;
      for (const b of balances) {
        sum = sum.add(this._extractBalance(b, "CLOSING"));
      }
      balanceRatioTotals.push(sum.abs());
    }

    const totalBalanceRatio = balanceRatioTotals.reduce((a, b) => a.add(b), ZERO);

    // Pass 2: resolve STATISTICAL_KEY ratios
    const statTargets = targets.filter((t) => t.basisType === "STATISTICAL_KEY");
    const totalStatValue = statTargets.reduce(
      (sum, t) => sum.add(t.statisticalValue ?? ZERO),
      ZERO
    );

    // Pass 3: assign amounts
    const HUNDRED = new Prisma.Decimal(100);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      switch (target.basisType) {
        case "FIXED_PERCENTAGE":
          amounts[i] = sourceAmount.mul(target.fixedPercentage ?? ZERO).div(HUNDRED);
          break;

        case "FIXED_AMOUNT":
          amounts[i] = target.fixedAmount ?? ZERO;
          break;

        case "ACCOUNT_BALANCE": {
          const idx = balanceTargets.indexOf(target);
          if (idx >= 0 && totalBalanceRatio.gt(ZERO)) {
            amounts[i] = sourceAmount.mul(balanceRatioTotals[idx]).div(totalBalanceRatio);
          }
          break;
        }

        case "STATISTICAL_KEY":
          if (totalStatValue.gt(ZERO)) {
            amounts[i] = sourceAmount.mul(target.statisticalValue ?? ZERO).div(totalStatValue);
          }
          break;
      }
    }

    return amounts;
  }

  private async _resolveAccount(entityId: string, code: string) {
    return (this.prisma as any).account.findFirst({
      where: { entityId, code, isActive: true },
      select: { id: true, code: true, type: true }
    });
  }

  // ── Execution (real posting) ─────────────────────────────────────────────

  /**
   * Execute an allocation: calculate, create journal, post it, update allocationsRun flag.
   * Acquires ALLOCATION process lock.
   */
  async executeAllocation(
    entityId: string,
    definitionId: string,
    executedBy: string,
    periodId?: string
  ): Promise<AllocationResult> {
    // Acquire lock
    try {
      await this.lockService.acquireLock({
        entityId,
        processType: "ALLOCATION",
        userId: executedBy,
        timeoutMinutes: 15
      });
    } catch (error) {
      if (error instanceof ProcessLockError && error.code === "LOCK_HELD") {
        throw new AllocationServiceError(
          "ALLOCATION_LOCKED",
          "Another allocation is already running for this entity.",
          409
        );
      }
      throw error;
    }

    try {
      // Calculate
      const result = await this.calculateAllocation(entityId, definitionId, periodId);

      if (result.lines.length === 0) {
        return result;
      }

      // Resolve effective period
      const definition = await this.getDefinition(entityId, definitionId);
      const effectivePeriodId =
        periodId ?? definition.periodId ?? (await this._getCurrentPeriodId(entityId));

      // Validate period is in OPEN or SOFT_CLOSE state
      const period = await (this.prisma as any).period.findFirst({
        where: { id: effectivePeriodId, entityId }
      });
      if (!period) {
        throw new AllocationServiceError("ALLOCATION_PERIOD_NOT_FOUND", "Period not found.", 404);
      }
      if (period.status !== "OPEN" && period.status !== "SOFT_CLOSE") {
        throw new AllocationServiceError(
          "ALLOCATION_PERIOD_NOT_OPEN",
          "Allocations can only run on OPEN or SOFT_CLOSE periods.",
          409
        );
      }

      // Get functional currency
      const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
        where: { entityId, ledger: "A" }
      });
      const functionalCurrency = ledgerSetup?.baseCurrency ?? "USD";

      // Create and post the journal in a transaction
      const journal = await this.prisma.$transaction(async (tx: any) => {
        const created = await tx.journal.create({
          data: {
            entityId,
            periodId: effectivePeriodId,
            reference: `ALLOC-${definition.name.substring(0, 20).replace(/\s+/g, "-")}`,
            description: `Corporate allocation: ${definition.name}`,
            source: "ALLOC",
            functionalCurrency,
            status: "POSTED",
            createdById: executedBy,
            approvedById: executedBy,
            postedAt: new Date(),
            lines: {
              create: result.lines.map((line, index) => ({
                accountId: line.accountId,
                debit: line.debit,
                credit: line.credit,
                currency: functionalCurrency,
                fxRate: "1",
                debitFunctional: line.debit,
                creditFunctional: line.credit,
                description: line.description,
                dimension1: line.analysisCodes?.dimension1 ?? null,
                dimension2: line.analysisCodes?.dimension2 ?? null,
                dimension3: line.analysisCodes?.dimension3 ?? null,
                lineNumber: index + 1
              }))
            }
          },
          include: {
            lines: {
              include: { account: { select: { type: true } } }
            }
          }
        });

        // Update account balances using the canonical GL method (SQL-level Decimal arithmetic)
        const repo = new GLRepository(tx);
        for (const line of created.lines) {
          await repo.updateAccountBalance(
            entityId,
            line.accountId,
            effectivePeriodId,
            D(line.debitFunctional),
            D(line.creditFunctional),
            line.account.type
          );
        }

        // Update PeriodCloseStatus.allocationsRun flag
        const pcs = await tx.periodCloseStatus.findFirst({
          where: { entityId, periodId: effectivePeriodId, ledger: "A" }
        });
        if (pcs) {
          await tx.periodCloseStatus.update({
            where: { id: pcs.id },
            data: { allocationsRun: true }
          });
        }

        return created;
      });

      result.journalId = journal.id;

      // Post-transaction events
      await publishEvent("allocation.executed", {
        entityId,
        definitionId,
        journalId: journal.id,
        periodId: effectivePeriodId,
        executedBy
      }).catch(() => {});

      // Synchronous audit trail
      const auditService = new AuditService(this.prisma);
      await auditService.createEvent({
        entityId,
        userId: executedBy,
        eventType: "ALLOCATION_EXECUTED",
        resourceType: "ALLOCATION",
        resourceId: definitionId,
        afterState: {
          journalId: journal.id,
          periodId: effectivePeriodId,
          lineCount: result.lines.length
        }
      });

      return result;
    } finally {
      await this.lockService.releaseLock({ entityId, processType: "ALLOCATION" }).catch(() => {});
    }
  }

  // ── Stepped allocations ──────────────────────────────────────────────────

  /**
   * Run all stepped allocations for an entity in sequence order.
   * Each allocation's output feeds into the next (via updated balances).
   */
  async runSteppedAllocations(
    entityId: string,
    executedBy: string,
    periodId?: string
  ): Promise<AllocationResult[]> {
    const definitions = await (this.prisma as any).allocationDefinition.findMany({
      where: {
        entityId,
        isSteppedSequence: true,
        isActive: true
      },
      orderBy: { sequenceOrder: "asc" },
      select: { id: true }
    });

    if (definitions.length === 0) {
      throw new AllocationServiceError(
        "ALLOCATION_NO_STEPPED",
        "No active stepped allocation definitions found.",
        404
      );
    }

    const results: AllocationResult[] = [];

    for (const def of definitions) {
      const result = await this.executeAllocation(entityId, def.id, executedBy, periodId);
      results.push(result);
    }

    return results;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async _getCurrentPeriodId(entityId: string): Promise<string> {
    const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
      where: { entityId, ledger: "A" }
    });
    if (!ledgerSetup?.currentPeriodId) {
      throw new AllocationServiceError(
        "ALLOCATION_NO_PERIOD",
        "No current period configured for this entity.",
        400
      );
    }
    return ledgerSetup.currentPeriodId;
  }
}
