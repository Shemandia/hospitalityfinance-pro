import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock("../src/shared/rabbitmq.js", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/jobs/mv-refresh-job.js", () => ({
  enqueueMVRefresh: vi.fn().mockResolvedValue(undefined)
}));

import { PeriodService, PeriodServiceError } from "../src/modules/period/service.js";

// ── Mock DB ────────────────────────────────────────────────────────────────

type MockPeriod = {
  id: string;
  entity_id: string;
  status: string;
  year: number;
  month: number;
  closedAt: Date | null;
  openedAt: Date | null;
};

type MockPcs = {
  id: string;
  entityId: string;
  periodId: string;
  ledger: string;
  status: string;
  revaluationRun: boolean;
  depreciationRun: boolean;
  allocationsRun: boolean;
  yearEndProcessed: boolean;
  closedById: string | null;
  closedAt: Date | null;
};

type MockLock = {
  id: string;
  entityId: string;
  processType: string;
  ledger: string;
  isActive: boolean;
  expiresAt: Date;
  acquiredAt: Date;
  releasedAt: Date | null;
  acquiredById: string | null;
  workerId: string | null;
};

let periods: MockPeriod[];
let journals: Array<{ entityId: string; periodId: string; status: string }>;
let pcStatuses: MockPcs[];
let locks: MockLock[];
let ledgerSetups: Array<{
  id: string;
  entityId: string;
  ledger: string;
  currentPeriodId: string | null;
}>;
let lockIdCounter: number;
let pcsIdCounter: number;

function makeMockPrisma() {
  periods = [];
  journals = [];
  pcStatuses = [];
  locks = [];
  ledgerSetups = [];
  lockIdCounter = 0;
  pcsIdCounter = 0;

  const txProxy = {
    $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join("?");
      if (query.includes("SELECT id, status") && query.includes("periods")) {
        const periodId = values[0];
        const entityId = values[1];
        const p = periods.find((p) => p.id === periodId && p.entity_id === entityId);
        return Promise.resolve(p ? [p] : []);
      }
      if (query.includes("SELECT id, status, year, month")) {
        const periodId = values[0];
        const entityId = values[1];
        const p = periods.find((p) => p.id === periodId && p.entity_id === entityId);
        return Promise.resolve(p ? [p] : []);
      }
      if (query.includes("SELECT id FROM periods") && query.includes("status = 'OPEN'")) {
        const entityId = values[0];
        const periodId = values[1];
        const open = periods.filter(
          (p) => p.entity_id === entityId && p.status === "OPEN" && p.id !== periodId
        );
        return Promise.resolve(open.map((p) => ({ id: p.id })));
      }
      if (query.includes("journal_lines")) {
        return Promise.resolve([]); // No unbalanced journals
      }
      return Promise.resolve([]);
    }),
    journal: {
      count: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          journals.filter(
            (j) =>
              j.entityId === where.entityId &&
              j.periodId === where.periodId &&
              j.status === where.status
          ).length
        );
      })
    },
    period: {
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const p = periods.find((p) => p.id === where.id);
        if (p) Object.assign(p, data);
        return Promise.resolve(p);
      }),
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          periods.find(
            (p) =>
              p.entity_id === where.entityId && p.status === where.status && p.id !== where.id?.not
          ) ?? null
        );
      })
    },
    periodCloseStatus: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          pcStatuses.find(
            (s) =>
              s.entityId === where.entityId &&
              s.periodId === where.periodId &&
              s.ledger === where.ledger
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        pcsIdCounter++;
        const pcs: MockPcs = {
          id: `pcs-${pcsIdCounter}`,
          ...data,
          revaluationRun: false,
          depreciationRun: false,
          allocationsRun: false,
          yearEndProcessed: false,
          closedAt: data.closedAt ?? null
        };
        pcStatuses.push(pcs);
        return Promise.resolve(pcs);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const pcs = pcStatuses.find((s) => s.id === where.id);
        if (pcs) Object.assign(pcs, data);
        return Promise.resolve(pcs);
      })
    },
    ledgerSetup: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          ledgerSetups.find((s) => s.entityId === where.entityId && s.ledger === where.ledger) ??
            null
        );
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const ls = ledgerSetups.find((s) => s.id === where.id);
        if (ls) Object.assign(ls, data);
        return Promise.resolve(ls);
      })
    }
  };

  return {
    $transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      return fn(txProxy);
    }),
    period: {
      findFirst: txProxy.period.findFirst,
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: txProxy.period.update
    },
    processLock: {
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
        return Promise.resolve(locks.filter((l) => l.entityId === where.entityId && l.isActive));
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        lockIdCounter++;
        const lock: MockLock = {
          id: `lock-${lockIdCounter}`,
          entityId: data.entityId,
          processType: data.processType,
          ledger: data.ledger,
          isActive: true,
          expiresAt: data.expiresAt,
          acquiredAt: new Date(),
          releasedAt: null,
          acquiredById: data.acquiredById,
          workerId: data.workerId
        };
        locks.push(lock);
        return Promise.resolve(lock);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const lock = locks.find((l) => l.id === where.id);
        if (lock) Object.assign(lock, data);
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
    }
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PeriodService — soft close", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: PeriodService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new PeriodService(prisma);
    periods.push({
      id: "period-1",
      entity_id: "entity-1",
      status: "OPEN",
      year: 2026,
      month: 3,
      closedAt: null,
      openedAt: new Date()
    });
  });

  it("soft-closes an OPEN period", async () => {
    const result = await service.softClosePeriod("entity-1", "period-1", "user-1");
    expect(result?.status).toBe("SOFT_CLOSE");
  });

  it("rejects soft-close on non-OPEN period", async () => {
    periods[0].status = "CLOSED";
    await expect(service.softClosePeriod("entity-1", "period-1", "user-1")).rejects.toMatchObject({
      code: "PERIOD_NOT_OPEN"
    });
  });

  it("rejects soft-close when draft journals exist", async () => {
    journals.push({ entityId: "entity-1", periodId: "period-1", status: "DRAFT" });
    await expect(service.softClosePeriod("entity-1", "period-1", "user-1")).rejects.toMatchObject({
      code: "DRAFT_JOURNALS_EXIST"
    });
  });

  it("rejects soft-close when pending approval journals exist", async () => {
    journals.push({ entityId: "entity-1", periodId: "period-1", status: "PENDING_APPROVAL" });
    await expect(service.softClosePeriod("entity-1", "period-1", "user-1")).rejects.toMatchObject({
      code: "PENDING_JOURNALS_EXIST"
    });
  });

  it("creates PeriodCloseStatus record on soft-close", async () => {
    await service.softClosePeriod("entity-1", "period-1", "user-1");
    expect(pcStatuses).toHaveLength(1);
    expect(pcStatuses[0].status).toBe("SOFT_CLOSE");
    expect(pcStatuses[0].closedById).toBe("user-1");
  });

  it("releases process lock after soft-close (even on failure)", async () => {
    journals.push({ entityId: "entity-1", periodId: "period-1", status: "DRAFT" });
    await service.softClosePeriod("entity-1", "period-1", "user-1").catch(() => {});
    // Lock should be released
    const activeLocks = locks.filter((l) => l.isActive);
    expect(activeLocks).toHaveLength(0);
  });
});

describe("PeriodService — hard close", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: PeriodService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new PeriodService(prisma);
    periods.push({
      id: "period-1",
      entity_id: "entity-1",
      status: "SOFT_CLOSE",
      year: 2026,
      month: 3,
      closedAt: null,
      openedAt: new Date()
    });
  });

  it("closes a SOFT_CLOSE period", async () => {
    const result = await service.closePeriod("entity-1", "period-1", "user-1");
    expect(result?.status).toBe("CLOSED");
    expect(result?.closedAt).toBeDefined();
  });

  it("closes an OPEN period directly (backwards compat)", async () => {
    periods[0].status = "OPEN";
    const result = await service.closePeriod("entity-1", "period-1", "user-1");
    expect(result?.status).toBe("CLOSED");
  });

  it("rejects close on LOCKED period", async () => {
    periods[0].status = "LOCKED";
    await expect(service.closePeriod("entity-1", "period-1", "user-1")).rejects.toMatchObject({
      code: "PERIOD_NOT_OPEN"
    });
  });

  it("updates PeriodCloseStatus to HARD_CLOSE", async () => {
    pcStatuses.push({
      id: "pcs-1",
      entityId: "entity-1",
      periodId: "period-1",
      ledger: "A",
      status: "SOFT_CLOSE",
      revaluationRun: true,
      depreciationRun: false,
      allocationsRun: false,
      yearEndProcessed: false,
      closedById: null,
      closedAt: null
    });

    await service.closePeriod("entity-1", "period-1", "user-1");
    expect(pcStatuses[0].status).toBe("HARD_CLOSE");
    expect(pcStatuses[0].closedById).toBe("user-1");
  });

  it("advances LedgerSetup.currentPeriodId to next OPEN period", async () => {
    periods.push({
      id: "period-2",
      entity_id: "entity-1",
      status: "OPEN",
      year: 2026,
      month: 4,
      closedAt: null,
      openedAt: new Date()
    });
    ledgerSetups.push({
      id: "ls-1",
      entityId: "entity-1",
      ledger: "A",
      currentPeriodId: "period-1"
    });

    await service.closePeriod("entity-1", "period-1", "user-1");
    expect(ledgerSetups[0].currentPeriodId).toBe("period-2");
  });
});

describe("PeriodService — reopen", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: PeriodService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new PeriodService(prisma);
    periods.push({
      id: "period-1",
      entity_id: "entity-1",
      status: "LOCKED",
      year: 2026,
      month: 3,
      closedAt: new Date(),
      openedAt: null
    });
    pcStatuses.push({
      id: "pcs-1",
      entityId: "entity-1",
      periodId: "period-1",
      ledger: "A",
      status: "PC_LOCKED",
      revaluationRun: true,
      depreciationRun: true,
      allocationsRun: true,
      yearEndProcessed: false,
      closedById: "user-1",
      closedAt: new Date()
    });
  });

  it("rejects non-SUPERADMIN reopen", async () => {
    await expect(service.reopenPeriod("entity-1", "period-1", ["ADMIN"])).rejects.toMatchObject({
      code: "PERIOD_REOPEN_FORBIDDEN",
      statusCode: 403
    });
  });

  it("reopens a LOCKED period as SUPERADMIN", async () => {
    const result = await service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"]);
    expect(result?.status).toBe("OPEN");
    expect(result?.closedAt).toBeNull();
    expect(result?.openedAt).toBeDefined();
  });

  it("resets PeriodCloseStatus run flags on reopen", async () => {
    await service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"]);
    expect(pcStatuses[0].status).toBe("PC_OPEN");
    expect(pcStatuses[0].revaluationRun).toBe(false);
    expect(pcStatuses[0].depreciationRun).toBe(false);
    expect(pcStatuses[0].allocationsRun).toBe(false);
    expect(pcStatuses[0].yearEndProcessed).toBe(false);
    expect(pcStatuses[0].closedAt).toBeNull();
    expect(pcStatuses[0].closedById).toBeNull();
  });

  it("updates LedgerSetup.currentPeriodId back to reopened period", async () => {
    ledgerSetups.push({
      id: "ls-1",
      entityId: "entity-1",
      ledger: "A",
      currentPeriodId: "period-2"
    });

    await service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"]);
    expect(ledgerSetups[0].currentPeriodId).toBe("period-1");
  });

  it("rejects reopen when another OPEN period exists", async () => {
    periods.push({
      id: "period-2",
      entity_id: "entity-1",
      status: "OPEN",
      year: 2026,
      month: 4,
      closedAt: null,
      openedAt: new Date()
    });

    await expect(
      service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"])
    ).rejects.toMatchObject({ code: "PERIOD_OPEN_EXISTS" });
  });

  it("reopens a CLOSED period (not just LOCKED)", async () => {
    periods[0].status = "CLOSED";
    const result = await service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"]);
    expect(result?.status).toBe("OPEN");
  });
});
