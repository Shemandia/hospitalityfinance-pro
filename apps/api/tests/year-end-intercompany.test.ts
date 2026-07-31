import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runYearEndCleardown,
  YearEndCleardownError
} from "../src/modules/period-close/year-end-cleardown.js";
import {
  IntercompanyService,
  IntercompanyServiceError
} from "../src/modules/intercompany/service.js";
import { GLRepository } from "../src/modules/gl/repository.js";

// ── Mock Data ──────────────────────────────────────────────────────────────────

const ENTITY_ID = "entity-1";
const MIRROR_ENTITY_ID = "entity-2";
const PERIOD_ID = "period-1";
const ACTOR_ID = "user-1";

const PERIOD_DEC = {
  id: PERIOD_ID,
  entityId: ENTITY_ID,
  year: 2026,
  month: 12,
  name: "December 2026",
  status: "OPEN"
};

const PERIOD_MARCH = {
  id: "period-mar",
  entityId: ENTITY_ID,
  year: 2027,
  month: 3,
  name: "March 2027",
  status: "OPEN"
};

const PERIOD_JUNE = {
  id: "period-jun",
  entityId: ENTITY_ID,
  year: 2026,
  month: 6,
  name: "June 2026",
  status: "OPEN"
};

const ENTITY = { id: ENTITY_ID, functionalCurrency: "USD", isActive: true };
const MIRROR_ENTITY = { id: MIRROR_ENTITY_ID, functionalCurrency: "EUR", isActive: true };

// normalBalance is a required, non-null column on Account. Cleardown buckets
// revenue vs expense by it (so custom INCOME types are classified correctly)
// and cross-checks it against the posting engine's sign convention, so these
// fixtures must carry it.
const RE_ACCOUNT = {
  id: "acc-re",
  entityId: ENTITY_ID,
  code: "3100",
  name: "Retained Earnings",
  type: "EQUITY",
  normalBalance: "CREDIT",
  isActive: true
};

const REVENUE_ACCOUNT_1 = {
  id: "acc-rev-1",
  entityId: ENTITY_ID,
  code: "4000",
  name: "Room Revenue",
  type: "REVENUE",
  normalBalance: "CREDIT",
  isActive: true
};

const REVENUE_ACCOUNT_2 = {
  id: "acc-rev-2",
  entityId: ENTITY_ID,
  code: "4100",
  name: "F&B Revenue",
  type: "REVENUE",
  normalBalance: "CREDIT",
  isActive: true
};

const EXPENSE_ACCOUNT_1 = {
  id: "acc-exp-1",
  entityId: ENTITY_ID,
  code: "5000",
  name: "Salaries",
  type: "EXPENSE",
  normalBalance: "DEBIT",
  isActive: true
};

const EXPENSE_ACCOUNT_2 = {
  id: "acc-exp-2",
  entityId: ENTITY_ID,
  code: "5100",
  name: "Utilities",
  type: "EXPENSE",
  normalBalance: "DEBIT",
  isActive: true
};

const YE_CONFIG = {
  id: "yec-1",
  entityId: ENTITY_ID,
  retainedEarningsCode: "3100",
  journalTypeCode: "YE",
  fiscalYearStartMonth: 1,
  description: "Standard year-end"
};

const IC_SOURCE_PAIR = {
  id: "ic-pair-src",
  entityId: ENTITY_ID,
  counterpartyEntityId: MIRROR_ENTITY_ID,
  icReceivableCode: "1300",
  icPayableCode: "2300",
  isActive: true
};

const IC_MIRROR_PAIR = {
  id: "ic-pair-mir",
  entityId: MIRROR_ENTITY_ID,
  counterpartyEntityId: ENTITY_ID,
  icReceivableCode: "1300",
  icPayableCode: "2300",
  isActive: true
};

const IC_REC_ACCOUNT = {
  id: "acc-ic-rec",
  entityId: ENTITY_ID,
  code: "1300",
  name: "IC Receivable",
  isActive: true
};

const IC_PAY_ACCOUNT = {
  id: "acc-ic-pay",
  entityId: MIRROR_ENTITY_ID,
  code: "2300",
  name: "IC Payable",
  isActive: true
};

// ── Mock Prisma ────────────────────────────────────────────────────────────────

function createMockPrisma() {
  const mock: any = {
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
    // Cleardown re-runs the balance carry-forward into the following period so
    // the next fiscal year cannot open holding un-swept P&L. Both helpers use
    // raw SQL. Default to "no following period", which keeps these unit tests
    // focused on the sweep itself; the carry-forward interaction is covered in
    // tests/integration/year-end-cleardown.test.ts against real Postgres.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    entity: {
      findFirst: vi.fn().mockResolvedValue(ENTITY)
    },
    account: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    journal: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "journal-1" })
    },
    period: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([])
    },
    yearEndConfig: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    accountPeriodBalance: {
      findMany: vi.fn().mockResolvedValue([])
    },
    periodCloseStatus: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({})
    },
    auditEvent: {
      create: vi
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ id: "audit-1", ...data }))
    },
    processLock: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "lock-1" }),
      deleteMany: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({})
    },
    intercompanyAccountPair: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "ic-pair-new", ...data })),
      update: vi
        .fn()
        .mockImplementation(({ data, where }) => Promise.resolve({ id: where.id, ...data }))
    },
    intercompanyJournal: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "icj-1",
          ...data,
          amount: data.amount,
          createdAt: new Date()
        })
      ),
      update: vi.fn().mockImplementation(({ data, where }) =>
        Promise.resolve({
          id: where.id,
          sourceEntityId: ENTITY_ID,
          mirrorEntityId: MIRROR_ENTITY_ID,
          amount: 10000,
          currency: "USD",
          reference: "IC-001",
          description: "Test IC",
          createdById: ACTOR_ID,
          sourceApprovedAt: null,
          mirrorApprovedAt: null,
          sourceJournalId: null,
          mirrorJournalId: null,
          createdAt: new Date(),
          ...data
        })
      )
    }
  };
  return mock;
}

let mockPrisma: ReturnType<typeof createMockPrisma>;
let balanceSpy: any;

beforeEach(() => {
  vi.restoreAllMocks();
  mockPrisma = createMockPrisma();
  balanceSpy = vi
    .spyOn(GLRepository.prototype, "batchUpdateAccountBalances")
    .mockResolvedValue(undefined as any);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 1: Year-End Cleardown
// ═══════════════════════════════════════════════════════════════════════════════

// Mock ProcessLockService — path must match what year-end-cleardown.ts imports
vi.mock("../src/modules/process-lock/service.js", () => {
  return {
    ProcessLockService: class {
      acquireLock = vi.fn().mockResolvedValue({});
      releaseLock = vi.fn().mockResolvedValue({});
    }
  };
});

describe("Year-End Cleardown", () => {
  // ── P&L Sweep to Retained Earnings ──────────────────────────────────────

  describe("P&L sweep", () => {
    it("sweeps revenue and expense accounts to retained earnings", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null); // no existing YE journal
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1, EXPENSE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 50000 }, // canonical: revenue positive
        { accountId: "acc-exp-1", closingBalance: 30000 } // canonical: expense positive
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]); // no later periods

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: PERIOD_ID
      });

      expect(result.totalRevenue).toBe(50000);
      expect(result.totalExpense).toBe(30000);
      expect(result.netProfitLoss).toBe(20000);
      expect(result.lines).toHaveLength(2);
      expect(result.journalId).toBe("journal-1");
      expect(result.retainedEarningsCode).toBe("3100");
    });

    it("posts a balanced journal with correct DR/CR per P&L account", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([
        REVENUE_ACCOUNT_1,
        REVENUE_ACCOUNT_2,
        EXPENSE_ACCOUNT_1,
        EXPENSE_ACCOUNT_2
      ]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 80000 },
        { accountId: "acc-rev-2", closingBalance: 20000 },
        { accountId: "acc-exp-1", closingBalance: 45000 },
        { accountId: "acc-exp-2", closingBalance: 15000 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID });

      const createCall = mockPrisma.journal.create.mock.calls[0][0];
      const lines = createCall.data.lines.create;

      // 4 P&L lines + 1 RE offset = 5 lines
      expect(lines).toHaveLength(5);

      // Total debits must equal total credits (balanced journal)
      const totalDR = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
      const totalCR = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
      expect(totalDR).toBeCloseTo(totalCR, 2);

      // Journal source is YEAREND
      expect(createCall.data.source).toBe("YEAREND");
      expect(createCall.data.status).toBe("POSTED");
    });

    it("updates account balances so the cleardown actually zeroes the TB (NF2)", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1, EXPENSE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 100000 }, // canonical: revenue positive
        { accountId: "acc-exp-1", closingBalance: 60000 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID });

      expect(balanceSpy).toHaveBeenCalledTimes(1);
      const [entityArg, periodArg, lines] = balanceSpy.mock.calls[0] as any[];
      expect(entityArg).toBe(ENTITY_ID);
      expect(periodArg).toBe(PERIOD_ID);

      const toNum = (v: any) => (typeof v?.toNumber === "function" ? v.toNumber() : Number(v));
      const byAccount = new Map(lines.map((l: any) => [l.accountId, l]));
      // DR revenue 100000 zeroes the credit-normal balance
      expect(toNum((byAccount.get("acc-rev-1") as any).debitFunctional)).toBe(100000);
      expect((byAccount.get("acc-rev-1") as any).accountType).toBe("REVENUE");
      // CR expense 60000 zeroes the debit-normal balance
      expect(toNum((byAccount.get("acc-exp-1") as any).creditFunctional)).toBe(60000);
      // CR retained earnings 40000 (profit)
      expect(toNum((byAccount.get("acc-re") as any).creditFunctional)).toBe(40000);
      expect((byAccount.get("acc-re") as any).accountType).toBe("EQUITY");
    });

    it("sets yearEndProcessed = true on PeriodCloseStatus", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 10000 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID });

      // Should create PeriodCloseStatus since none exists
      expect(mockPrisma.periodCloseStatus.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ yearEndProcessed: true })
        })
      );
    });

    it("updates existing PeriodCloseStatus instead of creating", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 5000 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);
      mockPrisma.periodCloseStatus.findFirst.mockResolvedValue({
        id: "pcs-1",
        entityId: ENTITY_ID,
        periodId: PERIOD_ID,
        yearEndProcessed: false
      });

      await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID });

      expect(mockPrisma.periodCloseStatus.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pcs-1" },
          data: { yearEndProcessed: true }
        })
      );
    });
  });

  // ── Fiscal Year Validation ──────────────────────────────────────────────

  describe("fiscal year validation", () => {
    it("rejects non-final-period (January FY start, June period)", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_JUNE);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);

      await expect(
        runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: "period-jun" })
      ).rejects.toThrow("final period");
    });

    it("accepts December for standard January fiscal year", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: PERIOD_ID
      });

      // No P&L accounts = empty result, but no error thrown
      expect(result.lines).toHaveLength(0);
    });

    it("accepts March for April fiscal year start", async () => {
      const aprilConfig = { ...YE_CONFIG, fiscalYearStartMonth: 4 };
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_MARCH);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(aprilConfig);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: "period-mar"
      });

      expect(result.lines).toHaveLength(0);
    });

    it("rejects December when fiscal year starts in April", async () => {
      const aprilConfig = { ...YE_CONFIG, fiscalYearStartMonth: 4 };
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(aprilConfig);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);

      await expect(
        runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID })
      ).rejects.toThrow("final period");
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  describe("idempotency", () => {
    it("rejects if year-end cleardown already run for fiscal year", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue({
        id: "existing-ye",
        reference: "YE-2026-CLEARDOWN",
        source: "YEAREND"
      });

      await expect(
        runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID })
      ).rejects.toThrow("already been run");
    });
  });

  // ── Configurable Retained Earnings ──────────────────────────────────────

  describe("configurable RE account", () => {
    it("uses input override retainedEarningsCode over config", async () => {
      const altRE = { ...RE_ACCOUNT, id: "acc-re-alt", code: "3200", name: "Alt RE" };
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(altRE);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 10000 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: PERIOD_ID,
        retainedEarningsCode: "3200"
      });

      expect(result.retainedEarningsCode).toBe("3200");
    });

    it("throws when no RE account configured and none passed", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(null); // no config

      await expect(
        runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID })
      ).rejects.toThrow("Retained earnings account code not configured");
    });

    it("throws when RE account code not found in chart of accounts", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(null); // account not found
      mockPrisma.period.findMany.mockResolvedValue([]);

      await expect(
        runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID })
      ).rejects.toThrow("not found");
    });
  });

  // ── Zero Balance / Empty ────────────────────────────────────────────────

  describe("zero balance edge cases", () => {
    it("returns empty result when no P&L accounts exist", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: PERIOD_ID
      });

      expect(result.lines).toHaveLength(0);
      expect(result.journalId).toBeNull();
      expect(result.netProfitLoss).toBe(0);
    });

    it("skips accounts with zero closing balance", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1, EXPENSE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 10000 },
        { accountId: "acc-exp-1", closingBalance: 0 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: PERIOD_ID
      });

      // Only the revenue account should appear (expense has zero balance)
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].accountCode).toBe("4000");
    });

    it("returns empty result and updates PeriodCloseStatus when all balances are zero", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_1, EXPENSE_ACCOUNT_1]);
      mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
        { accountId: "acc-rev-1", closingBalance: 0.001 }, // below 0.01 threshold
        { accountId: "acc-exp-1", closingBalance: 0 }
      ]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      const result = await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, {
        periodId: PERIOD_ID
      });

      expect(result.lines).toHaveLength(0);
      expect(result.journalId).toBeNull();
      // Still updates PeriodCloseStatus even with no journal
      expect(mockPrisma.periodCloseStatus.create).toHaveBeenCalled();
    });
  });

  // ── Process Lock ────────────────────────────────────────────────────────

  describe("process lock", () => {
    it("acquires and releases YEAR_END lock", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);
      mockPrisma.journal.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(RE_ACCOUNT);
      mockPrisma.account.findMany.mockResolvedValue([]);
      mockPrisma.period.findMany.mockResolvedValue([]);

      // Should not throw — lock mock resolves
      await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID });
    });
  });

  // ── Period Not Found ────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws when period not found", async () => {
      mockPrisma.period.findFirst.mockResolvedValue(null);
      mockPrisma.yearEndConfig.findFirst.mockResolvedValue(YE_CONFIG);

      await expect(
        runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: "nonexistent" })
      ).rejects.toThrow("Period not found");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2: Intercompany Service
// ═══════════════════════════════════════════════════════════════════════════════

describe("IntercompanyService", () => {
  let service: IntercompanyService;

  beforeEach(() => {
    service = new IntercompanyService(mockPrisma);
  });

  // ── IC Account Pair CRUD ────────────────────────────────────────────────

  describe("Account Pairs", () => {
    it("lists active account pairs", async () => {
      mockPrisma.intercompanyAccountPair.findMany.mockResolvedValue([IC_SOURCE_PAIR]);
      const result = await service.listAccountPairs(ENTITY_ID);
      expect(result).toHaveLength(1);
      expect(mockPrisma.intercompanyAccountPair.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityId: ENTITY_ID, isActive: true }
        })
      );
    });

    it("creates an account pair when valid", async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(MIRROR_ENTITY);
      mockPrisma.intercompanyAccountPair.findFirst.mockResolvedValue(null); // no existing
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(IC_REC_ACCOUNT) // receivable
        .mockResolvedValueOnce(IC_PAY_ACCOUNT); // payable

      const result = await service.createAccountPair(ENTITY_ID, {
        counterpartyEntityId: MIRROR_ENTITY_ID,
        icReceivableCode: "1300",
        icPayableCode: "2300"
      });

      expect(result.id).toBe("ic-pair-new");
      expect(mockPrisma.intercompanyAccountPair.create).toHaveBeenCalled();
    });

    it("rejects duplicate account pair", async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(MIRROR_ENTITY);
      mockPrisma.intercompanyAccountPair.findFirst.mockResolvedValue(IC_SOURCE_PAIR);

      await expect(
        service.createAccountPair(ENTITY_ID, {
          counterpartyEntityId: MIRROR_ENTITY_ID,
          icReceivableCode: "1300",
          icPayableCode: "2300"
        })
      ).rejects.toThrow("already exists");
    });

    it("rejects when counterparty entity not found", async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(null);

      await expect(
        service.createAccountPair(ENTITY_ID, {
          counterpartyEntityId: "nonexistent",
          icReceivableCode: "1300",
          icPayableCode: "2300"
        })
      ).rejects.toThrow("Counterparty entity not found");
    });

    it("soft-deletes an account pair", async () => {
      mockPrisma.intercompanyAccountPair.findFirst.mockResolvedValue(IC_SOURCE_PAIR);

      await service.deleteAccountPair(ENTITY_ID, "ic-pair-src");

      expect(mockPrisma.intercompanyAccountPair.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ic-pair-src" },
          data: { isActive: false }
        })
      );
    });

    it("throws 404 when deleting non-existent pair", async () => {
      mockPrisma.intercompanyAccountPair.findFirst.mockResolvedValue(null);

      await expect(service.deleteAccountPair(ENTITY_ID, "nonexistent")).rejects.toThrow(
        "not found"
      );
    });
  });

  // ── IC Journal Creation ─────────────────────────────────────────────────

  describe("IC Journal creation", () => {
    it("creates an IC journal in PENDING_BOTH_APPROVAL status", async () => {
      // Mirror entity exists
      mockPrisma.entity.findFirst.mockResolvedValue(MIRROR_ENTITY);
      // Source pair
      mockPrisma.intercompanyAccountPair.findFirst
        .mockResolvedValueOnce(IC_SOURCE_PAIR) // source → mirror
        .mockResolvedValueOnce(IC_MIRROR_PAIR); // mirror → source
      // Period exists
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD_DEC);

      const result = await service.createICJournal(
        ENTITY_ID,
        {
          mirrorEntityId: MIRROR_ENTITY_ID,
          periodId: PERIOD_ID,
          amount: 10000,
          currency: "USD",
          reference: "IC-001"
        },
        ACTOR_ID
      );

      expect(result.status).toBe("PENDING_BOTH_APPROVAL");
      expect(result.sourceEntityId).toBe(ENTITY_ID);
      expect(result.mirrorEntityId).toBe(MIRROR_ENTITY_ID);
      expect(result.amount).toBe(10000);
    });

    it("rejects when mirror entity not found", async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(null);

      await expect(
        service.createICJournal(
          ENTITY_ID,
          {
            mirrorEntityId: "nonexistent",
            periodId: PERIOD_ID,
            amount: 5000,
            currency: "USD",
            reference: "IC-002"
          },
          ACTOR_ID
        )
      ).rejects.toThrow("Mirror entity not found");
    });

    it("rejects when no source account pair configured", async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(MIRROR_ENTITY);
      mockPrisma.intercompanyAccountPair.findFirst.mockResolvedValue(null);

      await expect(
        service.createICJournal(
          ENTITY_ID,
          {
            mirrorEntityId: MIRROR_ENTITY_ID,
            periodId: PERIOD_ID,
            amount: 5000,
            currency: "USD",
            reference: "IC-003"
          },
          ACTOR_ID
        )
      ).rejects.toThrow("No IC account pair configured");
    });

    it("rejects when no mirror-side account pair exists", async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(MIRROR_ENTITY);
      mockPrisma.intercompanyAccountPair.findFirst
        .mockResolvedValueOnce(IC_SOURCE_PAIR) // source → mirror exists
        .mockResolvedValueOnce(null); // mirror → source missing

      await expect(
        service.createICJournal(
          ENTITY_ID,
          {
            mirrorEntityId: MIRROR_ENTITY_ID,
            periodId: PERIOD_ID,
            amount: 5000,
            currency: "USD",
            reference: "IC-004"
          },
          ACTOR_ID
        )
      ).rejects.toThrow("No mirror IC account pair configured.");
    });
  });

  // ── Dual Approval Flow ──────────────────────────────────────────────────

  describe("dual approval", () => {
    const PENDING_ICJ = {
      id: "icj-1",
      sourceEntityId: ENTITY_ID,
      mirrorEntityId: MIRROR_ENTITY_ID,
      status: "PENDING_BOTH_APPROVAL",
      amount: 10000,
      currency: "USD",
      reference: "IC-001",
      description: "Test IC",
      createdById: ACTOR_ID,
      sourceApprovedAt: null,
      mirrorApprovedAt: null,
      sourceJournalId: null,
      mirrorJournalId: null,
      createdAt: new Date()
    };

    it("transitions to PENDING_MIRROR_APPROVAL when source approves first", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(PENDING_ICJ);

      const result = await service.approveICJournal("icj-1", ENTITY_ID, ACTOR_ID);

      expect(result.status).toBe("PENDING_MIRROR_APPROVAL");
    });

    it("transitions to PENDING_SOURCE_APPROVAL when mirror approves first", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(PENDING_ICJ);

      const result = await service.approveICJournal("icj-1", MIRROR_ENTITY_ID, "user-2");

      expect(result.status).toBe("PENDING_SOURCE_APPROVAL");
    });

    it("auto-posts journals when both entities have approved", async () => {
      const partiallyApproved = {
        ...PENDING_ICJ,
        status: "PENDING_MIRROR_APPROVAL",
        sourceApprovedAt: new Date(),
        sourceApprovedById: ACTOR_ID
      };
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(partiallyApproved);

      // After update, status becomes APPROVED which triggers posting
      mockPrisma.intercompanyJournal.update.mockResolvedValueOnce({
        ...partiallyApproved,
        status: "APPROVED",
        mirrorApprovedAt: new Date(),
        mirrorApprovedById: "user-2"
      });

      // Posting mocks
      mockPrisma.intercompanyAccountPair.findFirst
        .mockResolvedValueOnce(IC_SOURCE_PAIR)
        .mockResolvedValueOnce(IC_MIRROR_PAIR);
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(IC_REC_ACCOUNT) // source receivable
        .mockResolvedValueOnce(IC_PAY_ACCOUNT); // mirror payable
      mockPrisma.period.findFirst
        .mockResolvedValueOnce(PERIOD_DEC) // mirror period
        .mockResolvedValueOnce(PERIOD_DEC); // source period
      mockPrisma.entity.findFirst
        .mockResolvedValueOnce(ENTITY) // source entity
        .mockResolvedValueOnce(MIRROR_ENTITY); // mirror entity
      mockPrisma.journal.create
        .mockResolvedValueOnce({ id: "src-journal-1" })
        .mockResolvedValueOnce({ id: "mir-journal-1" });
      // Final IC journal update after posting
      mockPrisma.intercompanyJournal.update.mockResolvedValueOnce({
        ...partiallyApproved,
        status: "POSTED",
        sourceJournalId: "src-journal-1",
        mirrorJournalId: "mir-journal-1",
        mirrorApprovedAt: new Date(),
        mirrorApprovedById: "user-2"
      });

      const result = await service.approveICJournal("icj-1", MIRROR_ENTITY_ID, "user-2");

      expect(result.status).toBe("POSTED");
      expect(result.sourceJournalId).toBe("src-journal-1");
      expect(result.mirrorJournalId).toBe("mir-journal-1");
    });

    it("rejects approval from non-party entity", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(PENDING_ICJ);

      await expect(service.approveICJournal("icj-1", "entity-99", "user-3")).rejects.toThrow(
        "not a party"
      );
    });

    it("rejects duplicate approval from same entity", async () => {
      const alreadyApprovedBySource = {
        ...PENDING_ICJ,
        status: "PENDING_MIRROR_APPROVAL",
        sourceApprovedAt: new Date(),
        sourceApprovedById: ACTOR_ID
      };
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(alreadyApprovedBySource);

      await expect(service.approveICJournal("icj-1", ENTITY_ID, ACTOR_ID)).rejects.toThrow(
        "already approved"
      );
    });

    it("rejects approval of already-posted IC journal", async () => {
      const postedICJ = { ...PENDING_ICJ, status: "POSTED" };
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(postedICJ);

      await expect(service.approveICJournal("icj-1", ENTITY_ID, ACTOR_ID)).rejects.toThrow(
        "already posted"
      );
    });
  });

  // ── Rejection ───────────────────────────────────────────────────────────

  describe("rejection", () => {
    const PENDING_ICJ = {
      id: "icj-1",
      sourceEntityId: ENTITY_ID,
      mirrorEntityId: MIRROR_ENTITY_ID,
      status: "PENDING_BOTH_APPROVAL",
      amount: 10000,
      currency: "USD",
      reference: "IC-001",
      description: "Test IC",
      sourceApprovedAt: null,
      mirrorApprovedAt: null,
      createdAt: new Date()
    };

    it("allows source entity to reject", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(PENDING_ICJ);

      const result = await service.rejectICJournal(
        "icj-1",
        ENTITY_ID,
        ACTOR_ID,
        "Incorrect amount"
      );

      expect(result.status).toBe("REJECTED");
      expect(mockPrisma.intercompanyJournal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "REJECTED",
            rejectedById: ACTOR_ID,
            rejectionReason: "Incorrect amount"
          })
        })
      );
    });

    it("allows mirror entity to reject", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(PENDING_ICJ);

      const result = await service.rejectICJournal("icj-1", MIRROR_ENTITY_ID, "user-2", "Dispute");

      expect(result.status).toBe("REJECTED");
    });

    it("rejects rejection from non-party entity", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(PENDING_ICJ);

      await expect(service.rejectICJournal("icj-1", "entity-99", "user-3")).rejects.toThrow(
        "not a party"
      );
    });

    it("rejects rejection of already-posted IC journal", async () => {
      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue({
        ...PENDING_ICJ,
        status: "POSTED"
      });

      await expect(service.rejectICJournal("icj-1", ENTITY_ID, ACTOR_ID)).rejects.toThrow(
        "already posted"
      );
    });
  });

  // ── Consolidation Elimination ───────────────────────────────────────────

  describe("consolidation elimination", () => {
    it("returns posted IC journals for given entity set", async () => {
      const postedICJ = {
        id: "icj-1",
        sourceEntityId: ENTITY_ID,
        mirrorEntityId: MIRROR_ENTITY_ID,
        status: "POSTED",
        amount: 10000,
        currency: "USD"
      };
      mockPrisma.intercompanyJournal.findMany.mockResolvedValue([postedICJ]);

      const result = await service.getPostedICJournalsForElimination([ENTITY_ID, MIRROR_ENTITY_ID]);

      expect(result).toHaveLength(1);
      expect(mockPrisma.intercompanyJournal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "POSTED",
            sourceEntityId: { in: [ENTITY_ID, MIRROR_ENTITY_ID] },
            mirrorEntityId: { in: [ENTITY_ID, MIRROR_ENTITY_ID] }
          })
        })
      );
    });
  });

  // ── IC Journal Posting (dimension1 = INTERCOMPANY) ──────────────────────

  describe("IC journal posting", () => {
    it("creates source and mirror journals with INTERCOMPANY dimension", async () => {
      const approvedICJ = {
        id: "icj-1",
        sourceEntityId: ENTITY_ID,
        mirrorEntityId: MIRROR_ENTITY_ID,
        status: "PENDING_MIRROR_APPROVAL",
        amount: 15000,
        currency: "USD",
        reference: "IC-005",
        description: "Shared services",
        createdById: ACTOR_ID,
        sourceApprovedAt: new Date(),
        sourceApprovedById: ACTOR_ID,
        mirrorApprovedAt: null,
        sourceJournalId: null,
        mirrorJournalId: null,
        createdAt: new Date()
      };

      mockPrisma.intercompanyJournal.findFirst.mockResolvedValue(approvedICJ);

      // After approval update → APPROVED triggers posting
      mockPrisma.intercompanyJournal.update.mockResolvedValueOnce({
        ...approvedICJ,
        status: "APPROVED",
        mirrorApprovedAt: new Date(),
        mirrorApprovedById: "user-2"
      });

      // Posting setup
      mockPrisma.intercompanyAccountPair.findFirst
        .mockResolvedValueOnce(IC_SOURCE_PAIR)
        .mockResolvedValueOnce(IC_MIRROR_PAIR);
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(IC_REC_ACCOUNT)
        .mockResolvedValueOnce(IC_PAY_ACCOUNT);
      mockPrisma.period.findFirst
        .mockResolvedValueOnce(PERIOD_DEC)
        .mockResolvedValueOnce(PERIOD_DEC);
      mockPrisma.entity.findFirst
        .mockResolvedValueOnce(ENTITY)
        .mockResolvedValueOnce(MIRROR_ENTITY);
      mockPrisma.journal.create
        .mockResolvedValueOnce({ id: "src-j" })
        .mockResolvedValueOnce({ id: "mir-j" });
      mockPrisma.intercompanyJournal.update.mockResolvedValueOnce({
        ...approvedICJ,
        status: "POSTED",
        sourceJournalId: "src-j",
        mirrorJournalId: "mir-j"
      });

      await service.approveICJournal("icj-1", MIRROR_ENTITY_ID, "user-2");

      // Verify source journal created with INTERCO source and INTERCOMPANY dimension
      const sourceJournalCall = mockPrisma.journal.create.mock.calls[0][0];
      expect(sourceJournalCall.data.source).toBe("INTERCO");
      expect(sourceJournalCall.data.lines.create[0].dimension1).toBe("INTERCOMPANY");

      // Verify mirror journal also has INTERCOMPANY dimension
      const mirrorJournalCall = mockPrisma.journal.create.mock.calls[1][0];
      expect(mirrorJournalCall.data.source).toBe("INTERCO");
      expect(mirrorJournalCall.data.lines.create[0].dimension1).toBe("INTERCOMPANY");
    });
  });
});
