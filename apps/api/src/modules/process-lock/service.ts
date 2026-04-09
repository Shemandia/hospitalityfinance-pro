import type { PrismaClient } from "../../db/client.js";

const DEFAULT_TIMEOUT_MINUTES = 30;

export class ProcessLockError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class ProcessLockService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Acquire an exclusive lock for a process type within an entity/ledger.
   *
   * If an active, non-expired lock already exists for the same (entityId, processType, ledger),
   * the call fails immediately with LOCK_HELD.
   *
   * Expired locks are automatically released before attempting acquisition.
   */
  async acquireLock(params: {
    entityId: string;
    processType: string;
    ledger?: string;
    userId?: string;
    workerId?: string;
    timeoutMinutes?: number;
  }) {
    const {
      entityId,
      processType,
      ledger = "A",
      userId,
      workerId,
      timeoutMinutes = DEFAULT_TIMEOUT_MINUTES
    } = params;

    // Release any expired locks first
    await this.releaseExpiredLocks(entityId);

    // Check for an active lock
    const existing = await (this.prisma as any).processLock.findFirst({
      where: {
        entityId,
        processType,
        ledger,
        isActive: true
      }
    });

    if (existing) {
      throw new ProcessLockError(
        "LOCK_HELD",
        `Process '${processType}' is already locked for entity ${entityId} ledger ${ledger}. ` +
          `Held since ${existing.acquiredAt.toISOString()}` +
          (existing.acquiredById ? ` by user ${existing.acquiredById}` : "") +
          `. Expires at ${existing.expiresAt.toISOString()}.`,
        409
      );
    }

    const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);

    return (this.prisma as any).processLock.create({
      data: {
        entityId,
        processType,
        ledger,
        acquiredById: userId ?? null,
        workerId: workerId ?? null,
        expiresAt,
        isActive: true
      }
    });
  }

  /**
   * Release an active lock for a process type.
   * No-op if no active lock exists (idempotent).
   */
  async releaseLock(params: { entityId: string; processType: string; ledger?: string }) {
    const { entityId, processType, ledger = "A" } = params;

    const existing = await (this.prisma as any).processLock.findFirst({
      where: {
        entityId,
        processType,
        ledger,
        isActive: true
      }
    });

    if (!existing) return null;

    return (this.prisma as any).processLock.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        releasedAt: new Date()
      }
    });
  }

  /**
   * Release all expired locks for an entity (or all entities if entityId is omitted).
   * Called automatically before acquire, and can be called by a periodic sweeper.
   */
  async releaseExpiredLocks(entityId?: string) {
    const now = new Date();
    const where: any = {
      isActive: true,
      expiresAt: { lt: now }
    };
    if (entityId) where.entityId = entityId;

    return (this.prisma as any).processLock.updateMany({
      where,
      data: {
        isActive: false,
        releasedAt: now
      }
    });
  }

  /**
   * Get all active locks for an entity (optionally filtered by ledger).
   */
  async getLockStatus(entityId: string, ledger?: string) {
    const where: any = { entityId, isActive: true };
    if (ledger) where.ledger = ledger;

    return (this.prisma as any).processLock.findMany({
      where,
      orderBy: { acquiredAt: "desc" }
    });
  }

  /**
   * Check if a specific process type lock is currently held.
   */
  async isLocked(entityId: string, processType: string, ledger = "A"): Promise<boolean> {
    await this.releaseExpiredLocks(entityId);
    const lock = await (this.prisma as any).processLock.findFirst({
      where: { entityId, processType, ledger, isActive: true }
    });
    return !!lock;
  }
}
