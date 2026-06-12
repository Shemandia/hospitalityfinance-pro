import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PaymentProfileService,
  PaymentProfileServiceError
} from "../src/modules/ap/payment-profile-service.js";
import {
  runLedgerRevaluation,
  LedgerRevaluationError
} from "../src/modules/fx/ledger-revaluation.js";
import { GLRepository } from "../src/modules/gl/repository.js";

function toNum(value: unknown): number {
  if (value && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const ENTITY_ID = "entity-1";
const PERIOD_ID = "period-1";
const NEXT_PERIOD_ID = "period-2";
const ACTOR_ID = "user-1";

const PROFILE_PAY = {
  id: "prof-pay-1",
  entityId: ENTITY_ID,
  name: "Weekly Bank Transfer",
  direction: "PAY",
  paymentMethod: "BANK_TRANSFER",
  bankAccountId: "1200",
  currency: "USD",
  fxHandling: "ORIGINAL",
  selectionCriteria: {
    supplierIds: ["sup-1", "sup-2"],
    dueDateFrom: "2026-01-01",
    dueDateTo: "2026-12-31"
  },
  groupingRules: { consolidatePerSupplier: true, consolidatePerCustomer: true },
  totalPaymentLimit: 100000,
  remittanceAdvice: true,
  isActive: true,
  isSystem: false,
  description: "Weekly payment run"
};

const PROFILE_COLLECT = {
  id: "prof-col-1",
  entityId: ENTITY_ID,
  name: "Monthly DD",
  direction: "COLLECT",
  paymentMethod: "BANK_TRANSFER",
  bankAccountId: "1200",
  currency: null,
  fxHandling: "ORIGINAL",
  selectionCriteria: {},
  groupingRules: { consolidatePerSupplier: true, consolidatePerCustomer: true },
  totalPaymentLimit: null,
  remittanceAdvice: false,
  isActive: true,
  isSystem: false,
  description: "Monthly direct debit"
};

const PROFILE_SYSTEM = {
  id: "prof-sys-1",
  entityId: ENTITY_ID,
  name: "Default",
  direction: "PAY",
  paymentMethod: "BANK_TRANSFER",
  isActive: true,
  isSystem: true
};

const PERIOD = {
  id: PERIOD_ID,
  entityId: ENTITY_ID,
  year: 2026,
  month: 3,
  name: "March 2026",
  status: "OPEN"
};

const NEXT_PERIOD = {
  id: NEXT_PERIOD_ID,
  entityId: ENTITY_ID,
  year: 2026,
  month: 4,
  name: "April 2026",
  status: "OPEN"
};

const ENTITY = { id: ENTITY_ID, functionalCurrency: "USD" };

// ── Mock Prisma ────────────────────────────────────────────────────────────────

function createMockPrisma() {
  const mock: any = {
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
    paymentProfile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "new-prof", ...data })),
      update: vi
        .fn()
        .mockImplementation(({ data, where }) => Promise.resolve({ id: where.id, ...data }))
    },
    aRInvoice: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({})
    },
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
    journalLine: {
      findMany: vi.fn().mockResolvedValue([])
    },
    period: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    revaluationProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "rp-1", ...data })),
      update: vi.fn().mockResolvedValue({})
    },
    fXRate: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    periodCloseStatus: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({})
    },
    processLock: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "lock-1" }),
      deleteMany: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({})
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
// Part 1: Payment Profile Service
// ═══════════════════════════════════════════════════════════════════════════════

describe("PaymentProfileService", () => {
  let service: PaymentProfileService;

  beforeEach(() => {
    service = new PaymentProfileService(mockPrisma);
  });

  // ── CRUD ────────────────────────────────────────────────────────────────

  describe("listProfiles", () => {
    it("returns all active profiles ordered by system then name", async () => {
      mockPrisma.paymentProfile.findMany.mockResolvedValue([PROFILE_SYSTEM, PROFILE_PAY]);
      const result = await service.listProfiles(ENTITY_ID);
      expect(result).toHaveLength(2);
      expect(mockPrisma.paymentProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityId: ENTITY_ID, isActive: true }
        })
      );
    });

    it("filters by direction when provided", async () => {
      mockPrisma.paymentProfile.findMany.mockResolvedValue([PROFILE_COLLECT]);
      await service.listProfiles(ENTITY_ID, "COLLECT");
      expect(mockPrisma.paymentProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityId: ENTITY_ID, isActive: true, direction: "COLLECT" }
        })
      );
    });
  });

  describe("getProfile", () => {
    it("returns profile when found", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_PAY);
      const result = await service.getProfile(ENTITY_ID, "prof-pay-1");
      expect(result.name).toBe("Weekly Bank Transfer");
    });

    it("throws 404 when not found", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(null);
      await expect(service.getProfile(ENTITY_ID, "nonexistent")).rejects.toThrow(
        PaymentProfileServiceError
      );
      try {
        await service.getProfile(ENTITY_ID, "nonexistent");
      } catch (e: any) {
        expect(e.code).toBe("PAYMENT_PROFILE_NOT_FOUND");
        expect(e.statusCode).toBe(404);
      }
    });
  });

  describe("createProfile", () => {
    it("creates profile with all fields", async () => {
      await service.createProfile(ENTITY_ID, {
        name: "Test",
        direction: "PAY",
        paymentMethod: "BANK_TRANSFER",
        fxHandling: "ORIGINAL",
        remittanceAdvice: true,
        selectionCriteria: {},
        groupingRules: { consolidatePerSupplier: true, consolidatePerCustomer: true }
      });
      expect(mockPrisma.paymentProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityId: ENTITY_ID,
            name: "Test",
            direction: "PAY"
          })
        })
      );
    });
  });

  describe("updateProfile", () => {
    it("updates non-system profile", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_PAY);
      await service.updateProfile(ENTITY_ID, "prof-pay-1", { name: "Updated" });
      expect(mockPrisma.paymentProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prof-pay-1" },
          data: { name: "Updated" }
        })
      );
    });

    it("rejects update of system profile", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_SYSTEM);
      await expect(
        service.updateProfile(ENTITY_ID, "prof-sys-1", { name: "Hacked" })
      ).rejects.toThrow("System profiles cannot be modified");
    });
  });

  describe("deleteProfile", () => {
    it("soft-deletes by setting isActive=false", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_PAY);
      await service.deleteProfile(ENTITY_ID, "prof-pay-1");
      expect(mockPrisma.paymentProfile.update).toHaveBeenCalledWith({
        where: { id: "prof-pay-1" },
        data: { isActive: false }
      });
    });

    it("rejects deletion of system profile", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_SYSTEM);
      await expect(service.deleteProfile(ENTITY_ID, "prof-sys-1")).rejects.toThrow(
        "System profiles cannot be deleted"
      );
    });
  });

  // ── resolveProfileCriteria ──────────────────────────────────────────────

  describe("resolveProfileCriteria", () => {
    it("resolves PAY profile into payment run parameters", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_PAY);
      const result = await service.resolveProfileCriteria(ENTITY_ID, "prof-pay-1");
      expect(result.supplierIds).toEqual(["sup-1", "sup-2"]);
      expect(result.bankFileFormat).toBe("SWIFT_MT103");
      expect(result.profileId).toBe("prof-pay-1");
      expect(result.includePosted).toBe(true);
      expect(result.includeApproved).toBe(true);
    });

    it("uses CSV format for CHEQUE method", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue({
        ...PROFILE_PAY,
        paymentMethod: "CHEQUE"
      });
      const result = await service.resolveProfileCriteria(ENTITY_ID, "prof-pay-1");
      expect(result.bankFileFormat).toBe("CSV");
    });

    it("rejects COLLECT profile for payment runs", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_COLLECT);
      await expect(service.resolveProfileCriteria(ENTITY_ID, "prof-col-1")).rejects.toThrow(
        "Only PAY profiles can be used for payment runs"
      );
    });
  });

  // ── Collection Run ──────────────────────────────────────────────────────

  describe("runCollection", () => {
    const collectInput = {
      profileId: "prof-col-1",
      periodId: PERIOD_ID,
      referencePrefix: "COL"
    };

    it("returns zero when no matching invoices", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_COLLECT);
      mockPrisma.aRInvoice.findMany.mockResolvedValue([]);
      const result = await service.runCollection(ENTITY_ID, collectInput, ACTOR_ID);
      expect(result.collectedCount).toBe(0);
      expect(result.totalAmount).toBe(0);
      expect(result.journalId).toBeNull();
    });

    it("creates DR Bank / CR AR journal for collected invoices", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_COLLECT);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.aRInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          entityId: ENTITY_ID,
          customerId: "cust-1",
          amount: 5000,
          amountPaid: 0,
          currency: "USD",
          dueDate: new Date("2026-03-01"),
          customer: { id: "cust-1", name: "Hotel A", code: "HA" }
        },
        {
          id: "inv-2",
          entityId: ENTITY_ID,
          customerId: "cust-1",
          amount: 3000,
          amountPaid: 1000,
          currency: "USD",
          dueDate: new Date("2026-03-15"),
          customer: { id: "cust-1", name: "Hotel A", code: "HA" }
        }
      ]);

      const bankAccount = { id: "acc-bank", code: "1200", entityId: ENTITY_ID, isActive: true };
      const arAccount = {
        id: "acc-ar",
        code: "1200",
        entityId: ENTITY_ID,
        isActive: true,
        isControlAccount: true
      };

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(bankAccount)
        .mockResolvedValueOnce(arAccount);

      const result = await service.runCollection(ENTITY_ID, collectInput, ACTOR_ID);

      expect(result.collectedCount).toBe(2);
      expect(result.totalAmount).toBe(7000); // 5000 + 2000 outstanding
      expect(result.journalId).toBe("journal-1");

      // Verify journal creation
      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(1);
      const journalCall = mockPrisma.journal.create.mock.calls[0][0];
      expect(journalCall.data.source).toBe("COLLN");
      expect(journalCall.data.status).toBe("POSTED");

      // Verify journal lines: 1 DR Bank + 1 CR AR (grouped per customer)
      const journalLines = journalCall.data.lines.create;
      expect(journalLines).toHaveLength(2);

      // DR Bank
      const drLine = journalLines.find((l: any) => l.debit > 0);
      expect(toNum(drLine.debit)).toBe(7000);
      expect(toNum(drLine.credit)).toBe(0);
      expect(drLine.accountId).toBe("acc-bank");

      // CR AR Control
      const crLine = journalLines.find((l: any) => l.credit > 0);
      expect(toNum(crLine.credit)).toBe(7000);
      expect(toNum(crLine.debit)).toBe(0);
      expect(crLine.accountId).toBe("acc-ar");
    });

    it("updates invoice statuses to PAID", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_COLLECT);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.aRInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          entityId: ENTITY_ID,
          customerId: "cust-1",
          amount: 1000,
          amountPaid: 0,
          currency: "USD",
          customer: { id: "cust-1", name: "Cust", code: "C1" }
        }
      ]);
      mockPrisma.account.findFirst
        .mockResolvedValueOnce({ id: "acc-bank", code: "1200", isActive: true })
        .mockResolvedValueOnce({
          id: "acc-ar",
          code: "1200",
          isActive: true,
          isControlAccount: true
        });

      await service.runCollection(ENTITY_ID, collectInput, ACTOR_ID);

      expect(mockPrisma.aRInvoice.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: { amountPaid: { increment: 1000 }, status: "PAID" }
      });
    });

    it("rejects PAY profile for collection runs", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_PAY);
      await expect(service.runCollection(ENTITY_ID, collectInput, ACTOR_ID)).rejects.toThrow(
        "Only COLLECT profiles can be used for collection runs"
      );
    });

    it("throws when total exceeds profile limit", async () => {
      const limitedProfile = { ...PROFILE_COLLECT, totalPaymentLimit: 1000 };
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(limitedProfile);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.aRInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          entityId: ENTITY_ID,
          customerId: "cust-1",
          amount: 5000,
          amountPaid: 0,
          currency: "USD",
          customer: { id: "cust-1", name: "Cust", code: "C1" }
        }
      ]);

      await expect(service.runCollection(ENTITY_ID, collectInput, ACTOR_ID)).rejects.toThrow(
        "exceeds profile limit"
      );
    });

    it("throws when bank or AR account missing", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_COLLECT);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.aRInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          entityId: ENTITY_ID,
          customerId: "cust-1",
          amount: 1000,
          amountPaid: 0,
          currency: "USD",
          customer: { id: "cust-1", name: "Cust", code: "C1" }
        }
      ]);
      mockPrisma.account.findFirst.mockResolvedValue(null);

      await expect(service.runCollection(ENTITY_ID, collectInput, ACTOR_ID)).rejects.toThrow(
        "Bank account or AR control account not found"
      );
    });

    it("skips fully-paid invoices", async () => {
      mockPrisma.paymentProfile.findFirst.mockResolvedValue(PROFILE_COLLECT);
      mockPrisma.aRInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          entityId: ENTITY_ID,
          customerId: "cust-1",
          amount: 1000,
          amountPaid: 1000, // Fully paid
          currency: "USD",
          customer: { id: "cust-1", name: "Cust", code: "C1" }
        }
      ]);

      const result = await service.runCollection(ENTITY_ID, collectInput, ACTOR_ID);
      expect(result.collectedCount).toBe(0);
      expect(result.journalId).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2: Ledger Revaluation Engine
// ═══════════════════════════════════════════════════════════════════════════════

// Mock ProcessLockService — path must match what ledger-revaluation.ts imports
vi.mock("../src/modules/process-lock/service.js", () => {
  return {
    ProcessLockService: class {
      acquireLock = vi.fn().mockResolvedValue({});
      releaseLock = vi.fn().mockResolvedValue({});
    }
  };
});

describe("Ledger Revaluation Engine", () => {
  const REVAL_PROFILE = {
    id: "rp-1",
    entityId: ENTITY_ID,
    name: "BS Reval",
    accountTypeFilter: ["ASSET", "LIABILITY"],
    accountCodeFrom: null,
    accountCodeTo: null,
    currencyFilter: null,
    rateType: "CLOSING",
    gainAccountCode: "7100",
    lossAccountCode: "7200",
    autoReverse: true,
    postDifferences: true,
    isActive: true,
    description: "Balance sheet revaluation"
  };

  const ACCOUNTS = [
    { id: "acc-1", entityId: ENTITY_ID, code: "1000", name: "Cash", type: "ASSET", isActive: true },
    { id: "acc-2", entityId: ENTITY_ID, code: "1200", name: "AR", type: "ASSET", isActive: true }
  ];

  const GAIN_ACCOUNT = {
    id: "acc-gain",
    entityId: ENTITY_ID,
    code: "7100",
    name: "FX Gain",
    type: "REVENUE",
    isActive: true
  };
  const LOSS_ACCOUNT = {
    id: "acc-loss",
    entityId: ENTITY_ID,
    code: "7200",
    name: "FX Loss",
    type: "EXPENSE",
    isActive: true
  };

  const BASE_INPUT = {
    profileId: "rp-1",
    periodId: PERIOD_ID,
    closingDate: "2026-03-31"
  };

  describe("rate calculation", () => {
    it("uses closing rate when rateType=CLOSING", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue(ACCOUNTS);

      // Account acc-1 has EUR lines
      mockPrisma.journalLine.findMany
        .mockResolvedValueOnce([
          {
            currency: "EUR",
            debit: 1000,
            credit: 0,
            fxRate: 1.1,
            debitFunctional: 1100,
            creditFunctional: 0
          }
        ])
        .mockResolvedValueOnce([]); // acc-2 has no foreign lines

      // Closing rate EUR->USD = 1.15
      mockPrisma.fXRate.findFirst.mockResolvedValue({
        rate: 1.15,
        fromCurrency: "EUR",
        toCurrency: "USD",
        rateType: "CLOSING",
        effectiveDate: new Date("2026-03-31")
      });

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      // FC balance = 1000 EUR. Old functional = 1100. New = 1000 * 1.15 = 1150. Diff = +50
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].currency).toBe("EUR");
      expect(result.lines[0].difference).toBe(50);
      expect(result.totalGain).toBe(50);
      expect(result.totalLoss).toBe(0);
      expect(result.netGainLoss).toBe(50);
    });

    it("uses custom rate when rateType=CUSTOM", async () => {
      const customProfile = { ...REVAL_PROFILE, rateType: "CUSTOM" };
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(customProfile);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "GBP",
          debit: 500,
          credit: 0,
          fxRate: 1.25,
          debitFunctional: 625,
          creditFunctional: 0
        }
      ]);

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, {
        ...BASE_INPUT,
        customRate: 1.3
      });

      // FC = 500. Old functional = 625. New = 500 * 1.30 = 650. Diff = +25
      expect(result.lines[0].difference).toBe(25);
      expect(result.lines[0].fxRate).toBe(1.3);
    });

    it("falls back to reverse rate if direct rate not found", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);

      // No direct EUR->USD rate; return null first, then USD->EUR = 0.87 (reverse)
      mockPrisma.fXRate.findFirst
        .mockResolvedValueOnce(null) // CLOSING EUR->USD
        .mockResolvedValueOnce({ rate: 0.87, fromCurrency: "USD", toCurrency: "EUR" }); // CLOSING USD->EUR

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      // Reverse rate: 1/0.87 ≈ 1.1494. FC = 1000. New functional = 1149.43. Diff ≈ 49.43
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].fxRate).toBeCloseTo(1 / 0.87, 2);
      expect(result.lines[0].difference).toBeCloseTo(49.43, 0);
    });
  });

  describe("journal generation", () => {
    it("posts revaluation journal with correct DR/CR for gains", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);

      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.journalId).toBe("journal-1");

      // Check the journal create call
      const createCall = mockPrisma.journal.create.mock.calls[0][0];
      expect(createCall.data.source).toBe("REVAL");
      expect(createCall.data.status).toBe("POSTED");
      expect(createCall.data.isAutoReversible).toBe(true);

      // Gain: DR Account, CR Gain
      const lines = createCall.data.lines.create;
      expect(lines).toHaveLength(2);
      expect(lines[0].accountId).toBe("acc-1"); // DR the account
      expect(lines[0].debit).toBe("100.0000"); // 1000*1.2 - 1100 = 100
      expect(lines[1].accountId).toBe("acc-gain"); // CR gain account
      expect(lines[1].credit).toBe("100.0000");
    });

    it("updates account balances for the revaluation journal and its reversal (NF1)", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      // One balance update for the revaluation journal, one for the reversal
      expect(balanceSpy).toHaveBeenCalledTimes(2);

      const [entityArg, periodArg, lines] = balanceSpy.mock.calls[0] as any[];
      expect(entityArg).toBe(ENTITY_ID);
      expect(periodArg).toBe(PERIOD_ID);
      const byAccount = new Map(lines.map((l: any) => [l.accountId, l]));
      // Gain of 100: DR acc-1 (ASSET), CR acc-gain (REVENUE)
      expect(toNum((byAccount.get("acc-1") as any).debitFunctional)).toBe(100);
      expect((byAccount.get("acc-1") as any).accountType).toBe("ASSET");
      expect(toNum((byAccount.get("acc-gain") as any).creditFunctional)).toBe(100);
      expect((byAccount.get("acc-gain") as any).accountType).toBe("REVENUE");

      const [, revPeriodArg, revLines] = balanceSpy.mock.calls[1] as any[];
      expect(revPeriodArg).toBe(NEXT_PERIOD_ID);
      const revByAccount = new Map(revLines.map((l: any) => [l.accountId, l]));
      // Reversal flips the amounts
      expect(toNum((revByAccount.get("acc-1") as any).creditFunctional)).toBe(100);
      expect(toNum((revByAccount.get("acc-gain") as any).debitFunctional)).toBe(100);
    });

    it("posts DR Loss / CR Account for losses", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);

      // Rate dropped: 1000 * 1.05 = 1050, diff = -50 (loss)
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.05 });

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.totalLoss).toBe(50);

      const lines = mockPrisma.journal.create.mock.calls[0][0].data.lines.create;
      // Loss: DR Loss account, CR Account
      expect(lines[0].accountId).toBe("acc-loss");
      expect(lines[0].debit).toBe("50.0000");
      expect(lines[1].accountId).toBe("acc-1");
      expect(lines[1].credit).toBe("50.0000");
    });
  });

  describe("auto-reversal", () => {
    it("creates reversal journal in next period when autoReverse=true", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD); // Next period lookup
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });

      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      // Make second journal.create return different ID for reversal
      mockPrisma.journal.create
        .mockResolvedValueOnce({ id: "journal-reval" })
        .mockResolvedValueOnce({ id: "journal-reversal" });

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.reversalJournalId).toBe("journal-reversal");

      // Two journal.create calls: original + reversal
      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(2);

      // Reversal journal
      const reversalCall = mockPrisma.journal.create.mock.calls[1][0];
      expect(reversalCall.data.periodId).toBe(NEXT_PERIOD_ID);
      expect(reversalCall.data.reversalOfId).toBe("journal-reval");
      expect(reversalCall.data.reference).toMatch(/^REV-LER-/);

      // Lines are swapped
      const origLines = mockPrisma.journal.create.mock.calls[0][0].data.lines.create;
      const revLines = reversalCall.data.lines.create;
      expect(revLines[0].debit).toBe(origLines[0].credit);
      expect(revLines[0].credit).toBe(origLines[0].debit);
    });

    it("skips reversal when autoReverse=false", async () => {
      const noAutoProfile = { ...REVAL_PROFILE, autoReverse: false };
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(noAutoProfile);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.reversalJournalId).toBeNull();
      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(1); // Only the original
    });

    it("skips reversal when no next period exists", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(null); // No next period
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.reversalJournalId).toBeNull();
      expect(mockPrisma.journal.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("gain/loss accounts", () => {
    it("throws when gain account not found", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);
      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.account.findFirst.mockResolvedValue(null); // Both gain and loss not found

      await expect(
        runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT)
      ).rejects.toThrow("Gain account 7100 not found");
    });

    it("throws when loss account not found", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);
      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT) // gain found
        .mockResolvedValueOnce(null); // loss not found

      await expect(
        runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT)
      ).rejects.toThrow("Loss account 7200 not found");
    });
  });

  describe("PeriodCloseStatus update", () => {
    it("creates PeriodCloseStatus when none exists (via postDifferences=false path)", async () => {
      // Use postDifferences=false so revaluation completes without posting journals
      // but still reaches updatePeriodCloseStatus
      const reportProfile = { ...REVAL_PROFILE, postDifferences: false };
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(reportProfile);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });

      await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(mockPrisma.periodCloseStatus.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: ENTITY_ID,
          periodId: PERIOD_ID,
          revaluationRun: true
        })
      });
    });

    it("updates existing PeriodCloseStatus", async () => {
      const reportProfile = { ...REVAL_PROFILE, postDifferences: false };
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(reportProfile);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.periodCloseStatus.findFirst.mockResolvedValue({
        id: "pcs-1",
        entityId: ENTITY_ID,
        periodId: PERIOD_ID,
        revaluationRun: false
      });

      await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(mockPrisma.periodCloseStatus.update).toHaveBeenCalledWith({
        where: { id: "pcs-1" },
        data: { revaluationRun: true }
      });
    });
  });

  describe("edge cases", () => {
    it("throws when profile not found", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(null);
      mockPrisma.period.findFirst.mockResolvedValue(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);

      await expect(
        runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT)
      ).rejects.toThrow("Revaluation profile not found");
    });

    it("throws when period not found", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValue(null);

      await expect(
        runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT)
      ).rejects.toThrow("Period not found");
    });

    it("returns report-only when postDifferences=false", async () => {
      const reportOnlyProfile = { ...REVAL_PROFILE, postDifferences: false };
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(reportOnlyProfile);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        }
      ]);
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.lines).toHaveLength(1);
      expect(result.journalId).toBeNull(); // No journal posted
      expect(mockPrisma.journal.create).not.toHaveBeenCalled();
    });

    it("rejects duplicate revaluation (idempotency)", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.journal.findFirst.mockResolvedValue({ id: "existing-journal" }); // Already run

      await expect(
        runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT)
      ).rejects.toThrow("already been run");
    });

    it("skips currencies with near-zero balance", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 0.00001,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 0.000011,
          creditFunctional: 0
        }
      ]);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      // Balance too small, skipped
      expect(result.lines).toHaveLength(0);
    });

    it("skips differences below MIN_DIFFERENCE_THRESHOLD", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 100,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 110,
          creditFunctional: 0
        }
      ]);

      // Rate 1.10005 → new = 110.005 → diff = 0.005 < 0.01 threshold
      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.10005 });

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.lines).toHaveLength(0);
    });

    it("returns empty result when no accounts match filters", async () => {
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(REVAL_PROFILE);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([]);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      expect(result.profileName).toBe("BS Reval");
      expect(result.lines).toHaveLength(0);
      expect(result.journalId).toBeNull();
    });

    it("applies currency filter from profile", async () => {
      const eurOnlyProfile = { ...REVAL_PROFILE, currencyFilter: "EUR" };
      mockPrisma.revaluationProfile.findFirst.mockResolvedValue(eurOnlyProfile);
      mockPrisma.period.findFirst.mockResolvedValueOnce(PERIOD).mockResolvedValueOnce(NEXT_PERIOD);
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY);
      mockPrisma.account.findMany.mockResolvedValue([ACCOUNTS[0]]);

      // Mixed currencies: EUR and GBP
      mockPrisma.journalLine.findMany.mockResolvedValue([
        {
          currency: "EUR",
          debit: 1000,
          credit: 0,
          fxRate: 1.1,
          debitFunctional: 1100,
          creditFunctional: 0
        },
        {
          currency: "GBP",
          debit: 500,
          credit: 0,
          fxRate: 1.25,
          debitFunctional: 625,
          creditFunctional: 0
        }
      ]);

      mockPrisma.fXRate.findFirst.mockResolvedValue({ rate: 1.2 });
      mockPrisma.account.findFirst
        .mockResolvedValueOnce(GAIN_ACCOUNT)
        .mockResolvedValueOnce(LOSS_ACCOUNT);

      const result = await runLedgerRevaluation(mockPrisma, ENTITY_ID, ACTOR_ID, BASE_INPUT);

      // Only EUR should appear, GBP filtered out
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].currency).toBe("EUR");
    });
  });
});
