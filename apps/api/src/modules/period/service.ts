import type { PrismaClient } from "../../db/client.js";
import { enqueueMVRefresh } from "../../jobs/mv-refresh-job.js";
import { ProcessLockService, ProcessLockError } from "../process-lock/service.js";
import { carryForwardOpeningBalances, findFollowingPeriodId } from "./carry-forward.js";
import type { PeriodListQuery, PeriodCreateInput } from "./types.js";

import { ServiceError } from "../../shared/service-error.js";

export class PeriodServiceError extends ServiceError {}

export class PeriodService {
  private readonly lockService: ProcessLockService;

  constructor(private readonly prisma: PrismaClient) {
    this.lockService = new ProcessLockService(prisma);
  }

  async createPeriod(entityId: string, input: PeriodCreateInput) {
    const existing = await this.prisma.period.findFirst({
      where: { entityId, year: input.year, month: input.month }
    });

    if (existing) {
      throw new PeriodServiceError(
        "PERIOD_DUPLICATE",
        `A period for ${input.year}-${String(input.month).padStart(2, "0")} already exists.`,
        409
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const period = await tx.period.create({
        data: {
          entityId,
          year: input.year,
          month: input.month,
          name: input.name,
          status: "OPEN",
          openedAt: new Date()
        }
      });

      // Seed opening balances from the preceding period so the new period does
      // not start life showing every account at zero. Re-run authoritatively
      // when the preceding period is closed, since its closing balances can
      // still change until then.
      await carryForwardOpeningBalances(tx, entityId, period.id);

      return period;
    });
  }

  listPeriods(entityId: string, query: PeriodListQuery) {
    return this.prisma.period.findMany({
      where: {
        entityId,
        year: query.year,
        status: query.status
      },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
  }

  /**
   * Soft-close a period: OPEN → SOFT_CLOSE.
   *
   * Validates that no DRAFT or PENDING_APPROVAL journals remain. After soft-close,
   * period-end processes (revaluation, depreciation, allocations) can run, but
   * normal posting is blocked.
   */
  async softClosePeriod(entityId: string, periodId: string, closedBy: string) {
    let lock;
    try {
      lock = await this.lockService.acquireLock({
        entityId,
        processType: "PERIOD_CLOSE",
        userId: closedBy,
        timeoutMinutes: 10
      });
    } catch (error) {
      if (error instanceof ProcessLockError && error.code === "LOCK_HELD") {
        throw new PeriodServiceError(
          "PERIOD_CLOSE_LOCKED",
          "Another period close operation is already in progress.",
          409
        );
      }
      throw error;
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const [period] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM periods
          WHERE id = ${periodId} AND entity_id = ${entityId}
          FOR UPDATE
        `;

        if (!period) {
          throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
        }

        if (period.status !== "OPEN") {
          throw new PeriodServiceError(
            "PERIOD_NOT_OPEN",
            "Only OPEN periods can be soft-closed.",
            409
          );
        }

        // Validate no draft journals
        const draftCount = await tx.journal.count({
          where: { entityId, periodId, status: "DRAFT" }
        });
        if (draftCount > 0) {
          throw new PeriodServiceError(
            "DRAFT_JOURNALS_EXIST",
            `Cannot close period: ${draftCount} draft journal(s) must be posted or deleted first.`,
            409
          );
        }

        // Validate no pending approval journals
        const pendingCount = await tx.journal.count({
          where: { entityId, periodId, status: "PENDING_APPROVAL" }
        });
        if (pendingCount > 0) {
          throw new PeriodServiceError(
            "PENDING_JOURNALS_EXIST",
            `Cannot close period: ${pendingCount} journal(s) pending approval.`,
            409
          );
        }

        // Create or update PeriodCloseStatus
        const existingPcs = await (tx as any).periodCloseStatus.findFirst({
          where: { entityId, periodId, ledger: "A" }
        });
        if (existingPcs) {
          await (tx as any).periodCloseStatus.update({
            where: { id: existingPcs.id },
            data: { status: "SOFT_CLOSE", closedById: closedBy }
          });
        } else {
          await (tx as any).periodCloseStatus.create({
            data: {
              entityId,
              periodId,
              ledger: "A",
              status: "SOFT_CLOSE",
              closedById: closedBy
            }
          });
        }

        return tx.period.update({
          where: { id: periodId },
          data: { status: "SOFT_CLOSE" }
        });
      });

      return updated;
    } finally {
      await this.lockService.releaseLock({ entityId, processType: "PERIOD_CLOSE" }).catch(() => {});
    }
  }

  /**
   * Hard-close a period: SOFT_CLOSE → CLOSED.
   *
   * Validates all posted journals are balanced. Acquires process lock.
   * Updates LedgerSetup.currentPeriodId to advance to next period.
   */
  async closePeriod(entityId: string, periodId: string, closedBy: string) {
    let lock;
    try {
      lock = await this.lockService.acquireLock({
        entityId,
        processType: "PERIOD_CLOSE",
        userId: closedBy,
        timeoutMinutes: 10
      });
    } catch (error) {
      if (error instanceof ProcessLockError && error.code === "LOCK_HELD") {
        throw new PeriodServiceError(
          "PERIOD_CLOSE_LOCKED",
          "Another period close operation is already in progress.",
          409
        );
      }
      throw error;
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const [period] = await tx.$queryRaw<
          Array<{ id: string; status: string; year: number; month: number }>
        >`
          SELECT id, status, year, month FROM periods
          WHERE id = ${periodId} AND entity_id = ${entityId}
          FOR UPDATE
        `;

        if (!period) {
          throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
        }

        // Accept both OPEN and SOFT_CLOSE → CLOSED (backwards compat: direct close still works)
        if (period.status !== "OPEN" && period.status !== "SOFT_CLOSE") {
          throw new PeriodServiceError(
            "PERIOD_NOT_OPEN",
            "Only OPEN or SOFT_CLOSE periods can be closed.",
            409
          );
        }

        // ── Precondition checks ──
        const draftCount = await tx.journal.count({
          where: { entityId, periodId, status: "DRAFT" }
        });
        if (draftCount > 0) {
          throw new PeriodServiceError(
            "DRAFT_JOURNALS_EXIST",
            `Cannot close period: ${draftCount} draft journal(s) must be posted or deleted first.`,
            409
          );
        }

        const pendingCount = await tx.journal.count({
          where: { entityId, periodId, status: "PENDING_APPROVAL" }
        });
        if (pendingCount > 0) {
          throw new PeriodServiceError(
            "PENDING_JOURNALS_EXIST",
            `Cannot close period: ${pendingCount} journal(s) pending approval.`,
            409
          );
        }

        // Check balanced journals (debit_functional vs credit_functional)
        const unbalancedJournals = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT j.id
          FROM journals j
          JOIN journal_lines jl ON jl.journal_id = j.id
          WHERE j.entity_id = ${entityId}
            AND j.period_id = ${periodId}
            AND j.status = 'POSTED'
          GROUP BY j.id
          HAVING ABS(SUM(jl.debit_functional) - SUM(jl.credit_functional)) > 0.0001
          LIMIT 5
        `;
        if (unbalancedJournals.length > 0) {
          throw new PeriodServiceError(
            "UNBALANCED_JOURNALS",
            `Cannot close period: ${unbalancedJournals.length} journal(s) are not balanced (debits ≠ credits).`,
            409
          );
        }

        // Update PeriodCloseStatus
        const existingPcs = await (tx as any).periodCloseStatus.findFirst({
          where: { entityId, periodId, ledger: "A" }
        });
        if (existingPcs) {
          await (tx as any).periodCloseStatus.update({
            where: { id: existingPcs.id },
            data: { status: "HARD_CLOSE", closedById: closedBy, closedAt: new Date() }
          });
        } else {
          await (tx as any).periodCloseStatus.create({
            data: {
              entityId,
              periodId,
              ledger: "A",
              status: "HARD_CLOSE",
              closedById: closedBy,
              closedAt: new Date()
            }
          });
        }

        // Advance LedgerSetup.currentPeriodId to next period (if exists)
        const nextPeriod = await tx.period.findFirst({
          where: {
            entityId,
            status: "OPEN",
            id: { not: periodId }
          },
          orderBy: [{ year: "asc" }, { month: "asc" }]
        });

        const ledgerSetup = await (tx as any).ledgerSetup.findFirst({
          where: { entityId, ledger: "A" }
        });
        if (ledgerSetup && nextPeriod) {
          await (tx as any).ledgerSetup.update({
            where: { id: ledgerSetup.id },
            data: { currentPeriodId: nextPeriod.id }
          });
        }

        const closed = await tx.period.update({
          where: { id: periodId },
          data: { status: "CLOSED", closedAt: new Date() }
        });

        // Roll this period's closing balances into the next one. This is the
        // authoritative carry-forward: only now are these closing balances
        // final. Without it, each period's closing balance is nothing but that
        // period's own movement, and the balance sheet is structurally wrong.
        //
        // Deliberately keyed on the next period by (year, month) rather than on
        // the `nextPeriod` lookup above — that one finds the earliest OPEN
        // period for the current-period pointer, which is not necessarily the
        // period immediately following this one.
        //
        // Inside the transaction so a failure here rolls back the close too:
        // a period recorded as CLOSED without its balances carried forward is
        // the exact silent corruption this fix exists to prevent.
        const followingPeriodId = await findFollowingPeriodId(tx, entityId, periodId);
        if (followingPeriodId) {
          await carryForwardOpeningBalances(tx, entityId, followingPeriodId);
        }

        return closed;
      });

      // Post-transaction side effects
      await enqueueMVRefresh(`period-close:${periodId}`).catch(() => {});

      return updated;
    } finally {
      await this.lockService.releaseLock({ entityId, processType: "PERIOD_CLOSE" }).catch(() => {});
    }
  }

  /**
   * Lock a period: CLOSED → LOCKED. Uses SELECT FOR UPDATE.
   */
  async lockPeriod(entityId: string, periodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [period] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM periods
        WHERE id = ${periodId} AND entity_id = ${entityId}
        FOR UPDATE
      `;

      if (!period) {
        throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
      }

      if (period.status !== "CLOSED") {
        throw new PeriodServiceError(
          "PERIOD_NOT_CLOSED",
          "Only CLOSED periods can be locked.",
          409
        );
      }

      // Update PeriodCloseStatus to LOCKED
      const existingPcs = await (tx as any).periodCloseStatus.findFirst({
        where: { entityId, periodId, ledger: "A" }
      });
      if (existingPcs) {
        await (tx as any).periodCloseStatus.update({
          where: { id: existingPcs.id },
          data: { status: "PC_LOCKED" }
        });
      }

      return tx.period.update({
        where: { id: periodId },
        data: { status: "LOCKED" }
      });
    });
  }

  /**
   * Reopen a locked period: LOCKED → OPEN (SUPERADMIN only).
   *
   * Acquires PERIOD_REOPEN process lock, resets PeriodCloseStatus run flags,
   * and updates LedgerSetup.currentPeriodId.
   */
  async reopenPeriod(entityId: string, periodId: string, userRoles: string[]) {
    const isSuperAdmin = userRoles.includes("SUPERADMIN");
    if (!isSuperAdmin) {
      throw new PeriodServiceError(
        "PERIOD_REOPEN_FORBIDDEN",
        "Only SUPERADMIN can reopen locked periods.",
        403
      );
    }

    try {
      await this.lockService.acquireLock({
        entityId,
        processType: "PERIOD_REOPEN",
        timeoutMinutes: 5
      });
    } catch (error) {
      if (error instanceof ProcessLockError && error.code === "LOCK_HELD") {
        throw new PeriodServiceError(
          "PERIOD_REOPEN_LOCKED",
          "Another period reopen operation is already in progress.",
          409
        );
      }
      throw error;
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const [period] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM periods
          WHERE id = ${periodId} AND entity_id = ${entityId}
          FOR UPDATE
        `;

        if (!period) {
          throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
        }

        if (period.status !== "LOCKED" && period.status !== "CLOSED") {
          throw new PeriodServiceError(
            "PERIOD_NOT_LOCKED",
            "Only LOCKED or CLOSED periods can be reopened.",
            409
          );
        }

        // Check for existing OPEN period
        const openPeriods = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM periods
          WHERE entity_id = ${entityId} AND status = 'OPEN' AND id != ${periodId}
          FOR UPDATE
        `;
        if (openPeriods.length > 0) {
          throw new PeriodServiceError(
            "PERIOD_OPEN_EXISTS",
            "Another OPEN period already exists for this entity.",
            409
          );
        }

        // Reset PeriodCloseStatus run flags
        const existingPcs = await (tx as any).periodCloseStatus.findFirst({
          where: { entityId, periodId, ledger: "A" }
        });
        if (existingPcs) {
          await (tx as any).periodCloseStatus.update({
            where: { id: existingPcs.id },
            data: {
              status: "PC_OPEN",
              revaluationRun: false,
              depreciationRun: false,
              allocationsRun: false,
              yearEndProcessed: false,
              closedAt: null,
              closedById: null
            }
          });
        }

        // Update LedgerSetup to point back to this period
        const ledgerSetup = await (tx as any).ledgerSetup.findFirst({
          where: { entityId, ledger: "A" }
        });
        if (ledgerSetup) {
          await (tx as any).ledgerSetup.update({
            where: { id: ledgerSetup.id },
            data: { currentPeriodId: periodId }
          });
        }

        return tx.period.update({
          where: { id: periodId },
          data: { status: "OPEN", openedAt: new Date(), closedAt: null }
        });
      });

      return updated;
    } finally {
      await this.lockService
        .releaseLock({ entityId, processType: "PERIOD_REOPEN" })
        .catch(() => {});
    }
  }
}
