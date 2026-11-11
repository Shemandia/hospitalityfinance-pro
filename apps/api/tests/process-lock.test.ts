import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock dependencies that the service imports ─────────────────────────────

vi.mock("../src/jobs/mv-refresh-job.js", () => ({
  enqueueMVRefresh: vi.fn().mockResolvedValue(undefined)
}));

import { ProcessLockService, ProcessLockError } from "../src/modules/process-lock/service.js";

// ── Mock DB ────────────────────────────────────────────────────────────────

type MockLock = {
  id: string;
  entityId: string;
  processType: string;
  ledger: string;
  acquiredAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
  acquiredById: string | null;
  workerId: string | null;
  isActive: boolean;
};

let locks: MockLock[];
let idCounter: number;

function makeMockPrisma() {
  locks = [];
  idCounter = 0;

  const processLockMethods = {
    findFirst: vi.fn().mockImplementation(({ where }: any) => {
      return Promise.resolve(
        locks.find(
          (l) =>
            l.entityId === where.entityId &&
            l.processType === where.processType &&
            l.ledger === where.ledger &&
            l.isActive === where.isActive
        ) ?? null
      );
    }),
    findMany: vi.fn().mockImplementation(({ where }: any) => {
      return Promise.resolve(
        locks.filter((l) => l.entityId === where.entityId && l.isActive === where.isActive)
      );
    }),
    create: vi.fn().mockImplementation(({ data }: any) => {
      idCounter++;
      const lock: MockLock = {
        id: `lock-${idCounter}`,
        entityId: data.entityId,
        processType: data.processType,
        ledger: data.ledger,
        acquiredAt: new Date(),
        expiresAt: data.expiresAt,
        releasedAt: null,
        acquiredById: data.acquiredById,
        workerId: data.workerId,
        isActive: true
      };
      locks.push(lock);
      return Promise.resolve(lock);
    }),
    update: vi.fn().mockImplementation(({ where, data }: any) => {
      const lock = locks.find((l) => l.id === where.id);
      if (lock) {
        Object.assign(lock, data);
      }
      return Promise.resolve(lock);
    }),
    updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
      let count = 0;
      for (const lock of locks) {
        if (lock.isActive && where.expiresAt?.lt && lock.expiresAt < where.expiresAt.lt) {
          if (!where.entityId || lock.entityId === where.entityId) {
            Object.assign(lock, data);
            count++;
          }
        }
      }
      return Promise.resolve({ count });
    })
  };

  const mock = {
    processLock: processLockMethods,
    // $transaction passes through to fn with a tx that shares the same mock methods
    $transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        processLock: processLockMethods,
        $executeRawUnsafe: vi.fn().mockResolvedValue(undefined)
      };
      return fn(tx);
    })
  } as any;

  return mock;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ProcessLockService", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: ProcessLockService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new ProcessLockService(prisma);
  });

  it("acquires a lock successfully", async () => {
    const lock = await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE",
      userId: "user-1",
      timeoutMinutes: 15
    });

    expect(lock.entityId).toBe("entity-1");
    expect(lock.processType).toBe("PERIOD_CLOSE");
    expect(lock.isActive).toBe(true);
    expect(lock.acquiredById).toBe("user-1");
    expect(lock.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("fails with LOCK_HELD when lock already active", async () => {
    await service.acquireLock({
      entityId: "entity-1",
      processType: "REVALUATION"
    });

    await expect(
      service.acquireLock({
        entityId: "entity-1",
        processType: "REVALUATION"
      })
    ).rejects.toThrow(ProcessLockError);

    try {
      await service.acquireLock({
        entityId: "entity-1",
        processType: "REVALUATION"
      });
    } catch (error) {
      expect((error as ProcessLockError).code).toBe("LOCK_HELD");
      expect((error as ProcessLockError).statusCode).toBe(409);
    }
  });

  it("allows different process types concurrently", async () => {
    await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    const lock2 = await service.acquireLock({
      entityId: "entity-1",
      processType: "REVALUATION"
    });

    expect(lock2.processType).toBe("REVALUATION");
    expect(lock2.isActive).toBe(true);
  });

  it("allows same process type on different entities", async () => {
    await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    const lock2 = await service.acquireLock({
      entityId: "entity-2",
      processType: "PERIOD_CLOSE"
    });

    expect(lock2.entityId).toBe("entity-2");
    expect(lock2.isActive).toBe(true);
  });

  it("releases a lock successfully", async () => {
    await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    const released = await service.releaseLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    expect(released?.isActive).toBe(false);
    expect(released?.releasedAt).toBeDefined();
  });

  it("release is idempotent — returns null for non-existent lock", async () => {
    const result = await service.releaseLock({
      entityId: "entity-1",
      processType: "NONEXISTENT"
    });

    expect(result).toBeNull();
  });

  it("can re-acquire after release", async () => {
    await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    await service.releaseLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    const lock = await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    expect(lock.isActive).toBe(true);
  });

  it("expired locks are automatically released before acquire", async () => {
    // Manually create an expired lock
    const expiredTime = new Date(Date.now() - 60_000); // 1 minute ago
    locks.push({
      id: "expired-lock",
      entityId: "entity-1",
      processType: "PERIOD_CLOSE",
      ledger: "A",
      acquiredAt: new Date(Date.now() - 120_000),
      expiresAt: expiredTime,
      releasedAt: null,
      acquiredById: null,
      workerId: null,
      isActive: true
    });

    // Should succeed because expired lock gets cleaned up
    const lock = await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    expect(lock.isActive).toBe(true);
  });

  it("getLockStatus returns active locks", async () => {
    await service.acquireLock({ entityId: "entity-1", processType: "PERIOD_CLOSE" });
    await service.acquireLock({ entityId: "entity-1", processType: "REVALUATION" });

    const status = await service.getLockStatus("entity-1");
    expect(status).toHaveLength(2);
  });

  it("isLocked returns true for active lock", async () => {
    await service.acquireLock({ entityId: "entity-1", processType: "PERIOD_CLOSE" });

    const locked = await service.isLocked("entity-1", "PERIOD_CLOSE");
    expect(locked).toBe(true);
  });

  it("isLocked returns false when no lock", async () => {
    const locked = await service.isLocked("entity-1", "PERIOD_CLOSE");
    expect(locked).toBe(false);
  });

  it("uses default 30-minute timeout", async () => {
    const lock = await service.acquireLock({
      entityId: "entity-1",
      processType: "PERIOD_CLOSE"
    });

    const expectedMin = Date.now() + 29 * 60 * 1000;
    const expectedMax = Date.now() + 31 * 60 * 1000;
    expect(lock.expiresAt.getTime()).toBeGreaterThan(expectedMin);
    expect(lock.expiresAt.getTime()).toBeLessThan(expectedMax);
  });
});
