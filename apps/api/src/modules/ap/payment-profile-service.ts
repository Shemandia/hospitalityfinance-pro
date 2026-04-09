import type { PrismaClient } from "../../db/client.js";
import type {
  CreatePaymentProfileInput,
  UpdatePaymentProfileInput,
  SelectionCriteria,
  RunCollectionInput
} from "./payment-profile-types.js";

// ── Errors ───────────────────────────────────────────────────────────────────

export class PaymentProfileServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class PaymentProfileService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async listProfiles(entityId: string, direction?: "PAY" | "COLLECT") {
    return (this.prisma as any).paymentProfile.findMany({
      where: {
        entityId,
        isActive: true,
        ...(direction ? { direction } : {})
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }]
    });
  }

  async getProfile(entityId: string, profileId: string) {
    const profile = await (this.prisma as any).paymentProfile.findFirst({
      where: { id: profileId, entityId }
    });
    if (!profile) {
      throw new PaymentProfileServiceError(
        "PAYMENT_PROFILE_NOT_FOUND",
        "Payment profile not found.",
        404
      );
    }
    return profile;
  }

  async createProfile(entityId: string, input: CreatePaymentProfileInput) {
    return (this.prisma as any).paymentProfile.create({
      data: {
        entityId,
        name: input.name,
        direction: input.direction,
        paymentMethod: input.paymentMethod,
        bankAccountId: input.bankAccountId ?? null,
        currency: input.currency ?? null,
        fxHandling: input.fxHandling,
        selectionCriteria: input.selectionCriteria as any,
        groupingRules: input.groupingRules as any,
        totalPaymentLimit: input.totalPaymentLimit ?? null,
        remittanceAdvice: input.remittanceAdvice,
        description: input.description ?? null
      }
    });
  }

  async updateProfile(entityId: string, profileId: string, input: UpdatePaymentProfileInput) {
    const existing = await this.getProfile(entityId, profileId);
    if (existing.isSystem) {
      throw new PaymentProfileServiceError(
        "SYSTEM_PROFILE",
        "System profiles cannot be modified.",
        403
      );
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.direction !== undefined) data.direction = input.direction;
    if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
    if (input.bankAccountId !== undefined) data.bankAccountId = input.bankAccountId;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.fxHandling !== undefined) data.fxHandling = input.fxHandling;
    if (input.selectionCriteria !== undefined) data.selectionCriteria = input.selectionCriteria;
    if (input.groupingRules !== undefined) data.groupingRules = input.groupingRules;
    if (input.totalPaymentLimit !== undefined) data.totalPaymentLimit = input.totalPaymentLimit;
    if (input.remittanceAdvice !== undefined) data.remittanceAdvice = input.remittanceAdvice;
    if (input.description !== undefined) data.description = input.description;

    return (this.prisma as any).paymentProfile.update({
      where: { id: profileId },
      data
    });
  }

  async deleteProfile(entityId: string, profileId: string) {
    const existing = await this.getProfile(entityId, profileId);
    if (existing.isSystem) {
      throw new PaymentProfileServiceError(
        "SYSTEM_PROFILE",
        "System profiles cannot be deleted.",
        403
      );
    }
    await (this.prisma as any).paymentProfile.update({
      where: { id: profileId },
      data: { isActive: false }
    });
  }

  // ── Apply Profile to Payment Run ────────────────────────────────────────

  /**
   * Resolves a payment profile into payment run proposal parameters.
   * The caller (proposePaymentRun) merges these with any ad-hoc overrides.
   */
  async resolveProfileCriteria(
    entityId: string,
    profileId: string
  ): Promise<{
    supplierIds?: string[];
    bankFileFormat: string;
    startDate: Date;
    endDate: Date;
    includePosted: boolean;
    includeApproved: boolean;
    profileId: string;
  }> {
    const profile = await this.getProfile(entityId, profileId);
    if (profile.direction !== "PAY") {
      throw new PaymentProfileServiceError(
        "INVALID_PROFILE_DIRECTION",
        "Only PAY profiles can be used for payment runs.",
        422
      );
    }

    const criteria = (profile.selectionCriteria ?? {}) as SelectionCriteria;

    const endDate = criteria.dueDateTo ? new Date(criteria.dueDateTo) : new Date();
    const startDate = criteria.dueDateFrom
      ? new Date(criteria.dueDateFrom)
      : new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    return {
      supplierIds: criteria.supplierIds,
      bankFileFormat:
        profile.paymentMethod === "CHEQUE"
          ? "CSV"
          : profile.paymentMethod === "BANK_TRANSFER"
            ? "SWIFT_MT103"
            : "CSV",
      startDate,
      endDate,
      includePosted: true,
      includeApproved: true,
      profileId: profile.id
    };
  }

  // ── Collection Run (AR) ─────────────────────────────────────────────────

  /**
   * Execute a collection run for AR invoices.
   * Selects outstanding AR invoices matching the profile criteria,
   * creates collection journals (DR Bank / CR AR Control) with source COLLN.
   */
  async runCollection(
    entityId: string,
    input: RunCollectionInput,
    actorId: string
  ): Promise<{
    collectedCount: number;
    totalAmount: number;
    journalId: string | null;
  }> {
    const profile = await this.getProfile(entityId, input.profileId);
    if (profile.direction !== "COLLECT") {
      throw new PaymentProfileServiceError(
        "INVALID_PROFILE_DIRECTION",
        "Only COLLECT profiles can be used for collection runs.",
        422
      );
    }

    const criteria = (profile.selectionCriteria ?? {}) as SelectionCriteria;

    // Build AR invoice query
    const where: any = {
      entityId,
      status: { in: ["POSTED", "PARTIALLY_PAID", "OVERDUE"] }
    };

    if (criteria.customerIds?.length) {
      where.customerId = { in: criteria.customerIds };
    }
    if (criteria.dueDateFrom || criteria.dueDateTo) {
      where.dueDate = {};
      if (criteria.dueDateFrom) where.dueDate.gte = new Date(criteria.dueDateFrom);
      if (criteria.dueDateTo) where.dueDate.lte = new Date(criteria.dueDateTo);
    }

    const invoices = await (this.prisma as any).aRInvoice.findMany({
      where,
      include: { customer: { select: { id: true, name: true, code: true } } },
      orderBy: { dueDate: "asc" }
    });

    if (invoices.length === 0) {
      return { collectedCount: 0, totalAmount: 0, journalId: null };
    }

    // Calculate outstanding amounts
    const lines: Array<{
      invoiceId: string;
      customerId: string;
      customerName: string;
      outstanding: number;
      currency: string;
    }> = [];

    for (const inv of invoices) {
      const outstanding = Number(inv.amount) - Number(inv.amountPaid);
      if (outstanding <= 0) continue;

      // Apply amount filters
      if (criteria.amountMin !== undefined && outstanding < criteria.amountMin) continue;
      if (criteria.amountMax !== undefined && outstanding > criteria.amountMax) continue;

      lines.push({
        invoiceId: inv.id,
        customerId: inv.customerId,
        customerName: inv.customer.name,
        outstanding,
        currency: inv.currency
      });
    }

    if (lines.length === 0) {
      return { collectedCount: 0, totalAmount: 0, journalId: null };
    }

    const totalAmount = lines.reduce((sum, l) => sum + l.outstanding, 0);

    // Check total payment limit
    if (profile.totalPaymentLimit && totalAmount > Number(profile.totalPaymentLimit)) {
      throw new PaymentProfileServiceError(
        "COLLECTION_LIMIT_EXCEEDED",
        `Total collection ${totalAmount.toFixed(2)} exceeds profile limit ${Number(profile.totalPaymentLimit).toFixed(2)}.`,
        422
      );
    }

    // Resolve entity's functional currency
    const entity = await (this.prisma as any).entity.findFirst({
      where: { id: entityId },
      select: { functionalCurrency: true }
    });
    const funcCurrency = entity?.functionalCurrency ?? "USD";

    // Find or validate accounts
    const bankAccountCode = profile.bankAccountId ?? "1200";
    const arControlCode = "1200"; // Standard AR Control

    const bankAccount = await (this.prisma as any).account.findFirst({
      where: { entityId, code: bankAccountCode, isActive: true }
    });
    const arAccount = await (this.prisma as any).account.findFirst({
      where: { entityId, code: arControlCode, isActive: true, isControlAccount: true }
    });

    if (!bankAccount || !arAccount) {
      throw new PaymentProfileServiceError(
        "COLLECTION_ACCOUNTS_MISSING",
        "Bank account or AR control account not found.",
        422
      );
    }

    // Create collection journal
    const refCounter = Date.now().toString(36).toUpperCase().slice(-6);
    const reference = `${input.referencePrefix}-${refCounter}`;

    const journalLines: Array<{
      accountId: string;
      debit: number;
      credit: number;
      currency: string;
      fxRate: number;
      debitFunctional: number;
      creditFunctional: number;
      description: string;
    }> = [];

    // DR Bank (total collected)
    journalLines.push({
      accountId: bankAccount.id,
      debit: totalAmount,
      credit: 0,
      currency: funcCurrency,
      fxRate: 1,
      debitFunctional: totalAmount,
      creditFunctional: 0,
      description: `Collection run — ${lines.length} invoices`
    });

    // CR AR Control per customer (grouped)
    const byCustomer = new Map<string, { name: string; total: number }>();
    for (const line of lines) {
      const existing = byCustomer.get(line.customerId) ?? { name: line.customerName, total: 0 };
      existing.total += line.outstanding;
      byCustomer.set(line.customerId, existing);
    }

    for (const [customerId, data] of byCustomer) {
      journalLines.push({
        accountId: arAccount.id,
        debit: 0,
        credit: data.total,
        currency: funcCurrency,
        fxRate: 1,
        debitFunctional: 0,
        creditFunctional: data.total,
        description: `Collection from ${data.name}`
      });
    }

    const journal = await (this.prisma as any).journal.create({
      data: {
        entityId,
        periodId: input.periodId,
        reference,
        description: `AR Collection Run — ${lines.length} invoices, ${totalAmount.toFixed(2)} ${funcCurrency}`,
        source: "COLLN",
        status: "POSTED",
        postedAt: new Date(),
        functionalCurrency: funcCurrency,
        createdById: actorId,
        lines: {
          create: journalLines.map((jl) => ({
            accountId: jl.accountId,
            debit: jl.debit,
            credit: jl.credit,
            currency: jl.currency,
            fxRate: jl.fxRate,
            debitFunctional: jl.debitFunctional,
            creditFunctional: jl.creditFunctional,
            description: jl.description
          }))
        }
      }
    });

    // Update AR invoice statuses — mark paid amounts
    for (const line of lines) {
      await (this.prisma as any).aRInvoice.update({
        where: { id: line.invoiceId },
        data: {
          amountPaid: { increment: line.outstanding },
          status: "PAID"
        }
      });
    }

    return {
      collectedCount: lines.length,
      totalAmount,
      journalId: journal.id
    };
  }
}
