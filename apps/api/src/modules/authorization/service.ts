import { Prisma, type PrismaClient } from "../../db/client.js";
import { GLRepository } from "../gl/repository.js";

import { ServiceError } from "../../shared/service-error.js";

// ── Error ────────────────────────────────────────────────────────────────────

export class AuthorizationServiceError extends ServiceError {}

// ── Types ────────────────────────────────────────────────────────────────────

export type AuthorizationQueueItem = {
  journalId: string;
  reference: string | null;
  description: string | null;
  source: string;
  journalAmount: number;
  status: string;
  createdById: string;
  createdAt: Date;
  currentStageOrder: number;
  stageName: string;
  stageCode: string;
};

export type AuthorizationHistoryEntry = {
  stageCode: string;
  stageName: string;
  stageOrder: number;
  status: string;
  decidedById: string | null;
  decidedByName: string | null;
  rejectionCode: string | null;
  comments: string | null;
  decidedAt: Date | null;
};

// ── Service ──────────────────────────────────────────────────────────────────

export class AuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Stage CRUD ──────────────────────────────────────────────────────────

  async createStage(entityId: string, input: any) {
    const existing = await (this.prisma as any).authorizationStage.findFirst({
      where: { entityId, stageCode: input.stageCode }
    });
    if (existing) {
      throw new AuthorizationServiceError(
        "AUTH_STAGE_DUPLICATE",
        `Authorization stage "${input.stageCode}" already exists.`,
        409
      );
    }

    // Verify team exists
    const team = await (this.prisma as any).authorizationTeam.findFirst({
      where: { id: input.userTeamId, entityId }
    });
    if (!team) {
      throw new AuthorizationServiceError(
        "AUTH_TEAM_NOT_FOUND",
        "Referenced user team not found.",
        404
      );
    }

    return (this.prisma as any).authorizationStage.create({
      data: {
        entityId,
        stageCode: input.stageCode,
        stageName: input.stageName,
        stageOrder: input.stageOrder,
        requiredApprovers: input.requiredApprovers ?? 1,
        autoAdvance: input.autoAdvance ?? true,
        rejectionReturnsTo: input.rejectionReturnsTo ?? "ORIGINATOR",
        returnToStageId: input.returnToStageId ?? null,
        journalTypeId: input.journalTypeId ?? null,
        amountThreshold: input.amountThreshold ?? null,
        userTeamId: input.userTeamId,
        isActive: input.isActive ?? true
      },
      include: { userTeam: true, journalType: true }
    });
  }

  async listStages(entityId: string, journalTypeId?: string) {
    const where: any = { entityId };
    if (journalTypeId !== undefined) {
      where.journalTypeId = journalTypeId;
    }
    return (this.prisma as any).authorizationStage.findMany({
      where,
      include: { userTeam: true, journalType: true },
      orderBy: [{ journalTypeId: "asc" }, { stageOrder: "asc" }]
    });
  }

  async updateStage(entityId: string, id: string, input: any) {
    const existing = await (this.prisma as any).authorizationStage.findFirst({
      where: { id, entityId }
    });
    if (!existing) {
      throw new AuthorizationServiceError("AUTH_STAGE_NOT_FOUND", "Stage not found.", 404);
    }

    const data: any = {};
    if (input.stageName !== undefined) data.stageName = input.stageName;
    if (input.stageOrder !== undefined) data.stageOrder = input.stageOrder;
    if (input.requiredApprovers !== undefined) data.requiredApprovers = input.requiredApprovers;
    if (input.autoAdvance !== undefined) data.autoAdvance = input.autoAdvance;
    if (input.rejectionReturnsTo !== undefined) data.rejectionReturnsTo = input.rejectionReturnsTo;
    if (input.returnToStageId !== undefined) data.returnToStageId = input.returnToStageId;
    if (input.journalTypeId !== undefined) data.journalTypeId = input.journalTypeId;
    if (input.amountThreshold !== undefined) data.amountThreshold = input.amountThreshold;
    if (input.userTeamId !== undefined) data.userTeamId = input.userTeamId;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return (this.prisma as any).authorizationStage.update({
      where: { id },
      data,
      include: { userTeam: true, journalType: true }
    });
  }

  async deleteStage(entityId: string, id: string) {
    const existing = await (this.prisma as any).authorizationStage.findFirst({
      where: { id, entityId }
    });
    if (!existing) {
      throw new AuthorizationServiceError("AUTH_STAGE_NOT_FOUND", "Stage not found.", 404);
    }

    // Check for active journal authorizations using this stage
    const activeAuths = await (this.prisma as any).journalAuthorization.count({
      where: { stageId: id, status: "PENDING" }
    });
    if (activeAuths > 0) {
      throw new AuthorizationServiceError(
        "AUTH_STAGE_IN_USE",
        "Cannot delete stage with pending authorizations.",
        409
      );
    }

    return (this.prisma as any).authorizationStage.delete({ where: { id } });
  }

  // ── Team CRUD ───────────────────────────────────────────────────────────

  async createTeam(entityId: string, input: any) {
    const existing = await (this.prisma as any).authorizationTeam.findFirst({
      where: { entityId, code: input.code }
    });
    if (existing) {
      throw new AuthorizationServiceError(
        "AUTH_TEAM_DUPLICATE",
        `Authorization team "${input.code}" already exists.`,
        409
      );
    }

    return this.prisma.$transaction(async (tx: any) => {
      const team = await tx.authorizationTeam.create({
        data: {
          entityId,
          code: input.code,
          name: input.name,
          isActive: input.isActive ?? true
        }
      });

      if (input.memberIds?.length > 0) {
        await tx.authorizationTeamMember.createMany({
          data: input.memberIds.map((userId: string) => ({
            teamId: team.id,
            userId
          }))
        });
      }

      return tx.authorizationTeam.findFirst({
        where: { id: team.id },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } }
        }
      });
    });
  }

  async listTeams(entityId: string) {
    return (this.prisma as any).authorizationTeam.findMany({
      where: { entityId },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } }
      },
      orderBy: { name: "asc" }
    });
  }

  async updateTeam(entityId: string, id: string, input: any) {
    const existing = await (this.prisma as any).authorizationTeam.findFirst({
      where: { id, entityId }
    });
    if (!existing) {
      throw new AuthorizationServiceError("AUTH_TEAM_NOT_FOUND", "Team not found.", 404);
    }

    return this.prisma.$transaction(async (tx: any) => {
      const data: any = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      if (Object.keys(data).length > 0) {
        await tx.authorizationTeam.update({ where: { id }, data });
      }

      // Replace members if provided
      if (input.memberIds !== undefined) {
        await tx.authorizationTeamMember.deleteMany({ where: { teamId: id } });
        if (input.memberIds.length > 0) {
          await tx.authorizationTeamMember.createMany({
            data: input.memberIds.map((userId: string) => ({
              teamId: id,
              userId
            }))
          });
        }
      }

      return tx.authorizationTeam.findFirst({
        where: { id },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } }
        }
      });
    });
  }

  async deleteTeam(entityId: string, id: string) {
    const existing = await (this.prisma as any).authorizationTeam.findFirst({
      where: { id, entityId }
    });
    if (!existing) {
      throw new AuthorizationServiceError("AUTH_TEAM_NOT_FOUND", "Team not found.", 404);
    }

    // Check if team is referenced by active stages
    const stageCount = await (this.prisma as any).authorizationStage.count({
      where: { userTeamId: id, isActive: true }
    });
    if (stageCount > 0) {
      throw new AuthorizationServiceError(
        "AUTH_TEAM_IN_USE",
        "Cannot delete team assigned to active authorization stages.",
        409
      );
    }

    return this.prisma.$transaction(async (tx: any) => {
      await tx.authorizationTeamMember.deleteMany({ where: { teamId: id } });
      return tx.authorizationTeam.delete({ where: { id } });
    });
  }

  // ── Delegation CRUD ─────────────────────────────────────────────────────

  async createDelegation(entityId: string, input: any) {
    return (this.prisma as any).authorizationDelegation.create({
      data: {
        entityId,
        delegatorId: input.delegatorId,
        delegateId: input.delegateId,
        teamId: input.teamId,
        validFrom: new Date(input.validFrom),
        validTo: new Date(input.validTo),
        isActive: true
      },
      include: {
        delegator: { select: { id: true, name: true, email: true } },
        delegate: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, code: true, name: true } }
      }
    });
  }

  async listDelegations(entityId: string) {
    return (this.prisma as any).authorizationDelegation.findMany({
      where: { entityId },
      include: {
        delegator: { select: { id: true, name: true, email: true } },
        delegate: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, code: true, name: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async revokeDelegation(entityId: string, id: string) {
    const existing = await (this.prisma as any).authorizationDelegation.findFirst({
      where: { id, entityId }
    });
    if (!existing) {
      throw new AuthorizationServiceError(
        "AUTH_DELEGATION_NOT_FOUND",
        "Delegation not found.",
        404
      );
    }

    return (this.prisma as any).authorizationDelegation.update({
      where: { id },
      data: { isActive: false }
    });
  }

  // ── Rejection Code CRUD ─────────────────────────────────────────────────

  async createRejectionCode(entityId: string, input: any) {
    const existing = await (this.prisma as any).rejectionCode.findFirst({
      where: { entityId, code: input.code }
    });
    if (existing) {
      throw new AuthorizationServiceError(
        "AUTH_REJECTION_CODE_DUPLICATE",
        `Rejection code "${input.code}" already exists.`,
        409
      );
    }

    return (this.prisma as any).rejectionCode.create({
      data: {
        entityId,
        code: input.code,
        description: input.description,
        isActive: input.isActive ?? true
      }
    });
  }

  async listRejectionCodes(entityId: string) {
    return (this.prisma as any).rejectionCode.findMany({
      where: { entityId },
      orderBy: { code: "asc" }
    });
  }

  // ── Authorization Set Management ────────────────────────────────────────

  async createSet(entityId: string, userId: string, input: any) {
    return (this.prisma as any).authorizationSet.create({
      data: {
        entityId,
        name: input.name,
        status: "OPEN",
        createdById: userId
      }
    });
  }

  async listSets(entityId: string) {
    return (this.prisma as any).authorizationSet.findMany({
      where: { entityId },
      include: { _count: { select: { journals: true } } },
      orderBy: { createdAt: "desc" }
    });
  }

  async addJournalsToSet(entityId: string, setId: string, journalIds: string[]) {
    const set = await (this.prisma as any).authorizationSet.findFirst({
      where: { id: setId, entityId }
    });
    if (!set) {
      throw new AuthorizationServiceError(
        "AUTH_SET_NOT_FOUND",
        "Authorization set not found.",
        404
      );
    }
    if (set.status !== "OPEN") {
      throw new AuthorizationServiceError(
        "AUTH_SET_NOT_OPEN",
        "Can only add journals to OPEN sets.",
        409
      );
    }

    // Update journals to reference this set
    await (this.prisma as any).journal.updateMany({
      where: { id: { in: journalIds }, entityId },
      data: { authorizationSetId: setId }
    });

    return (this.prisma as any).authorizationSet.findFirst({
      where: { id: setId },
      include: { journals: { select: { id: true, reference: true, status: true } } }
    });
  }

  async approveSet(entityId: string, setId: string, userId: string, comments?: string) {
    const set = await (this.prisma as any).authorizationSet.findFirst({
      where: { id: setId, entityId },
      include: { journals: true }
    });
    if (!set) {
      throw new AuthorizationServiceError(
        "AUTH_SET_NOT_FOUND",
        "Authorization set not found.",
        404
      );
    }

    const results: any[] = [];
    for (const journal of set.journals) {
      if (journal.status === "PENDING_APPROVAL") {
        try {
          const result = await this.approveStage(entityId, journal.id, userId, comments);
          results.push({ journalId: journal.id, status: "approved", result });
        } catch (error) {
          results.push({
            journalId: journal.id,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    }

    // Update set status based on results
    const allApproved = results.every((r) => r.status === "approved");
    await (this.prisma as any).authorizationSet.update({
      where: { id: setId },
      data: { status: allApproved ? "APPROVED" : "SUBMITTED" }
    });

    return results;
  }

  async rejectSet(
    entityId: string,
    setId: string,
    userId: string,
    rejectionCodeId: string,
    comments?: string
  ) {
    const set = await (this.prisma as any).authorizationSet.findFirst({
      where: { id: setId, entityId },
      include: { journals: true }
    });
    if (!set) {
      throw new AuthorizationServiceError(
        "AUTH_SET_NOT_FOUND",
        "Authorization set not found.",
        404
      );
    }

    const results: any[] = [];
    for (const journal of set.journals) {
      if (journal.status === "PENDING_APPROVAL") {
        try {
          const result = await this.rejectStage(
            entityId,
            journal.id,
            userId,
            rejectionCodeId,
            comments
          );
          results.push({ journalId: journal.id, status: "rejected", result });
        } catch (error) {
          results.push({
            journalId: journal.id,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    }

    await (this.prisma as any).authorizationSet.update({
      where: { id: setId },
      data: { status: "REJECTED" }
    });

    return results;
  }

  // ── Core Workflow Engine ─────────────────────────────────────────────────

  /**
   * Resolve applicable authorization stages for a journal.
   * Priority: journal-type-specific stages > global stages.
   * Filters by amount threshold if set.
   */
  async resolveStages(entityId: string, journalTypeId: string | null, journalAmount: number) {
    // First try journal-type-specific stages
    if (journalTypeId) {
      const typeStages = await (this.prisma as any).authorizationStage.findMany({
        where: {
          entityId,
          journalTypeId,
          isActive: true,
          OR: [{ amountThreshold: null }, { amountThreshold: { lte: journalAmount } }]
        },
        orderBy: { stageOrder: "asc" }
      });
      if (typeStages.length > 0) return typeStages;
    }

    // Fall back to global stages (journalTypeId = null)
    return (this.prisma as any).authorizationStage.findMany({
      where: {
        entityId,
        journalTypeId: null,
        isActive: true,
        OR: [{ amountThreshold: null }, { amountThreshold: { lte: journalAmount } }]
      },
      orderBy: { stageOrder: "asc" }
    });
  }

  /**
   * Submit a journal for multi-stage authorization.
   * Creates JournalAuthorization rows for each stage and sets journal to PENDING_APPROVAL.
   */
  async submitForAuthorization(entityId: string, journalId: string) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId, entityId },
      include: { lines: true }
    });
    if (!journal) {
      throw new AuthorizationServiceError("AUTH_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }

    // Calculate journal amount (sum of debits)
    const journalAmount = journal.lines.reduce(
      (sum: number, l: any) => sum + Math.abs(Number(l.debitFunctional ?? l.debit ?? 0)),
      0
    );

    const stages = await this.resolveStages(entityId, journal.journalTypeId, journalAmount);
    if (stages.length === 0) {
      // No authorization required — leave journal in current state
      return { required: false, stageCount: 0 };
    }

    await this.prisma.$transaction(async (tx: any) => {
      // Create authorization entries for each stage
      for (const stage of stages) {
        await tx.journalAuthorization.create({
          data: {
            entityId,
            journalId,
            stageId: stage.id,
            stageOrder: stage.stageOrder,
            status: "PENDING"
          }
        });
      }

      // Set journal to PENDING_APPROVAL at stage 1
      await tx.journal.update({
        where: { id: journalId },
        data: {
          status: "PENDING_APPROVAL",
          currentAuthStageOrder: stages[0].stageOrder
        }
      });
    });

    return { required: true, stageCount: stages.length, firstStageOrder: stages[0].stageOrder };
  }

  /**
   * Check if a user is authorized to act on a team's behalf
   * (either direct member or active delegation).
   */
  async isUserAuthorizedForTeam(
    entityId: string,
    userId: string,
    teamId: string
  ): Promise<boolean> {
    // Direct membership
    const membership = await (this.prisma as any).authorizationTeamMember.findFirst({
      where: { teamId, userId }
    });
    if (membership) return true;

    // Delegation — active delegation where delegate = userId, for this team, within valid dates
    const today = new Date();
    const delegation = await (this.prisma as any).authorizationDelegation.findFirst({
      where: {
        entityId,
        delegateId: userId,
        teamId,
        isActive: true,
        validFrom: { lte: today },
        validTo: { gte: today }
      }
    });
    return !!delegation;
  }

  /**
   * Approve the current stage of a journal's authorization workflow.
   */
  async approveStage(entityId: string, journalId: string, userId: string, comments?: string) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId, entityId }
    });
    if (!journal) {
      throw new AuthorizationServiceError("AUTH_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }
    if (journal.status !== "PENDING_APPROVAL") {
      throw new AuthorizationServiceError(
        "AUTH_NOT_PENDING",
        "Journal is not pending approval.",
        409
      );
    }

    const currentStageOrder = journal.currentAuthStageOrder;
    if (currentStageOrder == null) {
      throw new AuthorizationServiceError(
        "AUTH_NO_STAGE",
        "Journal has no active authorization stage.",
        409
      );
    }

    // Get the current stage authorization record
    const authRecord = await (this.prisma as any).journalAuthorization.findFirst({
      where: { journalId, stageOrder: currentStageOrder, status: "PENDING" },
      include: { stage: true }
    });
    if (!authRecord) {
      throw new AuthorizationServiceError(
        "AUTH_STAGE_NOT_PENDING",
        "No pending authorization at this stage.",
        409
      );
    }

    // Verify user is authorized for this stage's team
    const authorized = await this.isUserAuthorizedForTeam(
      entityId,
      userId,
      authRecord.stage.userTeamId
    );
    if (!authorized) {
      throw new AuthorizationServiceError(
        "AUTH_NOT_AUTHORIZED",
        "You are not authorized to approve at this stage.",
        403
      );
    }

    // Record approval
    await (this.prisma as any).journalAuthorization.update({
      where: { id: authRecord.id },
      data: {
        status: "APPROVED",
        decidedById: userId,
        comments: comments ?? null,
        decidedAt: new Date()
      }
    });

    // Check if there's a next stage
    const allStages = await (this.prisma as any).journalAuthorization.findMany({
      where: { journalId },
      orderBy: { stageOrder: "asc" }
    });

    const currentIndex = allStages.findIndex((s: any) => s.stageOrder === currentStageOrder);
    const nextStage = allStages[currentIndex + 1];

    if (nextStage) {
      // Advance to next stage
      await (this.prisma as any).journal.update({
        where: { id: journalId },
        data: { currentAuthStageOrder: nextStage.stageOrder }
      });

      return { action: "advanced", nextStageOrder: nextStage.stageOrder };
    }

    // Final stage approved — post the journal
    await this._postJournalInternal(entityId, journalId, userId);
    return { action: "posted" };
  }

  /**
   * Reject the current stage of a journal's authorization workflow.
   */
  async rejectStage(
    entityId: string,
    journalId: string,
    userId: string,
    rejectionCodeId: string,
    comments?: string
  ) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId, entityId }
    });
    if (!journal) {
      throw new AuthorizationServiceError("AUTH_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }
    if (journal.status !== "PENDING_APPROVAL") {
      throw new AuthorizationServiceError(
        "AUTH_NOT_PENDING",
        "Journal is not pending approval.",
        409
      );
    }

    const currentStageOrder = journal.currentAuthStageOrder;
    const authRecord = await (this.prisma as any).journalAuthorization.findFirst({
      where: { journalId, stageOrder: currentStageOrder, status: "PENDING" },
      include: { stage: true }
    });
    if (!authRecord) {
      throw new AuthorizationServiceError(
        "AUTH_STAGE_NOT_PENDING",
        "No pending authorization at this stage.",
        409
      );
    }

    // Verify user is authorized
    const authorized = await this.isUserAuthorizedForTeam(
      entityId,
      userId,
      authRecord.stage.userTeamId
    );
    if (!authorized) {
      throw new AuthorizationServiceError(
        "AUTH_NOT_AUTHORIZED",
        "You are not authorized to reject at this stage.",
        403
      );
    }

    // Record rejection
    await (this.prisma as any).journalAuthorization.update({
      where: { id: authRecord.id },
      data: {
        status: "REJECTED",
        decidedById: userId,
        rejectionCodeId,
        comments: comments ?? null,
        decidedAt: new Date()
      }
    });

    // Determine where the journal returns to based on stage config
    const returnsTo = authRecord.stage.rejectionReturnsTo;

    if (returnsTo === "ORIGINATOR") {
      await (this.prisma as any).journal.update({
        where: { id: journalId },
        data: { status: "RETURNED", currentAuthStageOrder: null }
      });
      return { action: "returned_to_originator" };
    }

    if (returnsTo === "PREVIOUS_STAGE") {
      const allStages = await (this.prisma as any).journalAuthorization.findMany({
        where: { journalId },
        orderBy: { stageOrder: "asc" }
      });
      const currentIndex = allStages.findIndex((s: any) => s.stageOrder === currentStageOrder);
      const prevStage = allStages[currentIndex - 1];

      if (prevStage) {
        // Reset previous stage to PENDING
        await (this.prisma as any).journalAuthorization.update({
          where: { id: prevStage.id },
          data: { status: "PENDING", decidedById: null, decidedAt: null, comments: null }
        });
        await (this.prisma as any).journal.update({
          where: { id: journalId },
          data: { currentAuthStageOrder: prevStage.stageOrder }
        });
        return { action: "returned_to_previous_stage", stageOrder: prevStage.stageOrder };
      }

      // No previous stage — return to originator
      await (this.prisma as any).journal.update({
        where: { id: journalId },
        data: { status: "RETURNED", currentAuthStageOrder: null }
      });
      return { action: "returned_to_originator" };
    }

    if (returnsTo === "SPECIFIC_STAGE" && authRecord.stage.returnToStageId) {
      const targetAuth = await (this.prisma as any).journalAuthorization.findFirst({
        where: { journalId, stageId: authRecord.stage.returnToStageId }
      });
      if (targetAuth) {
        await (this.prisma as any).journalAuthorization.update({
          where: { id: targetAuth.id },
          data: { status: "PENDING", decidedById: null, decidedAt: null, comments: null }
        });
        await (this.prisma as any).journal.update({
          where: { id: journalId },
          data: { currentAuthStageOrder: targetAuth.stageOrder }
        });
        return { action: "returned_to_specific_stage", stageOrder: targetAuth.stageOrder };
      }
    }

    // Fallback: return to originator
    await (this.prisma as any).journal.update({
      where: { id: journalId },
      data: { status: "RETURNED", currentAuthStageOrder: null }
    });
    return { action: "returned_to_originator" };
  }

  /**
   * Return a journal for amendment (used by authorizer without specific rejection).
   */
  async returnForAmendment(entityId: string, journalId: string, userId: string, comments?: string) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId, entityId }
    });
    if (!journal) {
      throw new AuthorizationServiceError("AUTH_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }
    if (journal.status !== "PENDING_APPROVAL") {
      throw new AuthorizationServiceError(
        "AUTH_NOT_PENDING",
        "Journal is not pending approval.",
        409
      );
    }

    // Mark current stage as rejected with a "return" comment
    const authRecord = await (this.prisma as any).journalAuthorization.findFirst({
      where: { journalId, stageOrder: journal.currentAuthStageOrder, status: "PENDING" }
    });
    if (authRecord) {
      await (this.prisma as any).journalAuthorization.update({
        where: { id: authRecord.id },
        data: {
          status: "REJECTED",
          decidedById: userId,
          comments: comments ? `[RETURNED] ${comments}` : "[RETURNED FOR AMENDMENT]",
          decidedAt: new Date()
        }
      });
    }

    await (this.prisma as any).journal.update({
      where: { id: journalId },
      data: { status: "RETURNED", currentAuthStageOrder: null }
    });

    return { action: "returned_for_amendment" };
  }

  /**
   * Void a journal — permanently kill it, cannot be resubmitted.
   */
  async voidJournal(entityId: string, journalId: string, userId: string, comments?: string) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId, entityId }
    });
    if (!journal) {
      throw new AuthorizationServiceError("AUTH_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }
    if (journal.status === "POSTED" || journal.status === "REVERSED") {
      throw new AuthorizationServiceError(
        "AUTH_CANNOT_VOID",
        "Cannot void a posted or reversed journal.",
        409
      );
    }
    if (journal.status === "VOIDED") {
      throw new AuthorizationServiceError("AUTH_ALREADY_VOIDED", "Journal is already voided.", 409);
    }

    // Mark all pending authorizations as SKIPPED
    await (this.prisma as any).journalAuthorization.updateMany({
      where: { journalId, status: "PENDING" },
      data: { status: "SKIPPED" }
    });

    await (this.prisma as any).journal.update({
      where: { id: journalId },
      data: { status: "VOIDED", currentAuthStageOrder: null }
    });

    return { action: "voided" };
  }

  /**
   * Resubmit a RETURNED journal — resets all stages and restarts authorization.
   */
  async resubmit(entityId: string, journalId: string, userId: string) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId, entityId }
    });
    if (!journal) {
      throw new AuthorizationServiceError("AUTH_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }
    if (journal.status !== "RETURNED") {
      throw new AuthorizationServiceError(
        "AUTH_NOT_RETURNED",
        "Only RETURNED journals can be resubmitted.",
        409
      );
    }

    // Reset all authorization records
    const existingAuths = await (this.prisma as any).journalAuthorization.findMany({
      where: { journalId },
      orderBy: { stageOrder: "asc" }
    });

    if (existingAuths.length === 0) {
      throw new AuthorizationServiceError(
        "AUTH_NO_STAGES",
        "No authorization stages found for this journal.",
        409
      );
    }

    await this.prisma.$transaction(async (tx: any) => {
      // Reset all stage decisions
      for (const auth of existingAuths) {
        await tx.journalAuthorization.update({
          where: { id: auth.id },
          data: {
            status: "PENDING",
            decidedById: null,
            rejectionCodeId: null,
            comments: null,
            decidedAt: null
          }
        });
      }

      // Restart at stage 1
      await tx.journal.update({
        where: { id: journalId },
        data: {
          status: "PENDING_APPROVAL",
          currentAuthStageOrder: existingAuths[0].stageOrder
        }
      });
    });

    return { action: "resubmitted", stageCount: existingAuths.length };
  }

  /**
   * Check if a journal has completed all authorization stages.
   */
  async isFullyAuthorized(journalId: string): Promise<boolean> {
    const authorizations = await (this.prisma as any).journalAuthorization.findMany({
      where: { journalId }
    });

    if (authorizations.length === 0) return true; // No stages = no auth required

    return authorizations.every((a: any) => a.status === "APPROVED" || a.status === "SKIPPED");
  }

  // ── Authorization Queue ─────────────────────────────────────────────────

  /**
   * Get journals pending the current user's approval.
   * Returns journals where the current stage's team includes the user (or delegation).
   */
  async getAuthorizationQueue(
    entityId: string,
    userId: string,
    filters?: {
      journalTypeId?: string;
      minAmount?: number;
      maxAmount?: number;
      createdById?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<AuthorizationQueueItem[]> {
    // Get teams the user belongs to (direct + delegation)
    const directTeams = await (this.prisma as any).authorizationTeamMember.findMany({
      where: { userId },
      select: { teamId: true }
    });

    const today = new Date();
    const delegatedTeams = await (this.prisma as any).authorizationDelegation.findMany({
      where: {
        entityId,
        delegateId: userId,
        isActive: true,
        validFrom: { lte: today },
        validTo: { gte: today }
      },
      select: { teamId: true }
    });

    const teamIds = [
      ...new Set([
        ...directTeams.map((t: any) => t.teamId),
        ...delegatedTeams.map((t: any) => t.teamId)
      ])
    ];

    if (teamIds.length === 0) return [];

    // Get stages that belong to these teams
    const stages = await (this.prisma as any).authorizationStage.findMany({
      where: { entityId, userTeamId: { in: teamIds }, isActive: true },
      select: { id: true, stageOrder: true, stageCode: true, stageName: true }
    });

    if (stages.length === 0) return [];

    const stageMap = new Map(stages.map((s: any) => [s.id, s]));
    const stageIds = stages.map((s: any) => s.id);

    // Find pending journal authorizations at these stages
    const pendingAuths = await (this.prisma as any).journalAuthorization.findMany({
      where: {
        entityId,
        stageId: { in: stageIds },
        status: "PENDING"
      },
      include: {
        journal: {
          include: {
            lines: { select: { debitFunctional: true } }
          }
        }
      }
    });

    // Filter: only journals where currentAuthStageOrder matches this auth's stageOrder
    const queueItems: AuthorizationQueueItem[] = [];

    for (const auth of pendingAuths) {
      const journal = auth.journal;
      if (!journal || journal.status !== "PENDING_APPROVAL") continue;
      if (journal.currentAuthStageOrder !== auth.stageOrder) continue;

      const amount = journal.lines.reduce(
        (sum: number, l: any) => sum + Math.abs(Number(l.debitFunctional ?? 0)),
        0
      );

      // Apply filters
      if (filters?.journalTypeId && journal.journalTypeId !== filters.journalTypeId) continue;
      if (filters?.minAmount !== undefined && amount < filters.minAmount) continue;
      if (filters?.maxAmount !== undefined && amount > filters.maxAmount) continue;
      if (filters?.createdById && journal.createdById !== filters.createdById) continue;
      if (filters?.dateFrom && journal.createdAt < new Date(filters.dateFrom)) continue;
      if (filters?.dateTo && journal.createdAt > new Date(filters.dateTo)) continue;

      const stage: any = stageMap.get(auth.stageId);
      queueItems.push({
        journalId: journal.id,
        reference: journal.reference,
        description: journal.description,
        source: journal.source,
        journalAmount: amount,
        status: journal.status,
        createdById: journal.createdById,
        createdAt: journal.createdAt,
        currentStageOrder: auth.stageOrder,
        stageName: stage?.stageName ?? "",
        stageCode: stage?.stageCode ?? ""
      });
    }

    return queueItems;
  }

  /**
   * Get authorization history for a journal.
   */
  async getHistory(entityId: string, journalId: string): Promise<AuthorizationHistoryEntry[]> {
    const authorizations = await (this.prisma as any).journalAuthorization.findMany({
      where: { journalId, entityId },
      include: {
        stage: { select: { stageCode: true, stageName: true } },
        decidedBy: { select: { name: true } },
        rejectionCode: { select: { code: true } }
      },
      orderBy: { stageOrder: "asc" }
    });

    return authorizations.map((a: any) => ({
      stageCode: a.stage.stageCode,
      stageName: a.stage.stageName,
      stageOrder: a.stageOrder,
      status: a.status,
      decidedById: a.decidedById,
      decidedByName: a.decidedBy?.name ?? null,
      rejectionCode: a.rejectionCode?.code ?? null,
      comments: a.comments,
      decidedAt: a.decidedAt
    }));
  }

  /**
   * Bulk approve multiple journals.
   */
  async bulkApprove(entityId: string, journalIds: string[], userId: string, comments?: string) {
    const results: any[] = [];
    for (const journalId of journalIds) {
      try {
        const result = await this.approveStage(entityId, journalId, userId, comments);
        results.push({ journalId, status: "approved", ...result });
      } catch (error) {
        results.push({
          journalId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
    return results;
  }

  /**
   * Bulk reject multiple journals.
   */
  async bulkReject(
    entityId: string,
    journalIds: string[],
    userId: string,
    rejectionCodeId: string,
    comments?: string
  ) {
    const results: any[] = [];
    for (const journalId of journalIds) {
      try {
        const result = await this.rejectStage(
          entityId,
          journalId,
          userId,
          rejectionCodeId,
          comments
        );
        results.push({ journalId, status: "rejected", ...result });
      } catch (error) {
        results.push({
          journalId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
    return results;
  }

  // ── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Post a journal internally after final authorization stage is approved.
   * Updates account balances and sets status to POSTED.
   */
  private async _postJournalInternal(entityId: string, journalId: string, approvedById: string) {
    const journal = await (this.prisma as any).journal.findFirst({
      where: { id: journalId },
      include: {
        lines: {
          include: { account: { select: { type: true } } }
        }
      }
    });
    if (!journal) return;

    await this.prisma.$transaction(async (tx: any) => {
      const repo = new GLRepository(tx);

      // Update account balances using the canonical GL method (SQL-level Decimal arithmetic)
      for (const line of journal.lines) {
        await repo.updateAccountBalance(
          entityId,
          line.accountId,
          journal.periodId,
          new Prisma.Decimal(line.debitFunctional),
          new Prisma.Decimal(line.creditFunctional),
          line.account.type
        );
      }

      // Set journal to POSTED
      await tx.journal.update({
        where: { id: journalId },
        data: {
          status: "POSTED",
          approvedById,
          postedAt: new Date(),
          currentAuthStageOrder: null
        }
      });
    });
  }
}
