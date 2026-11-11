import { makeBalanceWriterStub } from "./helpers/balance-writer-stub.js";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock("../src/jobs/mv-refresh-job.js", () => ({
  enqueueMVRefresh: vi.fn().mockResolvedValue(undefined)
}));

import { AllocationService, AllocationServiceError } from "../src/modules/allocation/service.js";

// ── Mock DB ────────────────────────────────────────────────────────────────

type MockAccount = {
  id: string;
  entityId: string;
  code: string;
  type: string;
  isActive: boolean;
};

type MockBalance = {
  id: string;
  entityId: string;
  accountId: string;
  periodId: string;
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  closingBalance: number;
};

type MockDefinition = {
  id: string;
  entityId: string;
  name: string;
  description: string | null;
  allocationType: string;
  periodId: string | null;
  isSteppedSequence: boolean;
  sequenceOrder: number;
  isActive: boolean;
  isSystem: boolean;
  createdById: string | null;
  sources: any[];
  targets: any[];
};

type MockPeriod = {
  id: string;
  entityId: string;
  status: string;
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

let accounts: MockAccount[];
let balances: MockBalance[];
let definitions: MockDefinition[];
let periods: MockPeriod[];
let locks: MockLock[];
let journals: any[];
let pcsRecords: any[];
let ledgerSetups: any[];
let idCounter: number;

function makeMockPrisma() {
  accounts = [];
  balances = [];
  definitions = [];
  periods = [];
  locks = [];
  journals = [];
  pcsRecords = [];
  ledgerSetups = [];
  idCounter = 0;

  function nextId(prefix: string) {
    idCounter++;
    return `${prefix}-${idCounter}`;
  }

  function toNum(value: unknown): number {
    if (value && typeof (value as { toNumber?: unknown }).toNumber === "function") {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }

  function applyBalanceSql(values: unknown[]) {
    const [entityId, accountId, periodId, debitFunctional, creditFunctional, signValue] = values;
    const debit = toNum(debitFunctional);
    const credit = toNum(creditFunctional);
    const sign = Number(signValue);
    let balance = balances.find(
      (b) => b.entityId === entityId && b.accountId === accountId && b.periodId === periodId
    );
    if (!balance) {
      balance = {
        id: nextId("bal"),
        entityId: String(entityId),
        accountId: String(accountId),
        periodId: String(periodId),
        openingBalance: 0,
        periodDebits: 0,
        periodCredits: 0,
        closingBalance: 0
      };
      balances.push(balance);
    }
    balance.periodDebits += debit;
    balance.periodCredits += credit;
    balance.closingBalance =
      balance.openingBalance + sign * balance.periodDebits - sign * balance.periodCredits;
  }

  const prisma = {
    $executeRaw: vi
      .fn()
      .mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        applyBalanceSql(values);
        return 1;
      }),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: vi.fn(makeBalanceWriterStub()),
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    allocationDefinition: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const def = definitions.find(
          (d) =>
            d.entityId === where.entityId &&
            (where.id ? d.id === where.id : true) &&
            (where.name ? d.name === where.name : true)
        );
        return Promise.resolve(def ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where, orderBy }: any) => {
        let result = definitions.filter((d) => d.entityId === where.entityId);
        if (where.isActive !== undefined)
          result = result.filter((d) => d.isActive === where.isActive);
        if (where.isSteppedSequence !== undefined)
          result = result.filter((d) => d.isSteppedSequence === where.isSteppedSequence);
        return Promise.resolve(result);
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const def: MockDefinition = {
          id: nextId("def"),
          entityId: data.entityId,
          name: data.name,
          description: data.description ?? null,
          allocationType: data.allocationType,
          periodId: data.periodId ?? null,
          isSteppedSequence: data.isSteppedSequence ?? false,
          sequenceOrder: data.sequenceOrder ?? 0,
          isActive: data.isActive ?? true,
          isSystem: data.isSystem ?? false,
          createdById: data.createdById ?? null,
          sources: (data.sources?.create ?? []).map((s: any, i: number) => ({
            id: nextId("src"),
            definitionId: "",
            ...s,
            sourceOrder: s.sourceOrder ?? i
          })),
          targets: (data.targets?.create ?? []).map((t: any, i: number) => ({
            id: nextId("tgt"),
            definitionId: "",
            ...t,
            targetOrder: t.targetOrder ?? i
          }))
        };
        def.sources.forEach((s: any) => (s.definitionId = def.id));
        def.targets.forEach((t: any) => (t.definitionId = def.id));
        definitions.push(def);
        return Promise.resolve(def);
      }),
      delete: vi.fn().mockImplementation(({ where }: any) => {
        definitions = definitions.filter((d) => d.id !== where.id);
        return Promise.resolve();
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const def = definitions.find((d) => d.id === where.id);
        if (def) Object.assign(def, data);
        return Promise.resolve(def);
      })
    },
    allocationSource: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({})
    },
    allocationTarget: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({})
    },
    account: {
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          accounts.filter(
            (a) =>
              a.entityId === where.entityId &&
              a.isActive === where.isActive &&
              a.code >= where.code.gte &&
              a.code <= where.code.lte
          )
        );
      }),
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          accounts.find(
            (a) => a.entityId === where.entityId && a.code === where.code && a.isActive
          ) ?? null
        );
      })
    },
    accountPeriodBalance: {
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        const accountIds = where.accountId?.in ?? [];
        return Promise.resolve(
          balances.filter(
            (b) =>
              b.entityId === where.entityId &&
              b.periodId === where.periodId &&
              accountIds.includes(b.accountId)
          )
        );
      }),
      upsert: vi.fn().mockImplementation(({ where, create, update }: any) => {
        const key = where.entityId_accountId_periodId;
        const existing = balances.find(
          (b) =>
            b.entityId === key.entityId &&
            b.accountId === key.accountId &&
            b.periodId === key.periodId
        );
        if (existing) {
          if (update.periodDebits?.increment)
            existing.periodDebits += update.periodDebits.increment;
          if (update.periodCredits?.increment)
            existing.periodCredits += update.periodCredits.increment;
          if (update.closingBalance?.increment)
            existing.closingBalance += update.closingBalance.increment;
          return Promise.resolve(existing);
        }
        const newBal: MockBalance = {
          id: nextId("bal"),
          ...create
        };
        balances.push(newBal);
        return Promise.resolve(newBal);
      })
    },
    auditEvent: {
      create: vi
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ id: nextId("audit"), ...data }))
    },
    ledgerSetup: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          ledgerSetups.find(
            (s: any) => s.entityId === where.entityId && s.ledger === where.ledger
          ) ?? null
        );
      })
    },
    period: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          periods.find((p) => p.id === where.id && p.entityId === where.entityId) ?? null
        );
      })
    },
    periodCloseStatus: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          pcsRecords.find(
            (r: any) =>
              r.entityId === where.entityId &&
              r.periodId === where.periodId &&
              r.ledger === where.ledger
          ) ?? null
        );
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const pcs = pcsRecords.find((r: any) => r.id === where.id);
        if (pcs) Object.assign(pcs, data);
        return Promise.resolve(pcs);
      })
    },
    journal: {
      create: vi.fn().mockImplementation(({ data, include }: any) => {
        const journalId = nextId("jrn");
        const lines = (data.lines?.create ?? []).map((l: any, i: number) => ({
          id: nextId("jl"),
          journalId,
          ...l,
          ...(include?.lines?.include?.account
            ? {
                account: {
                  type: accounts.find((a) => a.id === l.accountId)?.type
                }
              }
            : {})
        }));
        const journal = { id: journalId, ...data, lines };
        journals.push(journal);
        return Promise.resolve(journal);
      })
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
        const lock: MockLock = {
          id: nextId("lock"),
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
            Object.assign(lock, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      })
    }
  } as any;

  return prisma;
}

// ── Seed helpers ──────────────────────────────────────────────────────────

function seedAccounts() {
  accounts.push(
    { id: "acct-5000", entityId: "entity-1", code: "5000", type: "EXPENSE", isActive: true },
    { id: "acct-5100", entityId: "entity-1", code: "5100", type: "EXPENSE", isActive: true },
    { id: "acct-5200", entityId: "entity-1", code: "5200", type: "EXPENSE", isActive: true },
    { id: "acct-6100", entityId: "entity-1", code: "6100", type: "EXPENSE", isActive: true },
    { id: "acct-6200", entityId: "entity-1", code: "6200", type: "EXPENSE", isActive: true },
    { id: "acct-7000", entityId: "entity-1", code: "7000", type: "EXPENSE", isActive: true },
    { id: "acct-4000", entityId: "entity-1", code: "4000", type: "REVENUE", isActive: true },
    { id: "acct-4100", entityId: "entity-1", code: "4100", type: "REVENUE", isActive: true }
  );
}

function seedBalances() {
  balances.push(
    {
      id: "bal-1",
      entityId: "entity-1",
      accountId: "acct-5000",
      periodId: "period-1",
      openingBalance: 0,
      periodDebits: 10000,
      periodCredits: 0,
      closingBalance: 10000
    },
    {
      id: "bal-2",
      entityId: "entity-1",
      accountId: "acct-5100",
      periodId: "period-1",
      openingBalance: 0,
      periodDebits: 5000,
      periodCredits: 0,
      closingBalance: 5000
    }
  );
}

function seedRevenueBalances() {
  balances.push(
    {
      id: "bal-r1",
      entityId: "entity-1",
      accountId: "acct-4000",
      periodId: "period-1",
      openingBalance: 0,
      periodDebits: 0,
      periodCredits: 60000,
      closingBalance: 60000
    },
    {
      id: "bal-r2",
      entityId: "entity-1",
      accountId: "acct-4100",
      periodId: "period-1",
      openingBalance: 0,
      periodDebits: 0,
      periodCredits: 40000,
      closingBalance: 40000
    }
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AllocationService — CRUD", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: AllocationService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new AllocationService(prisma);
  });

  it("creates an allocation definition with sources and targets", async () => {
    const def = await service.createDefinition("entity-1", "user-1", {
      name: "Utilities Allocation",
      allocationType: "CHARGE",
      sources: [{ accountCodeFrom: "5000", accountCodeTo: "5200" }],
      targets: [
        {
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100
        }
      ]
    });

    expect(def.name).toBe("Utilities Allocation");
    expect(def.allocationType).toBe("CHARGE");
    expect(def.sources).toHaveLength(1);
    expect(def.targets).toHaveLength(1);
    expect(def.targets[0].basisType).toBe("FIXED_PERCENTAGE");
  });

  it("rejects duplicate names", async () => {
    definitions.push({
      id: "def-existing",
      entityId: "entity-1",
      name: "Utilities Allocation",
      description: null,
      allocationType: "CHARGE",
      periodId: null,
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [],
      targets: []
    });

    await expect(
      service.createDefinition("entity-1", "user-1", {
        name: "Utilities Allocation",
        allocationType: "CHARGE",
        sources: [{ accountCodeFrom: "5000" }],
        targets: [{ targetAccountCode: "6100", basisType: "FIXED_PERCENTAGE" }]
      })
    ).rejects.toMatchObject({ code: "ALLOCATION_DUPLICATE_NAME" });
  });

  it("prevents deleting system definitions", async () => {
    definitions.push({
      id: "def-sys",
      entityId: "entity-1",
      name: "System Alloc",
      description: null,
      allocationType: "CHARGE",
      periodId: null,
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: true,
      createdById: null,
      sources: [],
      targets: []
    });

    await expect(service.deleteDefinition("entity-1", "def-sys")).rejects.toMatchObject({
      code: "ALLOCATION_SYSTEM_READONLY"
    });
  });

  it("prevents updating system definitions", async () => {
    definitions.push({
      id: "def-sys2",
      entityId: "entity-1",
      name: "System Alloc 2",
      description: null,
      allocationType: "SPLIT",
      periodId: null,
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: true,
      createdById: null,
      sources: [],
      targets: []
    });

    await expect(
      service.updateDefinition("entity-1", "def-sys2", { name: "Renamed" })
    ).rejects.toMatchObject({ code: "ALLOCATION_SYSTEM_READONLY" });
  });

  it("returns 404 for non-existent definition", async () => {
    await expect(service.getDefinition("entity-1", "nonexistent")).rejects.toMatchObject({
      code: "ALLOCATION_NOT_FOUND",
      statusCode: 404
    });
  });
});

describe("AllocationService — calculateAllocation", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: AllocationService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new AllocationService(prisma);
    seedAccounts();
    seedBalances();
  });

  it("calculates FIXED_PERCENTAGE allocation", async () => {
    definitions.push({
      id: "def-1",
      entityId: "entity-1",
      name: "Utilities 60/40",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 60,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        },
        {
          id: "tgt-2",
          targetAccountCode: "6200",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 40,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 1
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-1");

    expect(result.sourceAmount).toBe("10000.0000");
    expect(result.allocationType).toBe("CHARGE");
    // 2 targets x 2 lines each (target + offset) = 4 lines
    expect(result.lines).toHaveLength(4);

    // First target: 60% of 10000 = 6000
    expect(result.lines[0].accountCode).toBe("6100");
    expect(result.lines[0].debit).toBe("6000.0000");
    expect(result.lines[1].accountCode).toBe("7000");
    expect(result.lines[1].credit).toBe("6000.0000");

    // Second target: 40% of 10000 = 4000
    expect(result.lines[2].accountCode).toBe("6200");
    expect(result.lines[2].debit).toBe("4000.0000");
    expect(result.lines[3].accountCode).toBe("7000");
    expect(result.lines[3].credit).toBe("4000.0000");
  });

  it("calculates FIXED_AMOUNT allocation", async () => {
    definitions.push({
      id: "def-2",
      entityId: "entity-1",
      name: "Fixed Amount",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_AMOUNT",
          fixedPercentage: null,
          fixedAmount: 2500,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-2");

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].debit).toBe("2500.0000");
    expect(result.lines[1].credit).toBe("2500.0000");
  });

  it("returns zero lines when source amount is zero", async () => {
    definitions.push({
      id: "def-3",
      entityId: "entity-1",
      name: "Zero Source",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "9999",
          accountCodeTo: "9999",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-3");
    expect(result.sourceAmount).toBe("0");
    expect(result.lines).toHaveLength(0);
  });

  it("calculates SPLIT allocation with source reversal", async () => {
    definitions.push({
      id: "def-4",
      entityId: "entity-1",
      name: "Split Alloc",
      description: null,
      allocationType: "SPLIT",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: null,
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-4");

    // SPLIT: target line (debit 6100) + reversal line (credit 5000)
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].accountCode).toBe("6100");
    expect(result.lines[0].debit).toBe("10000.0000");
    expect(result.lines[1].accountCode).toBe("5000");
    expect(result.lines[1].credit).toBe("10000.0000");
    expect(result.lines[1].description).toContain("reversal");
  });

  it("calculates with multiple sources summed", async () => {
    definitions.push({
      id: "def-5",
      entityId: "entity-1",
      name: "Multi Source",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5100",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-5");

    // 5000 has 10000 debits + 5100 has 5000 debits = 15000 movements
    expect(result.sourceAmount).toBe("15000.0000");
    expect(result.lines[0].debit).toBe("15000.0000");
  });

  it("applies minimum threshold — skips source below", async () => {
    definitions.push({
      id: "def-6",
      entityId: "entity-1",
      name: "Threshold",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5100",
          accountCodeTo: "5100",
          balanceType: "MOVEMENTS",
          minimumThreshold: 10000,
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-6");

    // 5100 has 5000 movements, but minimum threshold is 10000 → skipped
    expect(result.sourceAmount).toBe("0");
    expect(result.lines).toHaveLength(0);
  });

  it("calculates ACCOUNT_BALANCE ratio-based allocation", async () => {
    seedRevenueBalances();

    definitions.push({
      id: "def-7",
      entityId: "entity-1",
      name: "Revenue Ratio",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "ACCOUNT_BALANCE",
          fixedPercentage: null,
          fixedAmount: null,
          ratioAccountCodeFrom: "4000",
          ratioAccountCodeTo: "4000",
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        },
        {
          id: "tgt-2",
          targetAccountCode: "6200",
          offsetAccountCode: "7000",
          basisType: "ACCOUNT_BALANCE",
          fixedPercentage: null,
          fixedAmount: null,
          ratioAccountCodeFrom: "4100",
          ratioAccountCodeTo: "4100",
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 1
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-7");

    // Source: 10000, Ratio: 4000=60000, 4100=40000, total=100000
    // Target 1: 10000 * (60000/100000) = 6000
    // Target 2: 10000 * (40000/100000) = 4000
    expect(result.sourceAmount).toBe("10000.0000");
    expect(result.lines[0].debit).toBe("6000.0000");
    expect(result.lines[2].debit).toBe("4000.0000");
  });

  it("calculates STATISTICAL_KEY allocation", async () => {
    definitions.push({
      id: "def-8",
      entityId: "entity-1",
      name: "Stat Key",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "STATISTICAL_KEY",
          fixedPercentage: null,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: "OCCUPIED_ROOMS",
          statisticalValue: 300,
          analysisCodes: null,
          targetOrder: 0
        },
        {
          id: "tgt-2",
          targetAccountCode: "6200",
          offsetAccountCode: "7000",
          basisType: "STATISTICAL_KEY",
          fixedPercentage: null,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: "OCCUPIED_ROOMS",
          statisticalValue: 200,
          analysisCodes: null,
          targetOrder: 1
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-8");

    // Source: 10000, Stat: 300+200=500
    // Target 1: 10000 * 300/500 = 6000
    // Target 2: 10000 * 200/500 = 4000
    expect(result.lines[0].debit).toBe("6000.0000");
    expect(result.lines[2].debit).toBe("4000.0000");
  });

  it("uses OPENING balance type", async () => {
    // Modify balance to have opening balance
    balances[0].openingBalance = 3000;

    definitions.push({
      id: "def-9",
      entityId: "entity-1",
      name: "Opening Balance",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "OPENING",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-9");
    expect(result.sourceAmount).toBe("3000.0000");
  });

  it("falls back to LedgerSetup current period when no periodId", async () => {
    ledgerSetups.push({
      id: "ls-1",
      entityId: "entity-1",
      ledger: "A",
      currentPeriodId: "period-1",
      baseCurrency: "USD"
    });

    definitions.push({
      id: "def-10",
      entityId: "entity-1",
      name: "No Period",
      description: null,
      allocationType: "CHARGE",
      periodId: null,
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });

    const result = await service.calculateAllocation("entity-1", "def-10");
    expect(result.sourceAmount).toBe("10000.0000");
  });

  it("throws when no period configured and none specified", async () => {
    definitions.push({
      id: "def-11",
      entityId: "entity-1",
      name: "No Period At All",
      description: null,
      allocationType: "CHARGE",
      periodId: null,
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [],
      targets: []
    });

    await expect(service.calculateAllocation("entity-1", "def-11")).rejects.toMatchObject({
      code: "ALLOCATION_NO_PERIOD"
    });
  });
});

describe("AllocationService — executeAllocation", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: AllocationService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new AllocationService(prisma);
    seedAccounts();
    seedBalances();

    periods.push({ id: "period-1", entityId: "entity-1", status: "OPEN" });
    ledgerSetups.push({
      id: "ls-1",
      entityId: "entity-1",
      ledger: "A",
      currentPeriodId: "period-1",
      baseCurrency: "USD"
    });

    definitions.push({
      id: "def-exec",
      entityId: "entity-1",
      name: "Exec Test",
      description: null,
      allocationType: "CHARGE",
      periodId: "period-1",
      isSteppedSequence: false,
      sequenceOrder: 0,
      isActive: true,
      isSystem: false,
      createdById: null,
      sources: [
        {
          id: "src-1",
          accountCodeFrom: "5000",
          accountCodeTo: "5000",
          balanceType: "MOVEMENTS",
          sourceOrder: 0
        }
      ],
      targets: [
        {
          id: "tgt-1",
          targetAccountCode: "6100",
          offsetAccountCode: "7000",
          basisType: "FIXED_PERCENTAGE",
          fixedPercentage: 100,
          fixedAmount: null,
          ratioAccountCodeFrom: null,
          ratioAccountCodeTo: null,
          statisticalKey: null,
          statisticalValue: null,
          analysisCodes: null,
          targetOrder: 0
        }
      ]
    });
  });

  it("creates a POSTED journal with ALLOC source", async () => {
    const result = await service.executeAllocation("entity-1", "def-exec", "user-1");

    expect(result.journalId).toBeDefined();
    expect(journals).toHaveLength(1);
    expect(journals[0].source).toBe("ALLOC");
    expect(journals[0].status).toBe("POSTED");
    expect(journals[0].lines).toHaveLength(2);
  });

  it("updates account balances after execution", async () => {
    await service.executeAllocation("entity-1", "def-exec", "user-1");

    // Balances now go through the canonical signed writer, which issues a
    // single parameterised INSERT via $queryRawUnsafe.
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it("releases process lock after execution", async () => {
    await service.executeAllocation("entity-1", "def-exec", "user-1");

    const activeLocks = locks.filter((l) => l.isActive);
    expect(activeLocks).toHaveLength(0);
  });

  it("releases process lock on failure", async () => {
    periods[0].status = "CLOSED"; // Will cause ALLOCATION_PERIOD_NOT_OPEN

    await service.executeAllocation("entity-1", "def-exec", "user-1").catch(() => {});

    const activeLocks = locks.filter((l) => l.isActive);
    expect(activeLocks).toHaveLength(0);
  });

  it("rejects execution on CLOSED period", async () => {
    periods[0].status = "CLOSED";

    await expect(service.executeAllocation("entity-1", "def-exec", "user-1")).rejects.toMatchObject(
      { code: "ALLOCATION_PERIOD_NOT_OPEN" }
    );
  });

  it("allows execution on SOFT_CLOSE period", async () => {
    periods[0].status = "SOFT_CLOSE";

    const result = await service.executeAllocation("entity-1", "def-exec", "user-1");
    expect(result.journalId).toBeDefined();
  });

  it("updates PeriodCloseStatus.allocationsRun flag", async () => {
    pcsRecords.push({
      id: "pcs-1",
      entityId: "entity-1",
      periodId: "period-1",
      ledger: "A",
      allocationsRun: false
    });

    await service.executeAllocation("entity-1", "def-exec", "user-1");

    expect(pcsRecords[0].allocationsRun).toBe(true);
  });

  it("returns empty result for zero source amount", async () => {
    // Replace source with non-existent account
    definitions[0].sources = [
      {
        id: "src-1",
        accountCodeFrom: "9999",
        accountCodeTo: "9999",
        balanceType: "MOVEMENTS",
        sourceOrder: 0
      }
    ];

    const result = await service.executeAllocation("entity-1", "def-exec", "user-1");

    expect(result.lines).toHaveLength(0);
    expect(result.journalId).toBeUndefined();
    expect(journals).toHaveLength(0);
  });
});

describe("AllocationService — runSteppedAllocations", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: AllocationService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new AllocationService(prisma);
    seedAccounts();
    seedBalances();

    periods.push({ id: "period-1", entityId: "entity-1", status: "OPEN" });
    ledgerSetups.push({
      id: "ls-1",
      entityId: "entity-1",
      ledger: "A",
      currentPeriodId: "period-1",
      baseCurrency: "USD"
    });
  });

  it("runs stepped allocations in sequence order", async () => {
    definitions.push(
      {
        id: "def-step-1",
        entityId: "entity-1",
        name: "Step 1",
        description: null,
        allocationType: "CHARGE",
        periodId: "period-1",
        isSteppedSequence: true,
        sequenceOrder: 1,
        isActive: true,
        isSystem: false,
        createdById: null,
        sources: [
          {
            id: "src-1",
            accountCodeFrom: "5000",
            accountCodeTo: "5000",
            balanceType: "MOVEMENTS",
            sourceOrder: 0
          }
        ],
        targets: [
          {
            id: "tgt-1",
            targetAccountCode: "6100",
            offsetAccountCode: "7000",
            basisType: "FIXED_PERCENTAGE",
            fixedPercentage: 50,
            fixedAmount: null,
            ratioAccountCodeFrom: null,
            ratioAccountCodeTo: null,
            statisticalKey: null,
            statisticalValue: null,
            analysisCodes: null,
            targetOrder: 0
          }
        ]
      },
      {
        id: "def-step-2",
        entityId: "entity-1",
        name: "Step 2",
        description: null,
        allocationType: "CHARGE",
        periodId: "period-1",
        isSteppedSequence: true,
        sequenceOrder: 2,
        isActive: true,
        isSystem: false,
        createdById: null,
        sources: [
          {
            id: "src-2",
            accountCodeFrom: "5100",
            accountCodeTo: "5100",
            balanceType: "MOVEMENTS",
            sourceOrder: 0
          }
        ],
        targets: [
          {
            id: "tgt-2",
            targetAccountCode: "6200",
            offsetAccountCode: "7000",
            basisType: "FIXED_PERCENTAGE",
            fixedPercentage: 100,
            fixedAmount: null,
            ratioAccountCodeFrom: null,
            ratioAccountCodeTo: null,
            statisticalKey: null,
            statisticalValue: null,
            analysisCodes: null,
            targetOrder: 0
          }
        ]
      }
    );

    const results = await service.runSteppedAllocations("entity-1", "user-1");

    expect(results).toHaveLength(2);
    expect(results[0].definitionName).toBe("Step 1");
    expect(results[1].definitionName).toBe("Step 2");
    expect(journals).toHaveLength(2);
  });

  it("throws when no stepped definitions exist", async () => {
    await expect(service.runSteppedAllocations("entity-1", "user-1")).rejects.toMatchObject({
      code: "ALLOCATION_NO_STEPPED"
    });
  });
});
