import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock("../src/shared/rabbitmq.js", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/jobs/mv-refresh-job.js", () => ({
  enqueueMVRefresh: vi.fn().mockResolvedValue(undefined)
}));

import { FixedAssetService, FixedAssetServiceError } from "../src/modules/fixed-asset/service.js";

// ── Mock DB ────────────────────────────────────────────────────────────────

type MockAsset = {
  id: string;
  entityId: string;
  assetCode: string;
  lookupCode: string | null;
  description: string;
  categoryId: string | null;
  category: any | null;
  status: string;
  depreciationMethod: string;
  depreciationRate: number | null;
  usefulLifeMonths: number;
  grossValue: number;
  accumulatedDepreciation: number;
  netValue: number;
  finalValue: number;
  acquisitionDate: Date;
  disposalDate: Date | null;
  bsDepreciationAccount: string;
  plDepreciationAccount: string;
  assetQuantity: number | null;
  analysisCode1: string | null;
  analysisCode2: string | null;
  analysisCode3: string | null;
  analysisCode4: string | null;
  analysisCode5: string | null;
  createdById: string;
};

type MockCategory = {
  id: string;
  entityId: string;
  code: string;
  name: string;
  defaultUsefulLifeMonths: number | null;
  defaultDepreciationMethod: string | null;
  defaultBsDepreciationAcct: string | null;
  defaultPlDepreciationAcct: string | null;
  isActive: boolean;
  sortOrder: number;
};

type MockAccount = {
  id: string;
  entityId: string;
  code: string;
  type: string;
  isActive: boolean;
};

type MockPeriod = {
  id: string;
  entityId: string;
  status: string;
  year: number;
  month: number;
  name: string;
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

let assets: MockAsset[];
let categories: MockCategory[];
let accounts: MockAccount[];
let periods: MockPeriod[];
let locks: MockLock[];
let journals: any[];
let pcsRecords: any[];
let ledgerSetups: any[];
let balances: any[];
let idCounter: number;

const ENTITY_ID = "entity-1";
const USER_ID = "user-1";
const PERIOD_ID = "period-1";

function makeMockPrisma() {
  assets = [];
  categories = [];
  accounts = [];
  periods = [];
  locks = [];
  journals = [];
  pcsRecords = [];
  ledgerSetups = [];
  balances = [];
  idCounter = 0;

  function nextId(prefix: string) {
    idCounter++;
    return `${prefix}-${idCounter}`;
  }

  const prisma = {
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    assetCategory: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const cat = categories.find(
          (c) =>
            c.entityId === where.entityId &&
            (where.id ? c.id === where.id : true) &&
            (where.code ? c.code === where.code : true)
        );
        return Promise.resolve(cat ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(categories.filter((c) => c.entityId === where.entityId));
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const cat: MockCategory = {
          id: nextId("cat"),
          entityId: data.entityId,
          code: data.code,
          name: data.name,
          defaultUsefulLifeMonths: data.defaultUsefulLifeMonths ?? null,
          defaultDepreciationMethod: data.defaultDepreciationMethod ?? null,
          defaultBsDepreciationAcct: data.defaultBsDepreciationAcct ?? null,
          defaultPlDepreciationAcct: data.defaultPlDepreciationAcct ?? null,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0
        };
        categories.push(cat);
        return Promise.resolve(cat);
      })
    },
    fixedAsset: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const asset = assets.find(
          (a) =>
            (where.entityId ? a.entityId === where.entityId : true) &&
            (where.id ? a.id === where.id : true) &&
            (where.assetCode ? a.assetCode === where.assetCode : true)
        );
        return Promise.resolve(asset ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        let result = assets.filter((a) => a.entityId === where.entityId);
        if (where.status) result = result.filter((a) => a.status === where.status);
        return Promise.resolve(result);
      }),
      create: vi.fn().mockImplementation(({ data, include }: any) => {
        const asset: MockAsset = {
          id: nextId("asset"),
          entityId: data.entityId,
          assetCode: data.assetCode,
          lookupCode: data.lookupCode ?? null,
          description: data.description,
          categoryId: data.categoryId ?? null,
          category: null,
          status: data.status ?? "ACTIVE",
          depreciationMethod: data.depreciationMethod ?? "STRAIGHT_LINE",
          depreciationRate: data.depreciationRate ?? null,
          usefulLifeMonths: data.usefulLifeMonths,
          grossValue: data.grossValue,
          accumulatedDepreciation: data.accumulatedDepreciation ?? 0,
          netValue: data.netValue ?? data.grossValue,
          finalValue: data.finalValue ?? 0,
          acquisitionDate: data.acquisitionDate,
          disposalDate: data.disposalDate ?? null,
          bsDepreciationAccount: data.bsDepreciationAccount,
          plDepreciationAccount: data.plDepreciationAccount,
          assetQuantity: data.assetQuantity ?? null,
          analysisCode1: data.analysisCode1 ?? null,
          analysisCode2: data.analysisCode2 ?? null,
          analysisCode3: data.analysisCode3 ?? null,
          analysisCode4: data.analysisCode4 ?? null,
          analysisCode5: data.analysisCode5 ?? null,
          createdById: data.createdById
        };
        assets.push(asset);
        return Promise.resolve(asset);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const asset = assets.find((a) => a.id === where.id);
        if (!asset) throw new Error("Asset not found for update");
        Object.assign(asset, data);
        // Handle Prisma increment syntax
        if (data.accumulatedDepreciation?.increment !== undefined) {
          asset.accumulatedDepreciation += data.accumulatedDepreciation.increment;
        }
        return Promise.resolve(asset);
      })
    },
    account: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const acct = accounts.find(
          (a) =>
            a.entityId === where.entityId &&
            a.code === where.code &&
            a.isActive === (where.isActive ?? true)
        );
        return Promise.resolve(acct ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          accounts.filter(
            (a) =>
              a.entityId === where.entityId && (where.code?.in ?? []).includes(a.code) && a.isActive
          )
        );
      })
    },
    period: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const p = periods.find((p) => p.id === where.id && p.entityId === where.entityId);
        return Promise.resolve(p ?? null);
      })
    },
    ledgerSetup: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const ls = ledgerSetups.find(
          (l) => l.entityId === where.entityId && l.ledger === where.ledger
        );
        return Promise.resolve(ls ?? null);
      })
    },
    processLock: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const lock = locks.find(
          (l) =>
            l.entityId === where.entityId &&
            l.processType === where.processType &&
            l.isActive === where.isActive
        );
        return Promise.resolve(lock ?? null);
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const lock: MockLock = {
          id: nextId("lock"),
          entityId: data.entityId,
          processType: data.processType,
          ledger: data.ledger ?? "A",
          isActive: true,
          expiresAt: data.expiresAt,
          acquiredAt: new Date(),
          releasedAt: null,
          acquiredById: data.acquiredById ?? null,
          workerId: null
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
        locks
          .filter(
            (l) =>
              l.entityId === where.entityId &&
              l.processType === where.processType &&
              l.isActive === where.isActive
          )
          .forEach((l) => Object.assign(l, data));
        return Promise.resolve({ count: 1 });
      })
    },
    journal: {
      create: vi.fn().mockImplementation(({ data, include }: any) => {
        const journal = {
          id: nextId("jnl"),
          ...data,
          lines: (data.lines?.create ?? []).map((l: any, i: number) => ({
            id: nextId("jl"),
            ...l
          }))
        };
        journals.push(journal);
        return Promise.resolve(journal);
      })
    },
    accountPeriodBalance: {
      upsert: vi.fn().mockImplementation(({ where, create, update }: any) => {
        const key = where.entityId_accountId_periodId;
        const existing = balances.find(
          (b: any) =>
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
        const newBal = { ...create, id: nextId("bal") };
        balances.push(newBal);
        return Promise.resolve(newBal);
      })
    },
    periodCloseStatus: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const pcs = pcsRecords.find(
          (p: any) =>
            p.entityId === where.entityId &&
            p.periodId === where.periodId &&
            p.ledger === where.ledger
        );
        return Promise.resolve(pcs ?? null);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const pcs = pcsRecords.find((p: any) => p.id === where.id);
        if (pcs) Object.assign(pcs, data);
        return Promise.resolve(pcs);
      })
    }
  };

  return prisma;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function seedAsset(overrides: Partial<MockAsset> = {}): MockAsset {
  idCounter++;
  const asset: MockAsset = {
    id: `asset-${idCounter}`,
    entityId: ENTITY_ID,
    assetCode: `FA-${String(idCounter).padStart(3, "0")}`,
    lookupCode: null,
    description: `Test Asset ${idCounter}`,
    categoryId: null,
    category: null,
    status: "ACTIVE",
    depreciationMethod: "STRAIGHT_LINE",
    depreciationRate: null,
    usefulLifeMonths: 60,
    grossValue: 120000,
    accumulatedDepreciation: 0,
    netValue: 120000,
    finalValue: 0,
    acquisitionDate: new Date("2025-01-01"),
    disposalDate: null,
    bsDepreciationAccount: "1800",
    plDepreciationAccount: "8200",
    assetQuantity: null,
    analysisCode1: null,
    analysisCode2: null,
    analysisCode3: null,
    analysisCode4: null,
    analysisCode5: null,
    createdById: USER_ID,
    ...overrides
  };
  assets.push(asset);
  return asset;
}

function seedAccounts() {
  accounts.push(
    { id: "acct-bs", entityId: ENTITY_ID, code: "1800", type: "ASSET", isActive: true },
    { id: "acct-pl", entityId: ENTITY_ID, code: "8200", type: "EXPENSE", isActive: true },
    { id: "acct-bank", entityId: ENTITY_ID, code: "1000", type: "ASSET", isActive: true }
  );
}

function seedPeriod(status = "OPEN") {
  periods.push({
    id: PERIOD_ID,
    entityId: ENTITY_ID,
    status,
    year: 2025,
    month: 1,
    name: "January 2025"
  });
}

function seedLedgerSetup(overrides: Record<string, unknown> = {}) {
  ledgerSetups.push({
    id: "ls-1",
    entityId: ENTITY_ID,
    ledger: "A",
    baseCurrency: "USD",
    excludeFinalValueFromDepn: true,
    fullYearDepreciationFirstYear: false,
    lockCalculatedDepreciation: false,
    ...overrides
  });
}

function seedPCS() {
  pcsRecords.push({
    id: "pcs-1",
    entityId: ENTITY_ID,
    periodId: PERIOD_ID,
    ledger: "A",
    depreciationRun: false,
    allocationsRun: false
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

let prisma: ReturnType<typeof makeMockPrisma>;
let service: FixedAssetService;

beforeEach(() => {
  prisma = makeMockPrisma();
  service = new FixedAssetService(prisma as any);
});

describe("Asset Category CRUD", () => {
  it("creates a category", async () => {
    const cat = await service.createCategory(ENTITY_ID, {
      code: "FFE",
      name: "Furniture, Fixtures & Equipment"
    });
    expect(cat.code).toBe("FFE");
    expect(cat.name).toBe("Furniture, Fixtures & Equipment");
    expect(cat.entityId).toBe(ENTITY_ID);
  });

  it("rejects duplicate category code", async () => {
    await service.createCategory(ENTITY_ID, { code: "FFE", name: "FF&E" });
    await expect(
      service.createCategory(ENTITY_ID, { code: "FFE", name: "Duplicate" })
    ).rejects.toThrow("already exists");
  });

  it("lists categories", async () => {
    await service.createCategory(ENTITY_ID, { code: "FFE", name: "FF&E" });
    await service.createCategory(ENTITY_ID, { code: "VEH", name: "Vehicles" });
    const list = await service.listCategories(ENTITY_ID);
    expect(list).toHaveLength(2);
  });
});

describe("Fixed Asset CRUD", () => {
  it("creates an asset with netValue = grossValue", async () => {
    const asset = await service.createAsset(ENTITY_ID, USER_ID, {
      assetCode: "FA-001",
      description: "Guest Room TV",
      grossValue: 5000,
      finalValue: 500,
      usefulLifeMonths: 60,
      bsDepreciationAccount: "1800",
      plDepreciationAccount: "8200",
      acquisitionDate: "2025-01-15"
    });
    expect(asset.assetCode).toBe("FA-001");
    expect(asset.grossValue).toBe(5000);
    expect(asset.netValue).toBe(5000);
    expect(asset.accumulatedDepreciation).toBe(0);
    expect(asset.status).toBe("ACTIVE");
  });

  it("rejects duplicate asset code", async () => {
    await service.createAsset(ENTITY_ID, USER_ID, {
      assetCode: "FA-001",
      description: "TV",
      grossValue: 5000,
      usefulLifeMonths: 60,
      bsDepreciationAccount: "1800",
      plDepreciationAccount: "8200",
      acquisitionDate: "2025-01-15"
    });
    await expect(
      service.createAsset(ENTITY_ID, USER_ID, {
        assetCode: "FA-001",
        description: "Duplicate",
        grossValue: 3000,
        usefulLifeMonths: 36,
        bsDepreciationAccount: "1800",
        plDepreciationAccount: "8200",
        acquisitionDate: "2025-02-01"
      })
    ).rejects.toThrow("already exists");
  });

  it("getAsset returns 404 for missing asset", async () => {
    await expect(service.getAsset(ENTITY_ID, "nonexistent")).rejects.toThrow("not found");
  });

  it("updateAsset changes description and analysis codes", async () => {
    seedAsset({ id: "asset-upd" });
    const updated = await service.updateAsset(ENTITY_ID, "asset-upd", {
      description: "Updated Description",
      analysisCode1: "DEPT-01"
    });
    expect(updated.description).toBe("Updated Description");
    expect(updated.analysisCode1).toBe("DEPT-01");
  });

  it("listAssets filters by status", async () => {
    seedAsset({ status: "ACTIVE" });
    seedAsset({ status: "DISPOSED" });
    const activeAssets = await service.listAssets(ENTITY_ID, { status: "ACTIVE" });
    expect(activeAssets).toHaveLength(1);
    expect(activeAssets[0].status).toBe("ACTIVE");
  });
});

describe("Depreciation Calculation", () => {
  it("straight-line: (gross - final) / usefulLifeMonths", async () => {
    seedAsset({
      grossValue: 120000,
      finalValue: 0,
      usefulLifeMonths: 60,
      depreciationMethod: "STRAIGHT_LINE"
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].depreciationAmount).toBe(2000); // 120000/60
  });

  it("straight-line with residual value", async () => {
    seedAsset({
      grossValue: 120000,
      finalValue: 12000,
      usefulLifeMonths: 60,
      depreciationMethod: "STRAIGHT_LINE"
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines[0].depreciationAmount).toBe(1800); // (120000-12000)/60
  });

  it("reducing balance: netValue * rate/100/12", async () => {
    seedAsset({
      grossValue: 100000,
      netValue: 100000,
      finalValue: 0,
      usefulLifeMonths: 60,
      depreciationMethod: "REDUCING_BALANCE",
      depreciationRate: 20
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(1);
    // 100000 * (20/100/12) = 1666.6667
    expect(result.lines[0].depreciationAmount).toBeCloseTo(1666.6667, 2);
  });

  it("reducing balance with partially depreciated asset", async () => {
    seedAsset({
      grossValue: 100000,
      accumulatedDepreciation: 20000,
      netValue: 80000,
      finalValue: 0,
      usefulLifeMonths: 60,
      depreciationMethod: "REDUCING_BALANCE",
      depreciationRate: 20
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    // 80000 * (20/100/12) = 1333.3333
    expect(result.lines[0].depreciationAmount).toBeCloseTo(1333.3333, 2);
  });

  it("sum-of-digits: remaining/sumTotal * depreciableBase", async () => {
    // Asset with 12-month life, no prior depreciation
    seedAsset({
      grossValue: 78000,
      accumulatedDepreciation: 0,
      netValue: 78000,
      finalValue: 0,
      usefulLifeMonths: 12,
      depreciationMethod: "SUM_OF_DIGITS"
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    // Sum total = 12*13/2 = 78
    // First month: remainingMonths = 12, amount = (12/78) * 78000 = 12000
    expect(result.lines[0].depreciationAmount).toBe(12000);
  });

  it("NONE method returns zero", async () => {
    seedAsset({ depreciationMethod: "NONE" });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(0);
  });

  it("USER_TABLE stub returns zero", async () => {
    seedAsset({ depreciationMethod: "USER_TABLE" });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(0);
  });

  it("caps depreciation at netValue - finalValue", async () => {
    // Asset nearly fully depreciated: only 500 left above finalValue
    seedAsset({
      grossValue: 60000,
      accumulatedDepreciation: 59500,
      netValue: 500,
      finalValue: 0,
      usefulLifeMonths: 60,
      depreciationMethod: "STRAIGHT_LINE"
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    // SL monthly = 60000/60 = 1000, but capped at 500 (netValue - 0)
    expect(result.lines[0].depreciationAmount).toBe(500);
  });

  it("skips fully depreciated asset (netValue <= finalValue)", async () => {
    seedAsset({
      grossValue: 60000,
      accumulatedDepreciation: 60000,
      netValue: 0,
      finalValue: 0,
      usefulLifeMonths: 60,
      depreciationMethod: "STRAIGHT_LINE"
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(0);
  });

  it("excludeFinalValueFromDepn=false means depreciable base = grossValue", async () => {
    seedAsset({
      grossValue: 120000,
      finalValue: 12000,
      netValue: 120000,
      usefulLifeMonths: 60,
      depreciationMethod: "STRAIGHT_LINE"
    });
    seedLedgerSetup({ excludeFinalValueFromDepn: false });

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    // finalValue treated as 0 => 120000/60 = 2000
    expect(result.lines[0].depreciationAmount).toBe(2000);
  });

  it("multiple assets accumulate correctly", async () => {
    seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 }); // 1000/month
    seedAsset({ grossValue: 120000, finalValue: 0, usefulLifeMonths: 60 }); // 2000/month
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(2);
    expect(result.totalDepreciation).toBe(3000);
  });

  it("zero rate reducing balance returns zero", async () => {
    seedAsset({
      depreciationMethod: "REDUCING_BALANCE",
      depreciationRate: 0,
      grossValue: 100000,
      netValue: 100000
    });
    seedLedgerSetup();

    const result = await service.calculateDepreciation(ENTITY_ID, PERIOD_ID);
    expect(result.lines).toHaveLength(0);
  });
});

describe("Depreciation Execution", () => {
  it("posts journal with DR P&L, CR BS lines", async () => {
    seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    const result = await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(result.journalId).toBeDefined();
    expect(result.totalDepreciation).toBe(1000);

    // Verify journal was created
    expect(journals).toHaveLength(1);
    const journal = journals[0];
    expect(journal.source).toBe("DEPRC");
    expect(journal.status).toBe("POSTED");
    expect(journal.lines).toHaveLength(2);

    // DR P&L depreciation expense
    const drLine = journal.lines.find((l: any) => l.accountId === "acct-pl");
    expect(drLine.debit).toBe("1000.0000");
    expect(drLine.credit).toBe("0");

    // CR BS accumulated depreciation
    const crLine = journal.lines.find((l: any) => l.accountId === "acct-bs");
    expect(crLine.debit).toBe("0");
    expect(crLine.credit).toBe("1000.0000");
  });

  it("updates asset accumulatedDepreciation and netValue", async () => {
    const asset = seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(asset.accumulatedDepreciation).toBe(1000);
    expect(asset.netValue).toBe(59000);
    expect(asset.status).toBe("ACTIVE");
  });

  it("sets FULLY_DEPRECIATED when netValue reaches finalValue", async () => {
    const asset = seedAsset({
      grossValue: 60000,
      accumulatedDepreciation: 59000,
      netValue: 1000,
      finalValue: 0,
      usefulLifeMonths: 60
    });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(asset.status).toBe("FULLY_DEPRECIATED");
  });

  it("acquires and releases DEPRECIATION lock", async () => {
    seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    // Lock was created
    expect(locks.length).toBeGreaterThanOrEqual(1);
    const depnLock = locks.find((l) => l.processType === "DEPRECIATION");
    expect(depnLock).toBeDefined();
  });

  it("rejects CLOSED period", async () => {
    seedAsset();
    seedAccounts();
    seedPeriod("CLOSED");
    seedLedgerSetup();

    await expect(service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID)).rejects.toThrow(
      "OPEN or SOFT_CLOSE"
    );
  });

  it("allows SOFT_CLOSE period", async () => {
    seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 });
    seedAccounts();
    seedPeriod("SOFT_CLOSE");
    seedLedgerSetup();
    seedPCS();

    const result = await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(result.totalDepreciation).toBe(1000);
  });

  it("sets depreciationRun flag on PeriodCloseStatus", async () => {
    seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(pcsRecords[0].depreciationRun).toBe(true);
  });

  it("returns empty result if no assets need depreciation", async () => {
    // No assets
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    const result = await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(result.lines).toHaveLength(0);
    expect(result.totalDepreciation).toBe(0);
    expect(journals).toHaveLength(0);
  });

  it("updates account period balances via upsert", async () => {
    seedAsset({ grossValue: 60000, finalValue: 0, usefulLifeMonths: 60 });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();
    seedPCS();

    await service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID);
    expect(balances.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects when period not found", async () => {
    seedAsset();
    seedAccounts();
    seedLedgerSetup();
    // no period seeded

    await expect(service.runDepreciation(ENTITY_ID, PERIOD_ID, USER_ID)).rejects.toThrow(
      "not found"
    );
  });
});

describe("Lifecycle — Dispose", () => {
  it("disposes asset and calculates gain", async () => {
    seedAsset({
      id: "asset-disp",
      grossValue: 100000,
      accumulatedDepreciation: 40000,
      netValue: 60000,
      finalValue: 0
    });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();

    const result = await service.disposeAsset(ENTITY_ID, "asset-disp", USER_ID, {
      disposalDate: "2025-06-30",
      disposalProceeds: 70000,
      proceedsAccountCode: "1000",
      periodId: PERIOD_ID
    });

    expect(result.gainLoss).toBe(10000); // 70000 - 60000 = gain
    expect(result.asset.status).toBe("DISPOSED");
    expect(result.asset.netValue).toBe(0);
  });

  it("disposes asset and calculates loss", async () => {
    seedAsset({
      id: "asset-disp2",
      grossValue: 100000,
      accumulatedDepreciation: 40000,
      netValue: 60000,
      finalValue: 0
    });
    seedAccounts();
    seedPeriod("OPEN");
    seedLedgerSetup();

    const result = await service.disposeAsset(ENTITY_ID, "asset-disp2", USER_ID, {
      disposalDate: "2025-06-30",
      disposalProceeds: 50000,
      proceedsAccountCode: "1000",
      periodId: PERIOD_ID
    });

    expect(result.gainLoss).toBe(-10000); // 50000 - 60000 = loss
  });

  it("rejects disposing an already disposed asset", async () => {
    seedAsset({ id: "asset-disposed", status: "DISPOSED" });

    await expect(
      service.disposeAsset(ENTITY_ID, "asset-disposed", USER_ID, {
        disposalDate: "2025-06-30",
        disposalProceeds: 0,
        proceedsAccountCode: "1000",
        periodId: PERIOD_ID
      })
    ).rejects.toThrow("already disposed");
  });
});

describe("Lifecycle — Transfer", () => {
  it("updates analysis codes", async () => {
    seedAsset({ id: "asset-xfer" });

    const result = await service.transferAsset(ENTITY_ID, "asset-xfer", USER_ID, {
      analysisCode1: "DEPT-FRONT",
      analysisCode2: "LOC-LOBBY"
    });

    expect(result.analysisCode1).toBe("DEPT-FRONT");
    expect(result.analysisCode2).toBe("LOC-LOBBY");
  });
});

describe("Lifecycle — Revalue", () => {
  it("increases gross value and recalculates net", async () => {
    seedAsset({
      id: "asset-rev",
      grossValue: 100000,
      accumulatedDepreciation: 20000,
      netValue: 80000,
      finalValue: 0
    });

    const result = await service.revalueAsset(ENTITY_ID, "asset-rev", USER_ID, {
      newGrossValue: 130000
    });

    expect(result.grossValue).toBe(130000);
    expect(result.netValue).toBe(110000); // 130000 - 20000
    expect(result.status).toBe("ACTIVE");
  });

  it("rejects revaluing a disposed asset", async () => {
    seedAsset({ id: "asset-rev-disp", status: "DISPOSED" });

    await expect(
      service.revalueAsset(ENTITY_ID, "asset-rev-disp", USER_ID, { newGrossValue: 50000 })
    ).rejects.toThrow("disposed");
  });

  it("sets FULLY_DEPRECIATED when revalue reduces below accumulated", async () => {
    seedAsset({
      id: "asset-rev-full",
      grossValue: 100000,
      accumulatedDepreciation: 80000,
      netValue: 20000,
      finalValue: 5000
    });

    const result = await service.revalueAsset(ENTITY_ID, "asset-rev-full", USER_ID, {
      newGrossValue: 80000
    });

    // newNet = 80000 - 80000 = 0, which is <= finalValue(5000) + 0.0001
    expect(result.status).toBe("FULLY_DEPRECIATED");
  });
});

describe("Lifecycle — Write-off", () => {
  it("sets netValue to 0 and status to FULLY_DEPRECIATED", async () => {
    seedAsset({
      id: "asset-wo",
      grossValue: 50000,
      accumulatedDepreciation: 10000,
      netValue: 40000
    });

    const result = await service.writeOffAsset(ENTITY_ID, "asset-wo", USER_ID);
    expect(result.netValue).toBe(0);
    expect(result.accumulatedDepreciation).toBe(50000);
    expect(result.status).toBe("FULLY_DEPRECIATED");
  });

  it("rejects writing off a disposed asset", async () => {
    seedAsset({ id: "asset-wo-disp", status: "DISPOSED" });

    await expect(service.writeOffAsset(ENTITY_ID, "asset-wo-disp", USER_ID)).rejects.toThrow(
      "disposed"
    );
  });
});
