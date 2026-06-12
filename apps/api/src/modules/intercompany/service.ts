import type { PrismaClient } from "../../db/client.js";
import { Prisma } from "../../db/client.js";
import type {
  CreateICEntityPairInput,
  UpdateICEntityPairInput,
  CreateICAccountMappingInput,
  UpdateICAccountMappingInput,
  CreateICTransactionInput,
  ICEntityPairSummary,
  ICAccountMappingSummary,
  ICTransactionSummary,
  ICReconciliationPairBalance,
  ICReconciliationResult,
  // Legacy types kept for backward compatibility
  CreateICAccountPairInput,
  UpdateICAccountPairInput,
  CreateICJournalInput,
  ICJournalSummary
} from "./types.js";

// ── Decimal Helpers ─────────────────────────────────────────────────────────

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v ?? 0));
const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const FOUR_DP = 4;
const EIGHT_DP = 8;

import { ServiceError } from "../../shared/service-error.js";
import { GLRepository } from "../gl/repository.js";

// ── Errors ───────────────────────────────────────────────────────────────────

export class IntercompanyServiceError extends ServiceError {}

// ── Service ──────────────────────────────────────────────────────────────────

export class IntercompanyService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Post canonical balance updates for one IC journal pair: a debit line and a
   * credit line of the same functional amount in each of the two entities.
   */
  private async updateICBalances(
    tx: any,
    sides: Array<{
      entityId: string;
      periodId: string;
      debitAcct: { id: string; type: string };
      creditAcct: { id: string; type: string };
      amount: Prisma.Decimal;
    }>
  ): Promise<void> {
    const glRepo = new GLRepository(tx);
    for (const side of sides) {
      await glRepo.batchUpdateAccountBalances(side.entityId, side.periodId, [
        {
          accountId: side.debitAcct.id,
          debitFunctional: side.amount,
          creditFunctional: ZERO,
          accountType: side.debitAcct.type
        },
        {
          accountId: side.creditAcct.id,
          debitFunctional: ZERO,
          creditFunctional: side.amount,
          accountType: side.creditAcct.type
        }
      ]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IC Entity Pair CRUD (gated by IC_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════

  async listEntityPairs(): Promise<ICEntityPairSummary[]> {
    const pairs = await this.prisma.iCEntityPair.findMany({
      where: { isActive: true },
      include: {
        entityA: { select: { id: true, name: true } },
        entityB: { select: { id: true, name: true } },
        _count: { select: { accountMappings: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    return pairs.map((p: any) => ({
      id: p.id,
      entityAId: p.entityAId,
      entityBId: p.entityBId,
      entityAName: p.entityA?.name,
      entityBName: p.entityB?.name,
      isActive: p.isActive,
      autoApproveThreshold: p.autoApproveThreshold
        ? D(p.autoApproveThreshold).toFixed(FOUR_DP)
        : null,
      description: p.description,
      mappingCount: p._count?.accountMappings ?? 0
    }));
  }

  async getEntityPair(pairId: string): Promise<ICEntityPairSummary> {
    const p = await this.prisma.iCEntityPair.findFirst({
      where: { id: pairId },
      include: {
        entityA: { select: { id: true, name: true } },
        entityB: { select: { id: true, name: true } },
        _count: { select: { accountMappings: true } }
      }
    });
    if (!p)
      throw new IntercompanyServiceError("IC_PAIR_NOT_FOUND", "IC entity pair not found.", 404);
    return {
      id: p.id,
      entityAId: p.entityAId,
      entityBId: p.entityBId,
      entityAName: p.entityA?.name,
      entityBName: p.entityB?.name,
      isActive: p.isActive,
      autoApproveThreshold: p.autoApproveThreshold
        ? D(p.autoApproveThreshold).toFixed(FOUR_DP)
        : null,
      description: p.description,
      mappingCount: p._count?.accountMappings ?? 0
    };
  }

  async createEntityPair(input: CreateICEntityPairInput): Promise<ICEntityPairSummary> {
    if (input.entityAId === input.entityBId) {
      throw new IntercompanyServiceError(
        "IC_SAME_ENTITY",
        "Cannot create an IC pair between an entity and itself.",
        422
      );
    }

    // Validate both entities exist
    const [entityA, entityB] = await Promise.all([
      this.prisma.entity.findFirst({ where: { id: input.entityAId, isActive: true } }),
      this.prisma.entity.findFirst({ where: { id: input.entityBId, isActive: true } })
    ]);
    if (!entityA)
      throw new IntercompanyServiceError("IC_ENTITY_A_NOT_FOUND", "Entity A not found.", 404);
    if (!entityB)
      throw new IntercompanyServiceError("IC_ENTITY_B_NOT_FOUND", "Entity B not found.", 404);

    // Check uniqueness (either direction)
    const existing = await this.prisma.iCEntityPair.findFirst({
      where: {
        OR: [
          { entityAId: input.entityAId, entityBId: input.entityBId },
          { entityAId: input.entityBId, entityBId: input.entityAId }
        ]
      }
    });
    if (existing) {
      throw new IntercompanyServiceError(
        "IC_PAIR_EXISTS",
        "An IC pair already exists between these entities.",
        409
      );
    }

    const pair = await this.prisma.iCEntityPair.create({
      data: {
        entityAId: input.entityAId,
        entityBId: input.entityBId,
        description: input.description ?? null,
        autoApproveThreshold:
          input.autoApproveThreshold != null ? D(input.autoApproveThreshold).toFixed(FOUR_DP) : null
      },
      include: {
        entityA: { select: { id: true, name: true } },
        entityB: { select: { id: true, name: true } },
        _count: { select: { accountMappings: true } }
      }
    });

    return {
      id: pair.id,
      entityAId: pair.entityAId,
      entityBId: pair.entityBId,
      entityAName: pair.entityA?.name,
      entityBName: pair.entityB?.name,
      isActive: pair.isActive,
      autoApproveThreshold: pair.autoApproveThreshold
        ? D(pair.autoApproveThreshold).toFixed(FOUR_DP)
        : null,
      description: pair.description,
      mappingCount: 0
    };
  }

  async updateEntityPair(
    pairId: string,
    input: UpdateICEntityPairInput
  ): Promise<ICEntityPairSummary> {
    await this.getEntityPair(pairId);
    const data: Record<string, unknown> = {};
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.autoApproveThreshold !== undefined) {
      data.autoApproveThreshold =
        input.autoApproveThreshold != null ? D(input.autoApproveThreshold).toFixed(FOUR_DP) : null;
    }

    await this.prisma.iCEntityPair.update({ where: { id: pairId }, data });
    return this.getEntityPair(pairId);
  }

  async deleteEntityPair(pairId: string): Promise<void> {
    await this.getEntityPair(pairId);
    await this.prisma.iCEntityPair.update({
      where: { id: pairId },
      data: { isActive: false }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IC Account Mapping CRUD (gated by IC_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════

  async listAccountMappings(pairId: string): Promise<ICAccountMappingSummary[]> {
    const mappings = await this.prisma.iCAccountMapping.findMany({
      where: { pairId, isActive: true },
      orderBy: { createdAt: "asc" }
    });
    return mappings.map((m: any) => this.toMappingSummary(m));
  }

  async createAccountMapping(input: CreateICAccountMappingInput): Promise<ICAccountMappingSummary> {
    // Validate pair exists
    const pair = await this.prisma.iCEntityPair.findFirst({
      where: { id: input.pairId, isActive: true }
    });
    if (!pair)
      throw new IntercompanyServiceError("IC_PAIR_NOT_FOUND", "IC entity pair not found.", 404);

    // Validate all 4 accounts exist in their respective entities
    await this.validateAccountCode(pair.entityAId, input.entityADebitCode, "Entity A debit");
    await this.validateAccountCode(pair.entityAId, input.entityACreditCode, "Entity A credit");
    await this.validateAccountCode(pair.entityBId, input.entityBDebitCode, "Entity B debit");
    await this.validateAccountCode(pair.entityBId, input.entityBCreditCode, "Entity B credit");

    const mapping = await this.prisma.iCAccountMapping.create({
      data: {
        pairId: input.pairId,
        name: input.name,
        entityADebitCode: input.entityADebitCode,
        entityACreditCode: input.entityACreditCode,
        entityBDebitCode: input.entityBDebitCode,
        entityBCreditCode: input.entityBCreditCode
      }
    });

    return this.toMappingSummary(mapping);
  }

  async updateAccountMapping(
    mappingId: string,
    input: UpdateICAccountMappingInput
  ): Promise<ICAccountMappingSummary> {
    const existing = await this.prisma.iCAccountMapping.findFirst({
      where: { id: mappingId },
      include: { pair: true }
    });
    if (!existing)
      throw new IntercompanyServiceError(
        "IC_MAPPING_NOT_FOUND",
        "IC account mapping not found.",
        404
      );

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.entityADebitCode !== undefined) {
      await this.validateAccountCode(
        existing.pair.entityAId,
        input.entityADebitCode,
        "Entity A debit"
      );
      data.entityADebitCode = input.entityADebitCode;
    }
    if (input.entityACreditCode !== undefined) {
      await this.validateAccountCode(
        existing.pair.entityAId,
        input.entityACreditCode,
        "Entity A credit"
      );
      data.entityACreditCode = input.entityACreditCode;
    }
    if (input.entityBDebitCode !== undefined) {
      await this.validateAccountCode(
        existing.pair.entityBId,
        input.entityBDebitCode,
        "Entity B debit"
      );
      data.entityBDebitCode = input.entityBDebitCode;
    }
    if (input.entityBCreditCode !== undefined) {
      await this.validateAccountCode(
        existing.pair.entityBId,
        input.entityBCreditCode,
        "Entity B credit"
      );
      data.entityBCreditCode = input.entityBCreditCode;
    }

    const updated = await this.prisma.iCAccountMapping.update({
      where: { id: mappingId },
      data
    });
    return this.toMappingSummary(updated);
  }

  async deleteAccountMapping(mappingId: string): Promise<void> {
    const existing = await this.prisma.iCAccountMapping.findFirst({ where: { id: mappingId } });
    if (!existing)
      throw new IntercompanyServiceError(
        "IC_MAPPING_NOT_FOUND",
        "IC account mapping not found.",
        404
      );
    await this.prisma.iCAccountMapping.update({
      where: { id: mappingId },
      data: { isActive: false }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IC Transaction Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async listTransactions(filters?: {
    pairId?: string;
    entityId?: string;
    status?: string;
  }): Promise<ICTransactionSummary[]> {
    const where: any = {};
    if (filters?.pairId) where.pairId = filters.pairId;
    if (filters?.status) where.status = filters.status;
    if (filters?.entityId) {
      where.OR = [
        { initiatingEntityId: filters.entityId },
        { counterpartyEntityId: filters.entityId }
      ];
    }

    const txns = await this.prisma.iCTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });
    return txns.map((t: any) => this.toTransactionSummary(t));
  }

  async getTransaction(txnId: string): Promise<ICTransactionSummary> {
    const txn = await this.prisma.iCTransaction.findFirst({ where: { id: txnId } });
    if (!txn)
      throw new IntercompanyServiceError("IC_TXN_NOT_FOUND", "IC transaction not found.", 404);
    return this.toTransactionSummary(txn);
  }

  /**
   * Create an IC transaction with atomic dual-posting.
   *
   * Within a single $transaction:
   *   1. Validate pair, mapping, accounts, period
   *   2. Look up FX rates if cross-currency
   *   3. Create journal in initiating entity (DR/CR per mapping)
   *   4. Create journal in counterparty entity (DR/CR per mapping)
   *   5. Create IC transaction record linking both journals
   *   6. Both journals post or neither posts
   */
  async createTransaction(
    initiatingEntityId: string,
    actorId: string,
    input: CreateICTransactionInput
  ): Promise<ICTransactionSummary> {
    const amountD = D(input.amount);
    if (amountD.lte(ZERO)) {
      throw new IntercompanyServiceError(
        "IC_INVALID_AMOUNT",
        "Transaction amount must be positive.",
        422
      );
    }

    // Load pair and validate entities match
    const pair = await this.prisma.iCEntityPair.findFirst({
      where: { id: input.pairId, isActive: true },
      include: {
        entityA: { select: { id: true, name: true, functionalCurrency: true } },
        entityB: { select: { id: true, name: true, functionalCurrency: true } }
      }
    });
    if (!pair)
      throw new IntercompanyServiceError("IC_PAIR_NOT_FOUND", "IC entity pair not found.", 404);

    // Determine which side is initiator and which is counterparty
    const isInitiatorA = pair.entityAId === initiatingEntityId;
    const isInitiatorB = pair.entityBId === initiatingEntityId;
    if (!isInitiatorA && !isInitiatorB) {
      throw new IntercompanyServiceError(
        "IC_NOT_PARTY",
        "Initiating entity is not part of this IC pair.",
        403
      );
    }
    if (input.counterpartyEntityId !== (isInitiatorA ? pair.entityBId : pair.entityAId)) {
      throw new IntercompanyServiceError(
        "IC_COUNTERPARTY_MISMATCH",
        "Counterparty entity does not match the IC pair.",
        422
      );
    }

    const initiatorEntity = isInitiatorA ? pair.entityA : pair.entityB;
    const counterpartyEntity = isInitiatorA ? pair.entityB : pair.entityA;
    const initiatorCurrency = initiatorEntity.functionalCurrency ?? "USD";
    const counterpartyCurrency = counterpartyEntity.functionalCurrency ?? "USD";

    // Load mapping if provided
    let mapping: any = null;
    if (input.mappingId) {
      mapping = await this.prisma.iCAccountMapping.findFirst({
        where: { id: input.mappingId, pairId: input.pairId, isActive: true }
      });
      if (!mapping)
        throw new IntercompanyServiceError(
          "IC_MAPPING_NOT_FOUND",
          "IC account mapping not found.",
          404
        );
    }

    // Determine account codes based on mapping and initiator side
    let initiatorDebitCode: string;
    let initiatorCreditCode: string;
    let counterpartyDebitCode: string;
    let counterpartyCreditCode: string;

    if (mapping) {
      if (isInitiatorA) {
        initiatorDebitCode = mapping.entityADebitCode;
        initiatorCreditCode = mapping.entityACreditCode;
        counterpartyDebitCode = mapping.entityBDebitCode;
        counterpartyCreditCode = mapping.entityBCreditCode;
      } else {
        initiatorDebitCode = mapping.entityBDebitCode;
        initiatorCreditCode = mapping.entityBCreditCode;
        counterpartyDebitCode = mapping.entityADebitCode;
        counterpartyCreditCode = mapping.entityACreditCode;
      }
    } else {
      throw new IntercompanyServiceError(
        "IC_NO_MAPPING",
        "An account mapping is required. Create one in IC Configuration first.",
        422
      );
    }

    // Validate period
    const period = await this.prisma.period.findFirst({
      where: { id: input.periodId, entityId: initiatingEntityId, status: "OPEN" }
    });
    if (!period) {
      throw new IntercompanyServiceError(
        "IC_PERIOD_NOT_FOUND",
        "Open period not found in initiating entity.",
        404
      );
    }

    // Find open period in counterparty entity
    const counterpartyPeriod = await this.prisma.period.findFirst({
      where: {
        entityId: input.counterpartyEntityId,
        status: "OPEN",
        year: period.year,
        month: period.month
      }
    });
    if (!counterpartyPeriod) {
      throw new IntercompanyServiceError(
        "IC_COUNTERPARTY_NO_PERIOD",
        "No matching open period found in counterparty entity.",
        422
      );
    }

    // FX rates
    const fxRateInitiatorD = input.fxRateInitiator ? D(input.fxRateInitiator) : ONE;
    const fxRateCounterpartyD = input.fxRateCounterparty ? D(input.fxRateCounterparty) : ONE;

    // If cross-currency and no explicit FX rates, look them up
    if (initiatorCurrency !== input.currency && fxRateInitiatorD.eq(ONE)) {
      const rate = await this.lookupFXRate(input.currency, initiatorCurrency);
      if (rate) {
        // Use the looked-up rate
        return this.doCreateTransaction(
          initiatingEntityId,
          actorId,
          input,
          pair,
          mapping,
          period,
          counterpartyPeriod,
          initiatorDebitCode,
          initiatorCreditCode,
          counterpartyDebitCode,
          counterpartyCreditCode,
          initiatorCurrency,
          counterpartyCurrency,
          amountD,
          D(rate),
          fxRateCounterpartyD
        );
      }
    }
    if (counterpartyCurrency !== input.currency && fxRateCounterpartyD.eq(ONE)) {
      const rate = await this.lookupFXRate(input.currency, counterpartyCurrency);
      if (rate) {
        return this.doCreateTransaction(
          initiatingEntityId,
          actorId,
          input,
          pair,
          mapping,
          period,
          counterpartyPeriod,
          initiatorDebitCode,
          initiatorCreditCode,
          counterpartyDebitCode,
          counterpartyCreditCode,
          initiatorCurrency,
          counterpartyCurrency,
          amountD,
          fxRateInitiatorD,
          D(rate)
        );
      }
    }

    return this.doCreateTransaction(
      initiatingEntityId,
      actorId,
      input,
      pair,
      mapping,
      period,
      counterpartyPeriod,
      initiatorDebitCode,
      initiatorCreditCode,
      counterpartyDebitCode,
      counterpartyCreditCode,
      initiatorCurrency,
      counterpartyCurrency,
      amountD,
      fxRateInitiatorD,
      fxRateCounterpartyD
    );
  }

  /**
   * Inner method: atomic dual-posting inside a single $transaction.
   */
  private async doCreateTransaction(
    initiatingEntityId: string,
    actorId: string,
    input: CreateICTransactionInput,
    pair: any,
    mapping: any,
    period: any,
    counterpartyPeriod: any,
    initiatorDebitCode: string,
    initiatorCreditCode: string,
    counterpartyDebitCode: string,
    counterpartyCreditCode: string,
    initiatorCurrency: string,
    counterpartyCurrency: string,
    amountD: Prisma.Decimal,
    fxRateInitiatorD: Prisma.Decimal,
    fxRateCounterpartyD: Prisma.Decimal
  ): Promise<ICTransactionSummary> {
    const functionalAmountInitiator = amountD.mul(fxRateInitiatorD).toDecimalPlaces(FOUR_DP);
    const functionalAmountCounterparty = amountD.mul(fxRateCounterpartyD).toDecimalPlaces(FOUR_DP);

    const result = await this.prisma.$transaction(async (tx: any) => {
      // Resolve accounts in initiator entity
      const initiatorDebitAcct = await tx.account.findFirst({
        where: { entityId: initiatingEntityId, code: initiatorDebitCode, isActive: true }
      });
      const initiatorCreditAcct = await tx.account.findFirst({
        where: { entityId: initiatingEntityId, code: initiatorCreditCode, isActive: true }
      });
      if (!initiatorDebitAcct || !initiatorCreditAcct) {
        throw new IntercompanyServiceError(
          "IC_INITIATOR_ACCOUNTS_MISSING",
          `Initiator accounts not found: debit=${initiatorDebitCode}, credit=${initiatorCreditCode}`,
          422
        );
      }

      // Resolve accounts in counterparty entity
      const counterpartyDebitAcct = await tx.account.findFirst({
        where: { entityId: input.counterpartyEntityId, code: counterpartyDebitCode, isActive: true }
      });
      const counterpartyCreditAcct = await tx.account.findFirst({
        where: {
          entityId: input.counterpartyEntityId,
          code: counterpartyCreditCode,
          isActive: true
        }
      });
      if (!counterpartyDebitAcct || !counterpartyCreditAcct) {
        throw new IntercompanyServiceError(
          "IC_COUNTERPARTY_ACCOUNTS_MISSING",
          `Counterparty accounts not found: debit=${counterpartyDebitCode}, credit=${counterpartyCreditCode}`,
          422
        );
      }

      const reference = `IC-${input.reference}`;
      const description = input.description ?? `Intercompany: ${input.reference}`;

      // Journal in initiating entity: DR initiatorDebit / CR initiatorCredit
      const initiatorJournal = await tx.journal.create({
        data: {
          entityId: initiatingEntityId,
          periodId: period.id,
          reference,
          description,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: initiatorCurrency,
          createdById: actorId,
          lines: {
            create: [
              {
                accountId: initiatorDebitAcct.id,
                debit: functionalAmountInitiator.toFixed(FOUR_DP),
                credit: "0",
                currency: input.currency,
                fxRate: fxRateInitiatorD.toFixed(EIGHT_DP),
                debitFunctional: functionalAmountInitiator.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC debit: ${initiatorDebitCode}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: initiatorCreditAcct.id,
                debit: "0",
                credit: functionalAmountInitiator.toFixed(FOUR_DP),
                currency: input.currency,
                fxRate: fxRateInitiatorD.toFixed(EIGHT_DP),
                debitFunctional: "0",
                creditFunctional: functionalAmountInitiator.toFixed(FOUR_DP),
                description: `IC credit: ${initiatorCreditCode}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      // Journal in counterparty entity: DR counterpartyDebit / CR counterpartyCredit
      const counterpartyJournal = await tx.journal.create({
        data: {
          entityId: input.counterpartyEntityId,
          periodId: counterpartyPeriod.id,
          reference,
          description,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: counterpartyCurrency,
          createdById: actorId,
          lines: {
            create: [
              {
                accountId: counterpartyDebitAcct.id,
                debit: functionalAmountCounterparty.toFixed(FOUR_DP),
                credit: "0",
                currency: input.currency,
                fxRate: fxRateCounterpartyD.toFixed(EIGHT_DP),
                debitFunctional: functionalAmountCounterparty.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC debit: ${counterpartyDebitCode}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: counterpartyCreditAcct.id,
                debit: "0",
                credit: functionalAmountCounterparty.toFixed(FOUR_DP),
                currency: input.currency,
                fxRate: fxRateCounterpartyD.toFixed(EIGHT_DP),
                debitFunctional: "0",
                creditFunctional: functionalAmountCounterparty.toFixed(FOUR_DP),
                description: `IC credit: ${counterpartyCreditCode}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      // Reflect both journals in account_period_balances (NF3)
      await this.updateICBalances(tx, [
        {
          entityId: initiatingEntityId,
          periodId: period.id,
          debitAcct: initiatorDebitAcct,
          creditAcct: initiatorCreditAcct,
          amount: functionalAmountInitiator
        },
        {
          entityId: input.counterpartyEntityId,
          periodId: counterpartyPeriod.id,
          debitAcct: counterpartyDebitAcct,
          creditAcct: counterpartyCreditAcct,
          amount: functionalAmountCounterparty
        }
      ]);

      // Create IC transaction record linking both journals
      const icTxn = await tx.iCTransaction.create({
        data: {
          pairId: pair.id,
          mappingId: mapping?.id ?? null,
          initiatingEntityId,
          counterpartyEntityId: input.counterpartyEntityId,
          status: "POSTED",
          amount: amountD.toFixed(FOUR_DP),
          currency: input.currency,
          fxRateInitiator: fxRateInitiatorD.toFixed(EIGHT_DP),
          fxRateCounterparty: fxRateCounterpartyD.toFixed(EIGHT_DP),
          functionalAmountInitiator: functionalAmountInitiator.toFixed(FOUR_DP),
          functionalAmountCounterparty: functionalAmountCounterparty.toFixed(FOUR_DP),
          reference: input.reference,
          description: input.description ?? null,
          periodId: period.id,
          initiatorJournalId: initiatorJournal.id,
          counterpartyJournalId: counterpartyJournal.id,
          createdById: actorId,
          postedAt: new Date()
        }
      });

      return icTxn;
    });

    return this.toTransactionSummary(result);
  }

  /**
   * Approve an IC transaction that is in PENDING_APPROVAL status.
   * Cannot approve your own transaction.
   */
  async approveTransaction(txnId: string, approverId: string): Promise<ICTransactionSummary> {
    const txn = await this.prisma.iCTransaction.findFirst({ where: { id: txnId } });
    if (!txn)
      throw new IntercompanyServiceError("IC_TXN_NOT_FOUND", "IC transaction not found.", 404);

    if (txn.status !== "PENDING_APPROVAL") {
      throw new IntercompanyServiceError(
        "IC_TXN_NOT_PENDING",
        `Cannot approve a transaction in ${txn.status} status.`,
        422
      );
    }

    // Cannot approve own transaction
    if (txn.createdById === approverId) {
      throw new IntercompanyServiceError(
        "IC_SELF_APPROVE",
        "Cannot approve your own IC transaction.",
        403
      );
    }

    // Post the transaction atomically
    const result = await this.prisma.$transaction(async (tx: any) => {
      // Load pair with entity details
      const pair = await tx.iCEntityPair.findFirst({
        where: { id: txn.pairId },
        include: {
          entityA: { select: { id: true, functionalCurrency: true } },
          entityB: { select: { id: true, functionalCurrency: true } }
        }
      });

      // Load mapping
      const mapping = txn.mappingId
        ? await tx.iCAccountMapping.findFirst({ where: { id: txn.mappingId } })
        : null;

      if (!mapping) {
        throw new IntercompanyServiceError(
          "IC_NO_MAPPING",
          "Account mapping not found for this transaction.",
          422
        );
      }

      const isInitiatorA = pair.entityAId === txn.initiatingEntityId;
      const initiatorCurrency = isInitiatorA
        ? (pair.entityA.functionalCurrency ?? "USD")
        : (pair.entityB.functionalCurrency ?? "USD");
      const counterpartyCurrency = isInitiatorA
        ? (pair.entityB.functionalCurrency ?? "USD")
        : (pair.entityA.functionalCurrency ?? "USD");

      const initiatorDebitCode = isInitiatorA ? mapping.entityADebitCode : mapping.entityBDebitCode;
      const initiatorCreditCode = isInitiatorA
        ? mapping.entityACreditCode
        : mapping.entityBCreditCode;
      const counterpartyDebitCode = isInitiatorA
        ? mapping.entityBDebitCode
        : mapping.entityADebitCode;
      const counterpartyCreditCode = isInitiatorA
        ? mapping.entityBCreditCode
        : mapping.entityACreditCode;

      const amountD = D(txn.amount);
      const functionalAmountInitiator = D(txn.functionalAmountInitiator);
      const functionalAmountCounterparty = D(txn.functionalAmountCounterparty);
      const fxRateInitiatorD = D(txn.fxRateInitiator);
      const fxRateCounterpartyD = D(txn.fxRateCounterparty);

      // Find open periods
      const initiatorPeriod = await tx.period.findFirst({
        where: { id: txn.periodId, entityId: txn.initiatingEntityId }
      });
      const counterpartyPeriod = await tx.period.findFirst({
        where: {
          entityId: txn.counterpartyEntityId,
          status: "OPEN",
          year: initiatorPeriod?.year,
          month: initiatorPeriod?.month
        }
      });

      if (!initiatorPeriod || !counterpartyPeriod) {
        throw new IntercompanyServiceError(
          "IC_NO_OPEN_PERIOD",
          "No open period found in one or both entities.",
          422
        );
      }

      // Resolve accounts
      const initiatorDebitAcct = await tx.account.findFirst({
        where: { entityId: txn.initiatingEntityId, code: initiatorDebitCode, isActive: true }
      });
      const initiatorCreditAcct = await tx.account.findFirst({
        where: { entityId: txn.initiatingEntityId, code: initiatorCreditCode, isActive: true }
      });
      const counterpartyDebitAcct = await tx.account.findFirst({
        where: { entityId: txn.counterpartyEntityId, code: counterpartyDebitCode, isActive: true }
      });
      const counterpartyCreditAcct = await tx.account.findFirst({
        where: { entityId: txn.counterpartyEntityId, code: counterpartyCreditCode, isActive: true }
      });

      if (
        !initiatorDebitAcct ||
        !initiatorCreditAcct ||
        !counterpartyDebitAcct ||
        !counterpartyCreditAcct
      ) {
        throw new IntercompanyServiceError(
          "IC_ACCOUNTS_MISSING",
          "One or more IC accounts not found.",
          422
        );
      }

      const reference = `IC-${txn.reference}`;
      const description = txn.description ?? `Intercompany: ${txn.reference}`;

      // Create both journals
      const initiatorJournal = await tx.journal.create({
        data: {
          entityId: txn.initiatingEntityId,
          periodId: initiatorPeriod.id,
          reference,
          description,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: initiatorCurrency,
          createdById: txn.createdById,
          lines: {
            create: [
              {
                accountId: initiatorDebitAcct.id,
                debit: functionalAmountInitiator.toFixed(FOUR_DP),
                credit: "0",
                currency: txn.currency,
                fxRate: fxRateInitiatorD.toFixed(EIGHT_DP),
                debitFunctional: functionalAmountInitiator.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC debit: ${initiatorDebitCode}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: initiatorCreditAcct.id,
                debit: "0",
                credit: functionalAmountInitiator.toFixed(FOUR_DP),
                currency: txn.currency,
                fxRate: fxRateInitiatorD.toFixed(EIGHT_DP),
                debitFunctional: "0",
                creditFunctional: functionalAmountInitiator.toFixed(FOUR_DP),
                description: `IC credit: ${initiatorCreditCode}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      const counterpartyJournal = await tx.journal.create({
        data: {
          entityId: txn.counterpartyEntityId,
          periodId: counterpartyPeriod.id,
          reference,
          description,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: counterpartyCurrency,
          createdById: txn.createdById,
          lines: {
            create: [
              {
                accountId: counterpartyDebitAcct.id,
                debit: functionalAmountCounterparty.toFixed(FOUR_DP),
                credit: "0",
                currency: txn.currency,
                fxRate: fxRateCounterpartyD.toFixed(EIGHT_DP),
                debitFunctional: functionalAmountCounterparty.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC debit: ${counterpartyDebitCode}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: counterpartyCreditAcct.id,
                debit: "0",
                credit: functionalAmountCounterparty.toFixed(FOUR_DP),
                currency: txn.currency,
                fxRate: fxRateCounterpartyD.toFixed(EIGHT_DP),
                debitFunctional: "0",
                creditFunctional: functionalAmountCounterparty.toFixed(FOUR_DP),
                description: `IC credit: ${counterpartyCreditCode}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      // Reflect both journals in account_period_balances (NF3)
      await this.updateICBalances(tx, [
        {
          entityId: txn.initiatingEntityId,
          periodId: initiatorPeriod.id,
          debitAcct: initiatorDebitAcct,
          creditAcct: initiatorCreditAcct,
          amount: functionalAmountInitiator
        },
        {
          entityId: txn.counterpartyEntityId,
          periodId: counterpartyPeriod.id,
          debitAcct: counterpartyDebitAcct,
          creditAcct: counterpartyCreditAcct,
          amount: functionalAmountCounterparty
        }
      ]);

      // Update IC transaction
      return tx.iCTransaction.update({
        where: { id: txnId },
        data: {
          status: "POSTED",
          approvedById: approverId,
          approvedAt: new Date(),
          postedAt: new Date(),
          initiatorJournalId: initiatorJournal.id,
          counterpartyJournalId: counterpartyJournal.id
        }
      });
    });

    return this.toTransactionSummary(result);
  }

  /**
   * Reject a PENDING_APPROVAL transaction. Deletes any held journals.
   */
  async rejectTransaction(
    txnId: string,
    rejectorId: string,
    reason?: string
  ): Promise<ICTransactionSummary> {
    const txn = await this.prisma.iCTransaction.findFirst({ where: { id: txnId } });
    if (!txn)
      throw new IntercompanyServiceError("IC_TXN_NOT_FOUND", "IC transaction not found.", 404);

    if (txn.status !== "PENDING_APPROVAL" && txn.status !== "DRAFT") {
      throw new IntercompanyServiceError(
        "IC_TXN_CANNOT_REJECT",
        `Cannot reject a transaction in ${txn.status} status.`,
        422
      );
    }

    const updated = await this.prisma.iCTransaction.update({
      where: { id: txnId },
      data: {
        status: "REJECTED",
        rejectedById: rejectorId,
        rejectedAt: new Date(),
        rejectionReason: reason ?? null
      }
    });

    return this.toTransactionSummary(updated);
  }

  /**
   * Reverse a POSTED IC transaction.
   * Creates a new IC transaction with flipped DR/CR — never deletes original.
   */
  async reverseTransaction(
    txnId: string,
    actorId: string,
    reason?: string
  ): Promise<ICTransactionSummary> {
    const txn = await this.prisma.iCTransaction.findFirst({
      where: { id: txnId }
    });
    if (!txn)
      throw new IntercompanyServiceError("IC_TXN_NOT_FOUND", "IC transaction not found.", 404);

    if (txn.status !== "POSTED") {
      throw new IntercompanyServiceError(
        "IC_TXN_NOT_POSTED",
        "Only posted transactions can be reversed.",
        422
      );
    }

    // Check not already reversed
    const existingReversal = await this.prisma.iCTransaction.findFirst({
      where: { reversalOfId: txnId }
    });
    if (existingReversal) {
      throw new IntercompanyServiceError(
        "IC_ALREADY_REVERSED",
        "This transaction has already been reversed.",
        422
      );
    }

    // Load pair with entities
    const pair = await this.prisma.iCEntityPair.findFirst({
      where: { id: txn.pairId },
      include: {
        entityA: { select: { id: true, functionalCurrency: true } },
        entityB: { select: { id: true, functionalCurrency: true } }
      }
    });
    if (!pair) {
      throw new IntercompanyServiceError(
        "IC_PAIR_NOT_FOUND",
        "Entity pair not found for reversal.",
        404
      );
    }

    const mapping = txn.mappingId
      ? await this.prisma.iCAccountMapping.findFirst({ where: { id: txn.mappingId } })
      : null;

    if (!mapping) {
      throw new IntercompanyServiceError(
        "IC_NO_MAPPING",
        "Account mapping not found for reversal.",
        422
      );
    }

    const isInitiatorA = pair.entityAId === txn.initiatingEntityId;
    const initiatorCurrency = isInitiatorA
      ? (pair.entityA.functionalCurrency ?? "USD")
      : (pair.entityB.functionalCurrency ?? "USD");
    const counterpartyCurrency = isInitiatorA
      ? (pair.entityB.functionalCurrency ?? "USD")
      : (pair.entityA.functionalCurrency ?? "USD");

    // Flip the DR/CR: swap debit and credit codes
    const initiatorDebitCode = isInitiatorA ? mapping.entityACreditCode : mapping.entityBCreditCode;
    const initiatorCreditCode = isInitiatorA ? mapping.entityADebitCode : mapping.entityBDebitCode;
    const counterpartyDebitCode = isInitiatorA
      ? mapping.entityBCreditCode
      : mapping.entityACreditCode;
    const counterpartyCreditCode = isInitiatorA
      ? mapping.entityBDebitCode
      : mapping.entityADebitCode;

    const amountD = D(txn.amount);
    const fxRateInitiatorD = D(txn.fxRateInitiator);
    const fxRateCounterpartyD = D(txn.fxRateCounterparty);
    const functionalAmountInitiator = D(txn.functionalAmountInitiator);
    const functionalAmountCounterparty = D(txn.functionalAmountCounterparty);

    const result = await this.prisma.$transaction(async (tx: any) => {
      // Find open periods
      const initiatorPeriod = await tx.period.findFirst({
        where: { entityId: txn.initiatingEntityId, status: "OPEN" },
        orderBy: [{ year: "desc" }, { month: "desc" }]
      });
      const counterpartyPeriod = await tx.period.findFirst({
        where: { entityId: txn.counterpartyEntityId, status: "OPEN" },
        orderBy: [{ year: "desc" }, { month: "desc" }]
      });

      if (!initiatorPeriod || !counterpartyPeriod) {
        throw new IntercompanyServiceError(
          "IC_NO_OPEN_PERIOD",
          "No open period found for reversal.",
          422
        );
      }

      // Resolve accounts
      const initiatorDebitAcct = await tx.account.findFirst({
        where: { entityId: txn.initiatingEntityId, code: initiatorDebitCode, isActive: true }
      });
      const initiatorCreditAcct = await tx.account.findFirst({
        where: { entityId: txn.initiatingEntityId, code: initiatorCreditCode, isActive: true }
      });
      const counterpartyDebitAcct = await tx.account.findFirst({
        where: { entityId: txn.counterpartyEntityId, code: counterpartyDebitCode, isActive: true }
      });
      const counterpartyCreditAcct = await tx.account.findFirst({
        where: { entityId: txn.counterpartyEntityId, code: counterpartyCreditCode, isActive: true }
      });

      if (
        !initiatorDebitAcct ||
        !initiatorCreditAcct ||
        !counterpartyDebitAcct ||
        !counterpartyCreditAcct
      ) {
        throw new IntercompanyServiceError(
          "IC_ACCOUNTS_MISSING",
          "One or more IC accounts not found for reversal.",
          422
        );
      }

      const reference = `IC-REV-${txn.reference}`;
      const desc = reason ?? `Reversal of IC-${txn.reference}`;

      // Reversal journal in initiating entity (flipped DR/CR)
      const initiatorJournal = await tx.journal.create({
        data: {
          entityId: txn.initiatingEntityId,
          periodId: initiatorPeriod.id,
          reference,
          description: desc,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: initiatorCurrency,
          createdById: actorId,
          lines: {
            create: [
              {
                accountId: initiatorDebitAcct.id,
                debit: functionalAmountInitiator.toFixed(FOUR_DP),
                credit: "0",
                currency: txn.currency,
                fxRate: fxRateInitiatorD.toFixed(EIGHT_DP),
                debitFunctional: functionalAmountInitiator.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC reversal debit: ${initiatorDebitCode}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: initiatorCreditAcct.id,
                debit: "0",
                credit: functionalAmountInitiator.toFixed(FOUR_DP),
                currency: txn.currency,
                fxRate: fxRateInitiatorD.toFixed(EIGHT_DP),
                debitFunctional: "0",
                creditFunctional: functionalAmountInitiator.toFixed(FOUR_DP),
                description: `IC reversal credit: ${initiatorCreditCode}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      const counterpartyJournal = await tx.journal.create({
        data: {
          entityId: txn.counterpartyEntityId,
          periodId: counterpartyPeriod.id,
          reference,
          description: desc,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: counterpartyCurrency,
          createdById: actorId,
          lines: {
            create: [
              {
                accountId: counterpartyDebitAcct.id,
                debit: functionalAmountCounterparty.toFixed(FOUR_DP),
                credit: "0",
                currency: txn.currency,
                fxRate: fxRateCounterpartyD.toFixed(EIGHT_DP),
                debitFunctional: functionalAmountCounterparty.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC reversal debit: ${counterpartyDebitCode}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: counterpartyCreditAcct.id,
                debit: "0",
                credit: functionalAmountCounterparty.toFixed(FOUR_DP),
                currency: txn.currency,
                fxRate: fxRateCounterpartyD.toFixed(EIGHT_DP),
                debitFunctional: "0",
                creditFunctional: functionalAmountCounterparty.toFixed(FOUR_DP),
                description: `IC reversal credit: ${counterpartyCreditCode}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      // Reflect both reversal journals in account_period_balances (NF3)
      await this.updateICBalances(tx, [
        {
          entityId: txn.initiatingEntityId,
          periodId: initiatorPeriod.id,
          debitAcct: initiatorDebitAcct,
          creditAcct: initiatorCreditAcct,
          amount: functionalAmountInitiator
        },
        {
          entityId: txn.counterpartyEntityId,
          periodId: counterpartyPeriod.id,
          debitAcct: counterpartyDebitAcct,
          creditAcct: counterpartyCreditAcct,
          amount: functionalAmountCounterparty
        }
      ]);

      // Mark original as REVERSED
      await tx.iCTransaction.update({
        where: { id: txnId },
        data: { status: "REVERSED" }
      });

      // Create reversal IC transaction record
      return tx.iCTransaction.create({
        data: {
          pairId: txn.pairId,
          mappingId: txn.mappingId,
          initiatingEntityId: txn.initiatingEntityId,
          counterpartyEntityId: txn.counterpartyEntityId,
          status: "POSTED",
          amount: amountD.toFixed(FOUR_DP),
          currency: txn.currency,
          fxRateInitiator: fxRateInitiatorD.toFixed(EIGHT_DP),
          fxRateCounterparty: fxRateCounterpartyD.toFixed(EIGHT_DP),
          functionalAmountInitiator: functionalAmountInitiator.toFixed(FOUR_DP),
          functionalAmountCounterparty: functionalAmountCounterparty.toFixed(FOUR_DP),
          reference: `REV-${txn.reference}`,
          description: desc,
          periodId: initiatorPeriod.id,
          initiatorJournalId: initiatorJournal.id,
          counterpartyJournalId: counterpartyJournal.id,
          reversalOfId: txnId,
          createdById: actorId,
          postedAt: new Date()
        }
      });
    });

    return this.toTransactionSummary(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IC Reconciliation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Compute live IC balances across all entity pairs.
   */
  async getReconciliation(): Promise<ICReconciliationResult> {
    const pairs = await this.prisma.iCEntityPair.findMany({
      where: { isActive: true },
      include: {
        entityA: { select: { id: true, name: true, functionalCurrency: true } },
        entityB: { select: { id: true, name: true, functionalCurrency: true } }
      }
    });

    const pairBalances: ICReconciliationPairBalance[] = [];
    let totalUnreconciled = 0;

    for (const pair of pairs) {
      // Get all posted (non-reversed) transactions for this pair
      const txns = await this.prisma.iCTransaction.findMany({
        where: {
          pairId: pair.id,
          status: "POSTED"
        }
      });

      let balanceA = ZERO; // Net from Entity A's perspective
      let balanceB = ZERO; // Net from Entity B's perspective

      for (const txn of txns) {
        const funcAmountInit = D(txn.functionalAmountInitiator);
        const funcAmountCpty = D(txn.functionalAmountCounterparty);

        if (txn.initiatingEntityId === pair.entityAId) {
          // A initiated: A's receivable increases, B's payable increases
          balanceA = balanceA.add(funcAmountInit);
          balanceB = balanceB.add(funcAmountCpty);
        } else {
          // B initiated: B's receivable increases, A's payable increases
          balanceA = balanceA.sub(funcAmountCpty);
          balanceB = balanceB.sub(funcAmountInit);
        }
      }

      const difference = balanceA.sub(balanceB).abs();
      const isReconciled = difference.lt(new Prisma.Decimal("0.01"));

      if (!isReconciled) totalUnreconciled++;

      pairBalances.push({
        pairId: pair.id,
        entityAId: pair.entityAId,
        entityBId: pair.entityBId,
        entityAName: pair.entityA?.name,
        entityBName: pair.entityB?.name,
        balanceEntityA: balanceA.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
        balanceEntityB: balanceB.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
        difference: difference.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
        currency: pair.entityA?.functionalCurrency ?? "USD",
        status: isReconciled ? "RECONCILED" : "UNRECONCILED",
        transactionCount: txns.length
      });
    }

    return { pairs: pairBalances, totalUnreconciled };
  }

  /**
   * Create a period-end reconciliation snapshot for a specific pair.
   */
  async createReconciliationSnapshot(
    pairId: string,
    periodId: string,
    actorId: string,
    notes?: string
  ) {
    // Validate pair exists
    const pair = await this.prisma.iCEntityPair.findFirst({
      where: { id: pairId },
      include: {
        entityA: { select: { functionalCurrency: true } }
      }
    });
    if (!pair)
      throw new IntercompanyServiceError("IC_PAIR_NOT_FOUND", "IC entity pair not found.", 404);

    // Get all posted transactions for this pair up to this period
    const period = await this.prisma.period.findFirst({ where: { id: periodId } });
    if (!period)
      throw new IntercompanyServiceError("IC_PERIOD_NOT_FOUND", "Period not found.", 404);

    const txns = await this.prisma.iCTransaction.findMany({
      where: {
        pairId,
        status: "POSTED",
        postedAt: { lte: new Date() }
      }
    });

    let balanceA = ZERO;
    let balanceB = ZERO;

    for (const txn of txns) {
      const funcAmountInit = D(txn.functionalAmountInitiator);
      const funcAmountCpty = D(txn.functionalAmountCounterparty);

      if (txn.initiatingEntityId === pair.entityAId) {
        balanceA = balanceA.add(funcAmountInit);
        balanceB = balanceB.add(funcAmountCpty);
      } else {
        balanceA = balanceA.sub(funcAmountCpty);
        balanceB = balanceB.sub(funcAmountInit);
      }
    }

    const difference = balanceA.sub(balanceB).abs();
    const isReconciled = difference.lt(new Prisma.Decimal("0.01"));

    // Upsert snapshot
    const existing = await this.prisma.iCReconciliationSnapshot.findFirst({
      where: { pairId, periodId }
    });

    if (existing) {
      return this.prisma.iCReconciliationSnapshot.update({
        where: { id: existing.id },
        data: {
          balanceEntityA: balanceA.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
          balanceEntityB: balanceB.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
          difference: difference.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
          status: isReconciled ? "RECONCILED" : "UNRECONCILED",
          notes: notes ?? null
        }
      });
    }

    return this.prisma.iCReconciliationSnapshot.create({
      data: {
        pairId,
        periodId,
        balanceEntityA: balanceA.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
        balanceEntityB: balanceB.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
        difference: difference.toDecimalPlaces(FOUR_DP).toFixed(FOUR_DP),
        currency: pair.entityA?.functionalCurrency ?? "USD",
        status: isReconciled ? "RECONCILED" : "UNRECONCILED",
        notes: notes ?? null,
        createdById: actorId
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy API (preserves backward compatibility for existing v1 endpoints)
  // ═══════════════════════════════════════════════════════════════════════════

  async listAccountPairs(entityId: string) {
    return this.prisma.intercompanyAccountPair.findMany({
      where: { entityId, isActive: true },
      orderBy: { createdAt: "asc" }
    });
  }

  async getAccountPair(entityId: string, pairId: string) {
    const pair = await this.prisma.intercompanyAccountPair.findFirst({
      where: { id: pairId, entityId }
    });
    if (!pair)
      throw new IntercompanyServiceError("IC_PAIR_NOT_FOUND", "IC account pair not found.", 404);
    return pair;
  }

  async createAccountPair(entityId: string, input: CreateICAccountPairInput) {
    const counterparty = await this.prisma.entity.findFirst({
      where: { id: input.counterpartyEntityId, isActive: true }
    });
    if (!counterparty)
      throw new IntercompanyServiceError(
        "IC_COUNTERPARTY_NOT_FOUND",
        "Counterparty entity not found.",
        404
      );

    const existing = await this.prisma.intercompanyAccountPair.findFirst({
      where: { entityId, counterpartyEntityId: input.counterpartyEntityId }
    });
    if (existing)
      throw new IntercompanyServiceError(
        "IC_PAIR_EXISTS",
        "An IC account pair already exists for this counterparty.",
        409
      );

    await this.validateAccountCode(entityId, input.icReceivableCode, "IC Receivable");
    await this.validateAccountCode(entityId, input.icPayableCode, "IC Payable");

    return this.prisma.intercompanyAccountPair.create({
      data: {
        entityId,
        counterpartyEntityId: input.counterpartyEntityId,
        icReceivableCode: input.icReceivableCode,
        icPayableCode: input.icPayableCode
      }
    });
  }

  async updateAccountPair(entityId: string, pairId: string, input: UpdateICAccountPairInput) {
    await this.getAccountPair(entityId, pairId);
    const data: Record<string, unknown> = {};
    if (input.icReceivableCode !== undefined) {
      await this.validateAccountCode(entityId, input.icReceivableCode, "IC Receivable");
      data.icReceivableCode = input.icReceivableCode;
    }
    if (input.icPayableCode !== undefined) {
      await this.validateAccountCode(entityId, input.icPayableCode, "IC Payable");
      data.icPayableCode = input.icPayableCode;
    }
    return this.prisma.intercompanyAccountPair.update({ where: { id: pairId }, data });
  }

  async deleteAccountPair(entityId: string, pairId: string) {
    await this.getAccountPair(entityId, pairId);
    await this.prisma.intercompanyAccountPair.update({
      where: { id: pairId },
      data: { isActive: false }
    });
  }

  async listICJournals(entityId: string): Promise<ICJournalSummary[]> {
    const journals = await this.prisma.intercompanyJournal.findMany({
      where: { OR: [{ sourceEntityId: entityId }, { mirrorEntityId: entityId }] },
      orderBy: { createdAt: "desc" }
    });
    return journals.map((j: any) => this.toLegacySummary(j));
  }

  async createICJournal(
    sourceEntityId: string,
    input: CreateICJournalInput,
    actorId: string
  ): Promise<ICJournalSummary> {
    const mirrorEntity = await this.prisma.entity.findFirst({
      where: { id: input.mirrorEntityId, isActive: true }
    });
    if (!mirrorEntity)
      throw new IntercompanyServiceError(
        "IC_MIRROR_ENTITY_NOT_FOUND",
        "Mirror entity not found.",
        404
      );

    const pair = await this.prisma.intercompanyAccountPair.findFirst({
      where: {
        entityId: sourceEntityId,
        counterpartyEntityId: input.mirrorEntityId,
        isActive: true
      }
    });
    if (!pair)
      throw new IntercompanyServiceError(
        "IC_NO_ACCOUNT_PAIR",
        "No IC account pair configured.",
        422
      );

    const mirrorPair = await this.prisma.intercompanyAccountPair.findFirst({
      where: {
        entityId: input.mirrorEntityId,
        counterpartyEntityId: sourceEntityId,
        isActive: true
      }
    });
    if (!mirrorPair)
      throw new IntercompanyServiceError(
        "IC_NO_MIRROR_PAIR",
        "No mirror IC account pair configured.",
        422
      );

    const period = await this.prisma.period.findFirst({
      where: { id: input.periodId, entityId: sourceEntityId }
    });
    if (!period)
      throw new IntercompanyServiceError(
        "IC_PERIOD_NOT_FOUND",
        "Period not found in source entity.",
        404
      );

    const icJournal = await this.prisma.intercompanyJournal.create({
      data: {
        sourceEntityId,
        mirrorEntityId: input.mirrorEntityId,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        description: input.description ?? null,
        status: "PENDING_BOTH_APPROVAL",
        createdById: actorId
      }
    });

    return this.toLegacySummary(icJournal);
  }

  async approveICJournal(
    icJournalId: string,
    approvingEntityId: string,
    approverId: string
  ): Promise<ICJournalSummary> {
    const icj = await this.prisma.intercompanyJournal.findFirst({ where: { id: icJournalId } });
    if (!icj)
      throw new IntercompanyServiceError("IC_JOURNAL_NOT_FOUND", "IC journal not found.", 404);

    if (icj.status === "POSTED" || icj.status === "REJECTED") {
      throw new IntercompanyServiceError(
        "IC_JOURNAL_FINALIZED",
        `IC journal is already ${icj.status.toLowerCase()}.`,
        422
      );
    }

    const isSourceEntity = approvingEntityId === icj.sourceEntityId;
    const isMirrorEntity = approvingEntityId === icj.mirrorEntityId;
    if (!isSourceEntity && !isMirrorEntity) {
      throw new IntercompanyServiceError(
        "IC_NOT_PARTY",
        "You are not a party to this IC journal.",
        403
      );
    }

    const updateData: Record<string, unknown> = {};
    if (isSourceEntity && !icj.sourceApprovedAt) {
      updateData.sourceApprovedById = approverId;
      updateData.sourceApprovedAt = new Date();
    } else if (isMirrorEntity && !icj.mirrorApprovedAt) {
      updateData.mirrorApprovedById = approverId;
      updateData.mirrorApprovedAt = new Date();
    } else {
      throw new IntercompanyServiceError(
        "IC_ALREADY_APPROVED",
        "This entity has already approved.",
        422
      );
    }

    const sourceApproved = isSourceEntity ? true : !!icj.sourceApprovedAt;
    const mirrorApproved = isMirrorEntity ? true : !!icj.mirrorApprovedAt;

    if (sourceApproved && mirrorApproved) {
      updateData.status = "APPROVED";
    } else if (sourceApproved) {
      updateData.status = "PENDING_MIRROR_APPROVAL";
    } else {
      updateData.status = "PENDING_SOURCE_APPROVAL";
    }

    const updated = await this.prisma.intercompanyJournal.update({
      where: { id: icJournalId },
      data: updateData
    });

    if (updated.status === "APPROVED") {
      return this.postLegacyICJournals(updated);
    }
    return this.toLegacySummary(updated);
  }

  async rejectICJournal(
    icJournalId: string,
    rejectingEntityId: string,
    rejectorId: string,
    reason?: string
  ): Promise<ICJournalSummary> {
    const icj = await this.prisma.intercompanyJournal.findFirst({ where: { id: icJournalId } });
    if (!icj)
      throw new IntercompanyServiceError("IC_JOURNAL_NOT_FOUND", "IC journal not found.", 404);

    if (icj.status === "POSTED" || icj.status === "REJECTED") {
      throw new IntercompanyServiceError(
        "IC_JOURNAL_FINALIZED",
        `IC journal is already ${icj.status.toLowerCase()}.`,
        422
      );
    }

    const isParty =
      rejectingEntityId === icj.sourceEntityId || rejectingEntityId === icj.mirrorEntityId;
    if (!isParty)
      throw new IntercompanyServiceError(
        "IC_NOT_PARTY",
        "You are not a party to this IC journal.",
        403
      );

    const updated = await this.prisma.intercompanyJournal.update({
      where: { id: icJournalId },
      data: {
        status: "REJECTED",
        rejectedById: rejectorId,
        rejectedAt: new Date(),
        rejectionReason: reason ?? null
      }
    });
    return this.toLegacySummary(updated);
  }

  async getPostedICJournalsForElimination(entityIds: string[]) {
    return this.prisma.intercompanyJournal.findMany({
      where: {
        status: "POSTED",
        sourceEntityId: { in: entityIds },
        mirrorEntityId: { in: entityIds }
      },
      orderBy: { createdAt: "asc" }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async validateAccountCode(entityId: string, code: string, label: string) {
    const account = await this.prisma.account.findFirst({
      where: { entityId, code, isActive: true }
    });
    if (!account) {
      throw new IntercompanyServiceError(
        "IC_ACCOUNT_NOT_FOUND",
        `${label} account ${code} not found.`,
        422
      );
    }
    return account;
  }

  private async lookupFXRate(fromCurrency: string, toCurrency: string): Promise<string | null> {
    if (fromCurrency === toCurrency) return "1";
    const rate = await this.prisma.fXRate.findFirst({
      where: {
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        rateType: "SPOT"
      },
      orderBy: [{ effectiveDate: "desc" }]
    });
    return rate ? String(rate.rate) : null;
  }

  private toMappingSummary(m: any): ICAccountMappingSummary {
    return {
      id: m.id,
      pairId: m.pairId,
      name: m.name,
      entityADebitCode: m.entityADebitCode,
      entityACreditCode: m.entityACreditCode,
      entityBDebitCode: m.entityBDebitCode,
      entityBCreditCode: m.entityBCreditCode,
      isActive: m.isActive
    };
  }

  private toTransactionSummary(t: any): ICTransactionSummary {
    return {
      id: t.id,
      pairId: t.pairId,
      mappingId: t.mappingId,
      initiatingEntityId: t.initiatingEntityId,
      counterpartyEntityId: t.counterpartyEntityId,
      status: t.status,
      amount: D(t.amount).toFixed(FOUR_DP),
      currency: t.currency,
      fxRateInitiator: D(t.fxRateInitiator).toFixed(EIGHT_DP),
      fxRateCounterparty: D(t.fxRateCounterparty).toFixed(EIGHT_DP),
      functionalAmountInitiator: D(t.functionalAmountInitiator).toFixed(FOUR_DP),
      functionalAmountCounterparty: D(t.functionalAmountCounterparty).toFixed(FOUR_DP),
      reference: t.reference,
      description: t.description,
      periodId: t.periodId,
      initiatorJournalId: t.initiatorJournalId,
      counterpartyJournalId: t.counterpartyJournalId,
      reversalOfId: t.reversalOfId,
      createdById: t.createdById,
      approvedById: t.approvedById,
      approvedAt: t.approvedAt?.toISOString?.() ?? null,
      rejectedById: t.rejectedById,
      rejectedAt: t.rejectedAt?.toISOString?.() ?? null,
      rejectionReason: t.rejectionReason,
      postedAt: t.postedAt?.toISOString?.() ?? null,
      createdAt: t.createdAt?.toISOString?.() ?? new Date().toISOString()
    };
  }

  private toLegacySummary(j: any): ICJournalSummary {
    return {
      id: j.id,
      sourceEntityId: j.sourceEntityId,
      mirrorEntityId: j.mirrorEntityId,
      sourceJournalId: j.sourceJournalId,
      mirrorJournalId: j.mirrorJournalId,
      status: j.status,
      amount: Number(j.amount),
      currency: j.currency,
      reference: j.reference,
      description: j.description,
      createdAt: j.createdAt?.toISOString?.() ?? new Date().toISOString()
    };
  }

  private async postLegacyICJournals(icj: any): Promise<ICJournalSummary> {
    const sourcePair = await this.prisma.intercompanyAccountPair.findFirst({
      where: {
        entityId: icj.sourceEntityId,
        counterpartyEntityId: icj.mirrorEntityId,
        isActive: true
      }
    });
    if (!sourcePair) {
      throw new IntercompanyServiceError(
        "IC_PAIR_NOT_FOUND",
        "Source IC account pair not found.",
        422
      );
    }
    const mirrorPair = await this.prisma.intercompanyAccountPair.findFirst({
      where: {
        entityId: icj.mirrorEntityId,
        counterpartyEntityId: icj.sourceEntityId,
        isActive: true
      }
    });
    if (!mirrorPair) {
      throw new IntercompanyServiceError(
        "IC_PAIR_NOT_FOUND",
        "Mirror IC account pair not found.",
        422
      );
    }

    const sourceReceivable = await this.prisma.account.findFirst({
      where: { entityId: icj.sourceEntityId, code: sourcePair.icReceivableCode, isActive: true }
    });
    const mirrorPayable = await this.prisma.account.findFirst({
      where: { entityId: icj.mirrorEntityId, code: mirrorPair.icPayableCode, isActive: true }
    });

    if (!sourceReceivable || !mirrorPayable) {
      throw new IntercompanyServiceError(
        "IC_POSTING_ACCOUNTS_MISSING",
        "IC accounts not found for posting.",
        422
      );
    }

    const mirrorPeriod = await this.prisma.period.findFirst({
      where: { entityId: icj.mirrorEntityId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
    const sourcePeriod = await this.prisma.period.findFirst({
      where: { entityId: icj.sourceEntityId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });

    if (!sourcePeriod || !mirrorPeriod) {
      throw new IntercompanyServiceError("IC_NO_OPEN_PERIOD", "No open period found.", 422);
    }

    const sourceEntity = await this.prisma.entity.findFirst({
      where: { id: icj.sourceEntityId },
      select: { functionalCurrency: true }
    });
    const mirrorEntity = await this.prisma.entity.findFirst({
      where: { id: icj.mirrorEntityId },
      select: { functionalCurrency: true }
    });

    const sourceCurrency = sourceEntity?.functionalCurrency ?? "USD";
    const mirrorCurrency = mirrorEntity?.functionalCurrency ?? "USD";
    const amountD = D(icj.amount);

    const result = await this.prisma.$transaction(async (tx: any) => {
      const sourceJournal = await tx.journal.create({
        data: {
          entityId: icj.sourceEntityId,
          periodId: sourcePeriod.id,
          reference: `IC-${icj.reference}`,
          description: `Intercompany: ${icj.description ?? icj.reference}`,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: sourceCurrency,
          createdById: icj.createdById,
          lines: {
            create: [
              {
                accountId: sourceReceivable.id,
                debit: amountD.toFixed(FOUR_DP),
                credit: "0",
                currency: icj.currency,
                fxRate: "1",
                debitFunctional: amountD.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC receivable from ${icj.mirrorEntityId}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: sourceReceivable.id,
                debit: "0",
                credit: amountD.toFixed(FOUR_DP),
                currency: icj.currency,
                fxRate: "1",
                debitFunctional: "0",
                creditFunctional: amountD.toFixed(FOUR_DP),
                description: `IC offset — ${icj.reference}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      const mirrorJournal = await tx.journal.create({
        data: {
          entityId: icj.mirrorEntityId,
          periodId: mirrorPeriod.id,
          reference: `IC-${icj.reference}`,
          description: `Intercompany: ${icj.description ?? icj.reference}`,
          source: "INTERCO",
          status: "POSTED",
          postedAt: new Date(),
          functionalCurrency: mirrorCurrency,
          createdById: icj.createdById,
          lines: {
            create: [
              {
                accountId: mirrorPayable.id,
                debit: amountD.toFixed(FOUR_DP),
                credit: "0",
                currency: icj.currency,
                fxRate: "1",
                debitFunctional: amountD.toFixed(FOUR_DP),
                creditFunctional: "0",
                description: `IC offset — ${icj.reference}`,
                dimension1: "INTERCOMPANY"
              },
              {
                accountId: mirrorPayable.id,
                debit: "0",
                credit: amountD.toFixed(FOUR_DP),
                currency: icj.currency,
                fxRate: "1",
                debitFunctional: "0",
                creditFunctional: amountD.toFixed(FOUR_DP),
                description: `IC payable to ${icj.sourceEntityId}`,
                dimension1: "INTERCOMPANY"
              }
            ]
          }
        }
      });

      return tx.intercompanyJournal.update({
        where: { id: icj.id },
        data: {
          status: "POSTED",
          sourceJournalId: sourceJournal.id,
          mirrorJournalId: mirrorJournal.id
        }
      });
    });

    return this.toLegacySummary(result);
  }
}
