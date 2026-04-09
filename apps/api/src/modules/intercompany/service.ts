import type { PrismaClient } from "../../db/client.js";
import type {
  CreateICAccountPairInput,
  UpdateICAccountPairInput,
  CreateICJournalInput,
  ICJournalSummary
} from "./types.js";

// ── Errors ───────────────────────────────────────────────────────────────────

export class IntercompanyServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class IntercompanyService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── IC Account Pair CRUD ────────────────────────────────────────────────

  async listAccountPairs(entityId: string) {
    return (this.prisma as any).intercompanyAccountPair.findMany({
      where: { entityId, isActive: true },
      orderBy: { createdAt: "asc" }
    });
  }

  async getAccountPair(entityId: string, pairId: string) {
    const pair = await (this.prisma as any).intercompanyAccountPair.findFirst({
      where: { id: pairId, entityId }
    });
    if (!pair) {
      throw new IntercompanyServiceError("IC_PAIR_NOT_FOUND", "IC account pair not found.", 404);
    }
    return pair;
  }

  async createAccountPair(entityId: string, input: CreateICAccountPairInput) {
    // Validate counterparty entity exists
    const counterparty = await (this.prisma as any).entity.findFirst({
      where: { id: input.counterpartyEntityId, isActive: true }
    });
    if (!counterparty) {
      throw new IntercompanyServiceError(
        "IC_COUNTERPARTY_NOT_FOUND",
        "Counterparty entity not found.",
        404
      );
    }

    // Check uniqueness
    const existing = await (this.prisma as any).intercompanyAccountPair.findFirst({
      where: { entityId, counterpartyEntityId: input.counterpartyEntityId }
    });
    if (existing) {
      throw new IntercompanyServiceError(
        "IC_PAIR_EXISTS",
        "An IC account pair already exists for this counterparty.",
        409
      );
    }

    // Validate accounts exist
    await this.validateAccountExists(entityId, input.icReceivableCode, "IC Receivable");
    await this.validateAccountExists(entityId, input.icPayableCode, "IC Payable");

    return (this.prisma as any).intercompanyAccountPair.create({
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
      await this.validateAccountExists(entityId, input.icReceivableCode, "IC Receivable");
      data.icReceivableCode = input.icReceivableCode;
    }
    if (input.icPayableCode !== undefined) {
      await this.validateAccountExists(entityId, input.icPayableCode, "IC Payable");
      data.icPayableCode = input.icPayableCode;
    }

    return (this.prisma as any).intercompanyAccountPair.update({
      where: { id: pairId },
      data
    });
  }

  async deleteAccountPair(entityId: string, pairId: string) {
    await this.getAccountPair(entityId, pairId);
    await (this.prisma as any).intercompanyAccountPair.update({
      where: { id: pairId },
      data: { isActive: false }
    });
  }

  // ── IC Journal Operations ──────────────────────────────────────────────

  async listICJournals(entityId: string): Promise<ICJournalSummary[]> {
    const journals = await (this.prisma as any).intercompanyJournal.findMany({
      where: {
        OR: [{ sourceEntityId: entityId }, { mirrorEntityId: entityId }]
      },
      orderBy: { createdAt: "desc" }
    });

    return journals.map((j: any) => ({
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
      createdAt: j.createdAt.toISOString()
    }));
  }

  /**
   * Create an intercompany journal.
   * This creates the IC record in PENDING_BOTH_APPROVAL status.
   * Both entities must approve before journals are posted.
   */
  async createICJournal(
    sourceEntityId: string,
    input: CreateICJournalInput,
    actorId: string
  ): Promise<ICJournalSummary> {
    // Validate mirror entity
    const mirrorEntity = await (this.prisma as any).entity.findFirst({
      where: { id: input.mirrorEntityId, isActive: true }
    });
    if (!mirrorEntity) {
      throw new IntercompanyServiceError(
        "IC_MIRROR_ENTITY_NOT_FOUND",
        "Mirror entity not found.",
        404
      );
    }

    // Load IC account pair (source → mirror)
    const pair = await (this.prisma as any).intercompanyAccountPair.findFirst({
      where: {
        entityId: sourceEntityId,
        counterpartyEntityId: input.mirrorEntityId,
        isActive: true
      }
    });
    if (!pair) {
      throw new IntercompanyServiceError(
        "IC_NO_ACCOUNT_PAIR",
        "No IC account pair configured between these entities. Set up IC accounts first.",
        422
      );
    }

    // Load mirror-side account pair (mirror → source)
    const mirrorPair = await (this.prisma as any).intercompanyAccountPair.findFirst({
      where: {
        entityId: input.mirrorEntityId,
        counterpartyEntityId: sourceEntityId,
        isActive: true
      }
    });
    if (!mirrorPair) {
      throw new IntercompanyServiceError(
        "IC_NO_MIRROR_PAIR",
        "No IC account pair configured in the counterparty entity. Both entities need IC account pairs.",
        422
      );
    }

    // Validate period exists in source entity
    const period = await (this.prisma as any).period.findFirst({
      where: { id: input.periodId, entityId: sourceEntityId }
    });
    if (!period) {
      throw new IntercompanyServiceError(
        "IC_PERIOD_NOT_FOUND",
        "Period not found in source entity.",
        404
      );
    }

    const icJournal = await (this.prisma as any).intercompanyJournal.create({
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

    return {
      id: icJournal.id,
      sourceEntityId: icJournal.sourceEntityId,
      mirrorEntityId: icJournal.mirrorEntityId,
      sourceJournalId: null,
      mirrorJournalId: null,
      status: icJournal.status,
      amount: Number(icJournal.amount),
      currency: icJournal.currency,
      reference: icJournal.reference,
      description: icJournal.description,
      createdAt: icJournal.createdAt.toISOString()
    };
  }

  /**
   * Approve an IC journal from one entity's side.
   * When both sides have approved, auto-post the journals.
   */
  async approveICJournal(
    icJournalId: string,
    approvingEntityId: string,
    approverId: string
  ): Promise<ICJournalSummary> {
    const icj = await (this.prisma as any).intercompanyJournal.findFirst({
      where: { id: icJournalId }
    });
    if (!icj) {
      throw new IntercompanyServiceError("IC_JOURNAL_NOT_FOUND", "IC journal not found.", 404);
    }

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
        "This entity has already approved the IC journal.",
        422
      );
    }

    // Determine new status
    const sourceApproved = isSourceEntity ? true : !!icj.sourceApprovedAt;
    const mirrorApproved = isMirrorEntity ? true : !!icj.mirrorApprovedAt;

    if (sourceApproved && mirrorApproved) {
      updateData.status = "APPROVED";
    } else if (sourceApproved) {
      updateData.status = "PENDING_MIRROR_APPROVAL";
    } else {
      updateData.status = "PENDING_SOURCE_APPROVAL";
    }

    const updated = await (this.prisma as any).intercompanyJournal.update({
      where: { id: icJournalId },
      data: updateData
    });

    // If both approved, auto-post the journals
    if (updated.status === "APPROVED") {
      return this.postICJournals(updated);
    }

    return this.toSummary(updated);
  }

  /**
   * Reject an IC journal from either entity's side.
   */
  async rejectICJournal(
    icJournalId: string,
    rejectingEntityId: string,
    rejectorId: string,
    reason?: string
  ): Promise<ICJournalSummary> {
    const icj = await (this.prisma as any).intercompanyJournal.findFirst({
      where: { id: icJournalId }
    });
    if (!icj) {
      throw new IntercompanyServiceError("IC_JOURNAL_NOT_FOUND", "IC journal not found.", 404);
    }

    if (icj.status === "POSTED" || icj.status === "REJECTED") {
      throw new IntercompanyServiceError(
        "IC_JOURNAL_FINALIZED",
        `IC journal is already ${icj.status.toLowerCase()}.`,
        422
      );
    }

    const isParty =
      rejectingEntityId === icj.sourceEntityId || rejectingEntityId === icj.mirrorEntityId;
    if (!isParty) {
      throw new IntercompanyServiceError(
        "IC_NOT_PARTY",
        "You are not a party to this IC journal.",
        403
      );
    }

    const updated = await (this.prisma as any).intercompanyJournal.update({
      where: { id: icJournalId },
      data: {
        status: "REJECTED",
        rejectedById: rejectorId,
        rejectedAt: new Date(),
        rejectionReason: reason ?? null
      }
    });

    return this.toSummary(updated);
  }

  // ── Consolidation Elimination Helper ───────────────────────────────────

  /**
   * Get all posted IC journals between a set of entity IDs
   * for consolidation elimination.
   */
  async getPostedICJournalsForElimination(entityIds: string[]) {
    return (this.prisma as any).intercompanyJournal.findMany({
      where: {
        status: "POSTED",
        sourceEntityId: { in: entityIds },
        mirrorEntityId: { in: entityIds }
      },
      orderBy: { createdAt: "asc" }
    });
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private async validateAccountExists(entityId: string, code: string, label: string) {
    const account = await (this.prisma as any).account.findFirst({
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

  /**
   * Post both source and mirror journals after dual approval.
   */
  private async postICJournals(icj: any): Promise<ICJournalSummary> {
    // Load account pairs
    const sourcePair = await (this.prisma as any).intercompanyAccountPair.findFirst({
      where: {
        entityId: icj.sourceEntityId,
        counterpartyEntityId: icj.mirrorEntityId,
        isActive: true
      }
    });
    const mirrorPair = await (this.prisma as any).intercompanyAccountPair.findFirst({
      where: {
        entityId: icj.mirrorEntityId,
        counterpartyEntityId: icj.sourceEntityId,
        isActive: true
      }
    });

    // Resolve accounts
    const sourceReceivable = await (this.prisma as any).account.findFirst({
      where: { entityId: icj.sourceEntityId, code: sourcePair.icReceivableCode, isActive: true }
    });
    const mirrorPayable = await (this.prisma as any).account.findFirst({
      where: { entityId: icj.mirrorEntityId, code: mirrorPair.icPayableCode, isActive: true }
    });

    if (!sourceReceivable || !mirrorPayable) {
      throw new IntercompanyServiceError(
        "IC_POSTING_ACCOUNTS_MISSING",
        "IC receivable or payable accounts not found for posting.",
        422
      );
    }

    // Get a period for the mirror entity (use latest open period)
    const mirrorPeriod = await (this.prisma as any).period.findFirst({
      where: { entityId: icj.mirrorEntityId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });

    // Get source entity period (latest open)
    const sourcePeriod = await (this.prisma as any).period.findFirst({
      where: { entityId: icj.sourceEntityId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });

    if (!sourcePeriod || !mirrorPeriod) {
      throw new IntercompanyServiceError(
        "IC_NO_OPEN_PERIOD",
        "No open period found in one or both entities.",
        422
      );
    }

    // Get entity currencies
    const sourceEntity = await (this.prisma as any).entity.findFirst({
      where: { id: icj.sourceEntityId },
      select: { functionalCurrency: true }
    });
    const mirrorEntity = await (this.prisma as any).entity.findFirst({
      where: { id: icj.mirrorEntityId },
      select: { functionalCurrency: true }
    });

    const sourceCurrency = sourceEntity?.functionalCurrency ?? "USD";
    const mirrorCurrency = mirrorEntity?.functionalCurrency ?? "USD";
    const amount = Number(icj.amount);

    // Source journal: DR IC Receivable / CR (offset — use a supplied credit account or IC Payable)
    const sourceJournal = await (this.prisma as any).journal.create({
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
              debit: amount,
              credit: 0,
              currency: icj.currency,
              fxRate: 1,
              debitFunctional: amount,
              creditFunctional: 0,
              description: `IC receivable from ${icj.mirrorEntityId}`,
              dimension1: "INTERCOMPANY"
            },
            {
              accountId: sourceReceivable.id,
              debit: 0,
              credit: amount,
              currency: icj.currency,
              fxRate: 1,
              debitFunctional: 0,
              creditFunctional: amount,
              description: `IC offset — ${icj.reference}`,
              dimension1: "INTERCOMPANY"
            }
          ]
        }
      }
    });

    // Mirror journal: DR (offset) / CR IC Payable
    const mirrorJournal = await (this.prisma as any).journal.create({
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
              debit: amount,
              credit: 0,
              currency: icj.currency,
              fxRate: 1,
              debitFunctional: amount,
              creditFunctional: 0,
              description: `IC offset — ${icj.reference}`,
              dimension1: "INTERCOMPANY"
            },
            {
              accountId: mirrorPayable.id,
              debit: 0,
              credit: amount,
              currency: icj.currency,
              fxRate: 1,
              debitFunctional: 0,
              creditFunctional: amount,
              description: `IC payable to ${icj.sourceEntityId}`,
              dimension1: "INTERCOMPANY"
            }
          ]
        }
      }
    });

    // Update IC journal with posted journal IDs
    const updated = await (this.prisma as any).intercompanyJournal.update({
      where: { id: icj.id },
      data: {
        status: "POSTED",
        sourceJournalId: sourceJournal.id,
        mirrorJournalId: mirrorJournal.id
      }
    });

    return this.toSummary(updated);
  }

  private toSummary(icj: any): ICJournalSummary {
    return {
      id: icj.id,
      sourceEntityId: icj.sourceEntityId,
      mirrorEntityId: icj.mirrorEntityId,
      sourceJournalId: icj.sourceJournalId,
      mirrorJournalId: icj.mirrorJournalId,
      status: icj.status,
      amount: Number(icj.amount),
      currency: icj.currency,
      reference: icj.reference,
      description: icj.description,
      createdAt: icj.createdAt?.toISOString?.() ?? new Date().toISOString()
    };
  }
}
