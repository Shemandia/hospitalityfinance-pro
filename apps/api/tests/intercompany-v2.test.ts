/**
 * Intercompany v2 Service Tests
 *
 * Tests: atomic dual-posting, approval workflow, rejection, reversal,
 * cross-currency FX, reconciliation balance calculation, self-approval guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "../src/db/client.js";
import {
  IntercompanyService,
  IntercompanyServiceError
} from "../src/modules/intercompany/service.js";
import { GLRepository } from "../src/modules/gl/repository.js";

// ── Test Data ────────────────────────────────────────────────────────────────

const ENTITY_A_ID = "entity-a-id";
const ENTITY_B_ID = "entity-b-id";
const PAIR_ID = "pair-1";
const MAPPING_ID = "mapping-1";
const PERIOD_A_ID = "period-a";
const PERIOD_B_ID = "period-b";
const ACTOR_ID = "user-creator";
const APPROVER_ID = "user-approver";

const ENTITY_A = {
  id: ENTITY_A_ID,
  name: "Hotel Alpha",
  isActive: true,
  functionalCurrency: "USD"
};
const ENTITY_B = { id: ENTITY_B_ID, name: "Hotel Beta", isActive: true, functionalCurrency: "USD" };

const PAIR = {
  id: PAIR_ID,
  entityAId: ENTITY_A_ID,
  entityBId: ENTITY_B_ID,
  isActive: true,
  autoApproveThreshold: null,
  description: "Alpha <> Beta",
  createdAt: new Date(),
  entityA: ENTITY_A,
  entityB: ENTITY_B,
  _count: { accountMappings: 1 }
};

const MAPPING = {
  id: MAPPING_ID,
  pairId: PAIR_ID,
  name: "IC Receivable/Payable",
  entityADebitCode: "1300",
  entityACreditCode: "4000",
  entityBDebitCode: "5000",
  entityBCreditCode: "2300",
  isActive: true,
  pair: PAIR
};

const PERIOD_A = { id: PERIOD_A_ID, entityId: ENTITY_A_ID, year: 2026, month: 4, status: "OPEN" };
const PERIOD_B = { id: PERIOD_B_ID, entityId: ENTITY_B_ID, year: 2026, month: 4, status: "OPEN" };

const ACCOUNT_A_DR = {
  id: "acct-a-dr",
  entityId: ENTITY_A_ID,
  code: "1300",
  type: "ASSET",
  isActive: true
};
const ACCOUNT_A_CR = {
  id: "acct-a-cr",
  entityId: ENTITY_A_ID,
  code: "4000",
  type: "REVENUE",
  isActive: true
};
const ACCOUNT_B_DR = {
  id: "acct-b-dr",
  entityId: ENTITY_B_ID,
  code: "5000",
  type: "EXPENSE",
  isActive: true
};
const ACCOUNT_B_CR = {
  id: "acct-b-cr",
  entityId: ENTITY_B_ID,
  code: "2300",
  type: "LIABILITY",
  isActive: true
};

// ── Mock Factory ─────────────────────────────────────────────────────────────

let journalIdCounter = 0;
let txnIdCounter = 0;

function createMockPrisma() {
  journalIdCounter = 0;
  txnIdCounter = 0;

  const mock: any = {
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),

    entity: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id === ENTITY_A_ID) return Promise.resolve(ENTITY_A);
        if (where.id === ENTITY_B_ID) return Promise.resolve(ENTITY_B);
        return Promise.resolve(null);
      })
    },

    iCEntityPair: {
      findMany: vi.fn().mockResolvedValue([PAIR]),
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id === PAIR_ID || where.entityAId_entityBId) return Promise.resolve(PAIR);
        if (where.OR) return Promise.resolve(null);
        return Promise.resolve(PAIR);
      }),
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: "new-pair",
          ...data,
          isActive: true,
          createdAt: new Date(),
          entityA: ENTITY_A,
          entityB: ENTITY_B,
          _count: { accountMappings: 0 }
        })
      ),
      update: vi
        .fn()
        .mockImplementation(({ where, data }: any) => Promise.resolve({ ...PAIR, ...data }))
    },

    iCAccountMapping: {
      findMany: vi.fn().mockResolvedValue([MAPPING]),
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id === MAPPING_ID) return Promise.resolve(MAPPING);
        return Promise.resolve(MAPPING);
      }),
      create: vi
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "new-mapping", ...data, isActive: true })
        ),
      update: vi
        .fn()
        .mockImplementation(({ where, data }: any) => Promise.resolve({ ...MAPPING, ...data }))
    },

    iCTransaction: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => {
        txnIdCounter++;
        return Promise.resolve({
          id: `txn-${txnIdCounter}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          approvedAt: data.approvedAt ?? null,
          approvedById: data.approvedById ?? null,
          rejectedAt: data.rejectedAt ?? null,
          rejectedById: data.rejectedById ?? null,
          rejectionReason: data.rejectionReason ?? null,
          postedAt: data.postedAt ?? null,
          reversalOfId: data.reversalOfId ?? null
        });
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        return Promise.resolve({
          id: where.id,
          pairId: PAIR_ID,
          mappingId: MAPPING_ID,
          initiatingEntityId: ENTITY_A_ID,
          counterpartyEntityId: ENTITY_B_ID,
          amount: "10000.0000",
          currency: "USD",
          fxRateInitiator: "1.00000000",
          fxRateCounterparty: "1.00000000",
          functionalAmountInitiator: "10000.0000",
          functionalAmountCounterparty: "10000.0000",
          reference: "TEST-001",
          description: "Test IC",
          periodId: PERIOD_A_ID,
          createdById: ACTOR_ID,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        });
      })
    },

    iCReconciliationSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "snap-1", ...data, createdAt: new Date() })
        ),
      update: vi
        .fn()
        .mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data }))
    },

    account: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.entityId === ENTITY_A_ID && where.code === "1300")
          return Promise.resolve(ACCOUNT_A_DR);
        if (where.entityId === ENTITY_A_ID && where.code === "4000")
          return Promise.resolve(ACCOUNT_A_CR);
        if (where.entityId === ENTITY_B_ID && where.code === "5000")
          return Promise.resolve(ACCOUNT_B_DR);
        if (where.entityId === ENTITY_B_ID && where.code === "2300")
          return Promise.resolve(ACCOUNT_B_CR);
        // For reversed codes (swap DR/CR)
        if (where.entityId === ENTITY_A_ID && where.code === "4000")
          return Promise.resolve(ACCOUNT_A_CR);
        if (where.entityId === ENTITY_A_ID && where.code === "1300")
          return Promise.resolve(ACCOUNT_A_DR);
        if (where.entityId === ENTITY_B_ID && where.code === "2300")
          return Promise.resolve(ACCOUNT_B_CR);
        if (where.entityId === ENTITY_B_ID && where.code === "5000")
          return Promise.resolve(ACCOUNT_B_DR);
        return Promise.resolve(null);
      })
    },

    journal: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        journalIdCounter++;
        return Promise.resolve({ id: `journal-${journalIdCounter}`, ...data });
      })
    },

    period: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id === PERIOD_A_ID || where.entityId === ENTITY_A_ID)
          return Promise.resolve(PERIOD_A);
        if (where.id === PERIOD_B_ID || where.entityId === ENTITY_B_ID)
          return Promise.resolve(PERIOD_B);
        return Promise.resolve(null);
      })
    },

    fXRate: {
      findFirst: vi.fn().mockResolvedValue(null)
    }
  };

  return mock;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("IntercompanyService v2", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: IntercompanyService;
  let balanceSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPrisma = createMockPrisma();
    service = new IntercompanyService(mockPrisma);
    balanceSpy = vi
      .spyOn(GLRepository.prototype, "batchUpdateAccountBalances")
      .mockResolvedValue(undefined as any);
  });

  // ── Entity Pair CRUD ──────────────────────────────────────────────────

  describe("Entity Pairs", () => {
    it("lists active entity pairs", async () => {
      const result = await service.listEntityPairs();
      expect(result).toHaveLength(1);
      expect(result[0].entityAId).toBe(ENTITY_A_ID);
      expect(result[0].entityBId).toBe(ENTITY_B_ID);
      expect(result[0].mappingCount).toBe(1);
    });

    it("rejects creating a pair between an entity and itself", async () => {
      await expect(
        service.createEntityPair({ entityAId: ENTITY_A_ID, entityBId: ENTITY_A_ID })
      ).rejects.toThrow("Cannot create an IC pair between an entity and itself");
    });

    it("rejects duplicate entity pairs", async () => {
      // Mock that a pair already exists
      mockPrisma.iCEntityPair.findFirst
        .mockResolvedValueOnce(PAIR) // pair lookup
        .mockResolvedValueOnce(PAIR); // duplicate check

      // Need to set up the findFirst to return PAIR for the OR query
      mockPrisma.iCEntityPair.findFirst.mockImplementation(({ where }: any) => {
        if (where?.OR) return Promise.resolve(PAIR);
        return Promise.resolve(null);
      });

      await expect(
        service.createEntityPair({ entityAId: ENTITY_A_ID, entityBId: ENTITY_B_ID })
      ).rejects.toThrow("IC pair already exists");
    });
  });

  // ── Account Mappings CRUD ─────────────────────────────────────────────

  describe("Account Mappings", () => {
    it("lists mappings for a pair", async () => {
      const result = await service.listAccountMappings(PAIR_ID);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("IC Receivable/Payable");
    });

    it("creates a new mapping with validated accounts", async () => {
      const result = await service.createAccountMapping({
        pairId: PAIR_ID,
        name: "New Template",
        entityADebitCode: "1300",
        entityACreditCode: "4000",
        entityBDebitCode: "5000",
        entityBCreditCode: "2300"
      });

      expect(result.name).toBe("New Template");
      expect(mockPrisma.account.findFirst).toHaveBeenCalledTimes(4);
    });
  });

  // ── Transaction Creation — Atomic Dual-Posting ────────────────────────

  describe("createTransaction — atomic dual-posting", () => {
    it("creates both journals in a single $transaction", async () => {
      const result = await service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "10000",
        currency: "USD",
        reference: "TEST-001",
        description: "Test IC transaction",
        periodId: PERIOD_A_ID
      });

      // $transaction was called exactly once
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // Both journals were created
      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(2);

      // IC transaction was created
      expect(mockPrisma.iCTransaction.create).toHaveBeenCalledTimes(1);

      // Result has journal IDs
      expect(result.initiatorJournalId).toBeTruthy();
      expect(result.counterpartyJournalId).toBeTruthy();
      expect(result.status).toBe("POSTED");
    });

    it("updates account balances in BOTH entities (NF3)", async () => {
      await service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "10000",
        currency: "USD",
        reference: "BAL-001",
        periodId: PERIOD_A_ID
      });

      expect(balanceSpy).toHaveBeenCalledTimes(2);

      const initiatorCall = balanceSpy.mock.calls.find((c: any[]) => c[0] === ENTITY_A_ID) as any[];
      const counterpartyCall = balanceSpy.mock.calls.find(
        (c: any[]) => c[0] === ENTITY_B_ID
      ) as any[];
      expect(initiatorCall).toBeDefined();
      expect(counterpartyCall).toBeDefined();
      expect(initiatorCall[1]).toBe(PERIOD_A_ID);

      const toNum = (v: any) => (typeof v?.toNumber === "function" ? v.toNumber() : Number(v));
      const initiatorLines = initiatorCall[2];
      expect(initiatorLines).toHaveLength(2);
      const drLine = initiatorLines.find((l: any) => l.accountId === "acct-a-dr");
      const crLine = initiatorLines.find((l: any) => l.accountId === "acct-a-cr");
      expect(toNum(drLine.debitFunctional)).toBe(10000);
      expect(drLine.accountType).toBe("ASSET");
      expect(toNum(crLine.creditFunctional)).toBe(10000);
      expect(crLine.accountType).toBe("REVENUE");

      const counterpartyLines = counterpartyCall[2];
      expect(counterpartyLines.map((l: any) => l.accountType)).toEqual(
        expect.arrayContaining(["EXPENSE", "LIABILITY"])
      );
    });

    it("uses Prisma.Decimal for all monetary values", async () => {
      await service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "10000.5050",
        currency: "USD",
        reference: "DEC-001",
        periodId: PERIOD_A_ID
      });

      // Check journal lines use string amounts (Decimal-safe)
      const initiatorJournalCall = mockPrisma.journal.create.mock.calls[0][0];
      const lines = initiatorJournalCall.data.lines.create;
      expect(typeof lines[0].debit).toBe("string");
      expect(typeof lines[0].credit).toBe("string");
      expect(lines[0].debit).toBe("10000.5050");
      expect(lines[1].credit).toBe("10000.5050");
    });

    it("both journals reference each other via IC transaction", async () => {
      await service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "5000",
        currency: "USD",
        reference: "LINK-001",
        periodId: PERIOD_A_ID
      });

      const txnCreateCall = mockPrisma.iCTransaction.create.mock.calls[0][0];
      expect(txnCreateCall.data.initiatorJournalId).toBeTruthy();
      expect(txnCreateCall.data.counterpartyJournalId).toBeTruthy();
      expect(txnCreateCall.data.initiatorJournalId).not.toBe(
        txnCreateCall.data.counterpartyJournalId
      );
    });

    it("creates balanced journals in both entities", async () => {
      await service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "7500",
        currency: "USD",
        reference: "BAL-001",
        periodId: PERIOD_A_ID
      });

      // Both journal creates should have balanced lines
      for (const call of mockPrisma.journal.create.mock.calls) {
        const lines = call[0].data.lines.create;
        const totalDR = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
        const totalCR = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
        expect(totalDR).toBeCloseTo(totalCR, 4);
      }
    });

    it("rejects when initiating entity is not part of the pair", async () => {
      await expect(
        service.createTransaction("entity-unrelated", ACTOR_ID, {
          pairId: PAIR_ID,
          mappingId: MAPPING_ID,
          counterpartyEntityId: ENTITY_B_ID,
          amount: "1000",
          currency: "USD",
          reference: "BAD-001",
          periodId: PERIOD_A_ID
        })
      ).rejects.toThrow("not part of this IC pair");
    });

    it("rejects zero or negative amounts", async () => {
      await expect(
        service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
          pairId: PAIR_ID,
          mappingId: MAPPING_ID,
          counterpartyEntityId: ENTITY_B_ID,
          amount: "0",
          currency: "USD",
          reference: "ZERO-001",
          periodId: PERIOD_A_ID
        })
      ).rejects.toThrow("must be positive");
    });

    it("requires a mapping", async () => {
      await expect(
        service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
          pairId: PAIR_ID,
          counterpartyEntityId: ENTITY_B_ID,
          amount: "1000",
          currency: "USD",
          reference: "NOMAP-001",
          periodId: PERIOD_A_ID
        })
      ).rejects.toThrow("account mapping is required");
    });

    it("handles cross-currency FX rates", async () => {
      await service.createTransaction(ENTITY_A_ID, ACTOR_ID, {
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "1000",
        currency: "EUR",
        reference: "FX-001",
        periodId: PERIOD_A_ID,
        fxRateInitiator: "1.12",
        fxRateCounterparty: "2650.50"
      });

      // Check IC transaction amounts
      const txnCreateCall = mockPrisma.iCTransaction.create.mock.calls[0][0];
      expect(txnCreateCall.data.amount).toBe("1000.0000");
      expect(txnCreateCall.data.currency).toBe("EUR");
      expect(txnCreateCall.data.fxRateInitiator).toBe("1.12000000");
      expect(txnCreateCall.data.fxRateCounterparty).toBe("2650.50000000");
      expect(txnCreateCall.data.functionalAmountInitiator).toBe("1120.0000");
      expect(txnCreateCall.data.functionalAmountCounterparty).toBe("2650500.0000");
    });
  });

  // ── Approval Workflow ─────────────────────────────────────────────────

  describe("approveTransaction", () => {
    it("rejects self-approval", async () => {
      mockPrisma.iCTransaction.findFirst.mockResolvedValueOnce({
        id: "txn-1",
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        status: "PENDING_APPROVAL",
        createdById: ACTOR_ID,
        initiatingEntityId: ENTITY_A_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "10000.0000",
        currency: "USD",
        fxRateInitiator: "1.00000000",
        fxRateCounterparty: "1.00000000",
        functionalAmountInitiator: "10000.0000",
        functionalAmountCounterparty: "10000.0000",
        reference: "TEST-001",
        description: null,
        periodId: PERIOD_A_ID
      });

      await expect(service.approveTransaction("txn-1", ACTOR_ID)).rejects.toThrow(
        "Cannot approve your own IC transaction"
      );
    });

    it("posts journals and updates balances in both entities on approval (NF3)", async () => {
      mockPrisma.iCTransaction.findFirst.mockResolvedValueOnce({
        id: "txn-1",
        pairId: PAIR_ID,
        mappingId: MAPPING_ID,
        status: "PENDING_APPROVAL",
        createdById: ACTOR_ID,
        initiatingEntityId: ENTITY_A_ID,
        counterpartyEntityId: ENTITY_B_ID,
        amount: "10000.0000",
        currency: "USD",
        fxRateInitiator: "1.00000000",
        fxRateCounterparty: "1.00000000",
        functionalAmountInitiator: "10000.0000",
        functionalAmountCounterparty: "10000.0000",
        reference: "TEST-001",
        description: null,
        periodId: PERIOD_A_ID
      });

      await service.approveTransaction("txn-1", APPROVER_ID);

      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(2);
      expect(balanceSpy).toHaveBeenCalledTimes(2);
      expect(balanceSpy.mock.calls.map((c: any[]) => c[0])).toEqual(
        expect.arrayContaining([ENTITY_A_ID, ENTITY_B_ID])
      );
    });

    it("rejects approval of non-pending transactions", async () => {
      mockPrisma.iCTransaction.findFirst.mockResolvedValueOnce({
        id: "txn-1",
        status: "POSTED",
        createdById: ACTOR_ID
      });

      await expect(service.approveTransaction("txn-1", APPROVER_ID)).rejects.toThrow(
        "Cannot approve a transaction in POSTED status"
      );
    });
  });

  // ── Rejection ─────────────────────────────────────────────────────────

  describe("rejectTransaction", () => {
    it("rejects a pending transaction with reason", async () => {
      mockPrisma.iCTransaction.findFirst.mockResolvedValueOnce({
        id: "txn-1",
        status: "PENDING_APPROVAL"
      });

      const result = await service.rejectTransaction("txn-1", ACTOR_ID, "Invalid amount");

      expect(mockPrisma.iCTransaction.update).toHaveBeenCalledWith({
        where: { id: "txn-1" },
        data: expect.objectContaining({
          status: "REJECTED",
          rejectedById: ACTOR_ID,
          rejectionReason: "Invalid amount"
        })
      });
    });

    it("cannot reject a posted transaction", async () => {
      mockPrisma.iCTransaction.findFirst.mockResolvedValueOnce({
        id: "txn-1",
        status: "POSTED"
      });

      await expect(service.rejectTransaction("txn-1", ACTOR_ID)).rejects.toThrow(
        "Cannot reject a transaction in POSTED status"
      );
    });
  });

  // ── Reversal ──────────────────────────────────────────────────────────

  describe("reverseTransaction", () => {
    const POSTED_TXN = {
      id: "txn-posted",
      pairId: PAIR_ID,
      mappingId: MAPPING_ID,
      initiatingEntityId: ENTITY_A_ID,
      counterpartyEntityId: ENTITY_B_ID,
      status: "POSTED",
      amount: "10000.0000",
      currency: "USD",
      fxRateInitiator: "1.00000000",
      fxRateCounterparty: "1.00000000",
      functionalAmountInitiator: "10000.0000",
      functionalAmountCounterparty: "10000.0000",
      reference: "REV-TEST",
      description: "Original IC",
      periodId: PERIOD_A_ID,
      createdById: ACTOR_ID
    };

    it("creates a reversal IC transaction with flipped DR/CR", async () => {
      mockPrisma.iCTransaction.findFirst
        .mockResolvedValueOnce(POSTED_TXN) // original txn lookup
        .mockResolvedValueOnce(null); // existing reversal check

      const result = await service.reverseTransaction(
        "txn-posted",
        APPROVER_ID,
        "Error correction"
      );

      // $transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // Original was marked REVERSED
      expect(mockPrisma.iCTransaction.update).toHaveBeenCalledWith({
        where: { id: "txn-posted" },
        data: { status: "REVERSED" }
      });

      // New reversal transaction was created
      const reversalCreate = mockPrisma.iCTransaction.create.mock.calls[0][0];
      expect(reversalCreate.data.reversalOfId).toBe("txn-posted");
      expect(reversalCreate.data.status).toBe("POSTED");
      expect(reversalCreate.data.reference).toBe("REV-REV-TEST");

      // Two new journals were created (one per entity)
      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(2);

      // NF3: reversal balances updated in both entities
      expect(balanceSpy).toHaveBeenCalledTimes(2);
      expect(balanceSpy.mock.calls.map((c: any[]) => c[0])).toEqual(
        expect.arrayContaining([ENTITY_A_ID, ENTITY_B_ID])
      );
    });

    it("cannot reverse a non-posted transaction", async () => {
      mockPrisma.iCTransaction.findFirst.mockResolvedValueOnce({
        ...POSTED_TXN,
        status: "PENDING_APPROVAL"
      });

      await expect(service.reverseTransaction("txn-1", APPROVER_ID)).rejects.toThrow(
        "Only posted transactions can be reversed"
      );
    });

    it("cannot reverse a transaction twice", async () => {
      mockPrisma.iCTransaction.findFirst
        .mockResolvedValueOnce(POSTED_TXN)
        .mockResolvedValueOnce({ id: "existing-reversal" }); // existing reversal exists

      await expect(service.reverseTransaction("txn-posted", APPROVER_ID)).rejects.toThrow(
        "already been reversed"
      );
    });
  });

  // ── Reconciliation ────────────────────────────────────────────────────

  describe("getReconciliation", () => {
    it("computes balanced reconciliation for same-currency pairs", async () => {
      // Two posted transactions: A initiated 10000, B initiated 5000
      mockPrisma.iCTransaction.findMany.mockResolvedValueOnce([
        {
          id: "txn-1",
          initiatingEntityId: ENTITY_A_ID,
          functionalAmountInitiator: "10000.0000",
          functionalAmountCounterparty: "10000.0000"
        },
        {
          id: "txn-2",
          initiatingEntityId: ENTITY_B_ID,
          functionalAmountInitiator: "5000.0000",
          functionalAmountCounterparty: "5000.0000"
        }
      ]);

      const result = await service.getReconciliation();

      expect(result.pairs).toHaveLength(1);
      const pair = result.pairs[0];
      // A initiated 10000 (A's receivable) and B initiated 5000 (A's payable)
      // Net for A: +10000 - 5000 = +5000
      // Net for B: +10000 - 5000 = +5000
      expect(pair.balanceEntityA).toBe("5000.0000");
      expect(pair.balanceEntityB).toBe("5000.0000");
      expect(pair.difference).toBe("0.0000");
      expect(pair.status).toBe("RECONCILED");
      expect(result.totalUnreconciled).toBe(0);
    });

    it("detects unreconciled balances in cross-currency pairs", async () => {
      // Cross-currency: different functional amounts
      mockPrisma.iCTransaction.findMany.mockResolvedValueOnce([
        {
          id: "txn-1",
          initiatingEntityId: ENTITY_A_ID,
          functionalAmountInitiator: "10000.0000",
          functionalAmountCounterparty: "26505000.0000" // TZS equivalent
        }
      ]);

      const result = await service.getReconciliation();
      const pair = result.pairs[0];
      expect(pair.balanceEntityA).toBe("10000.0000");
      expect(pair.balanceEntityB).toBe("26505000.0000");
      // Large cross-currency difference is expected
      expect(Number(pair.difference)).toBeGreaterThan(0);
      expect(pair.status).toBe("UNRECONCILED");
      expect(result.totalUnreconciled).toBe(1);
    });
  });

  describe("createReconciliationSnapshot", () => {
    it("creates a snapshot for a period", async () => {
      mockPrisma.iCTransaction.findMany.mockResolvedValueOnce([]);

      await service.createReconciliationSnapshot(
        PAIR_ID,
        PERIOD_A_ID,
        ACTOR_ID,
        "Period-end snapshot"
      );

      expect(mockPrisma.iCReconciliationSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pairId: PAIR_ID,
          periodId: PERIOD_A_ID,
          createdById: ACTOR_ID,
          notes: "Period-end snapshot"
        })
      });
    });
  });
});
