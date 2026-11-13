import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "../src/db/client.js";

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock("../src/jobs/mv-refresh-job.js", () => ({
  enqueueMVRefresh: vi.fn().mockResolvedValue(undefined)
}));

import { KPIService, KPIServiceError } from "../src/modules/kpi/service.js";

// ── Test Data ──────────────────────────────────────────────────────────────

const ENTITY_ID = "ent-001";
const PERIOD_ID = "per-2026-03";

const basePeriod = {
  id: PERIOD_ID,
  entityId: ENTITY_ID,
  year: 2026,
  month: 3,
  name: "March 2026",
  status: "OPEN"
};

// Realistic hotel: 48 rooms, 26 occupied on average over 31 days of March
// Available room-nights = 48 × 31 = 1,488
// Occupied room-nights = 26 × 31 = 806
const pmsStats = Array.from({ length: 31 }, (_, i) => ({
  id: `stat-${i}`,
  entityId: ENTITY_ID,
  statDate: new Date(2026, 2, i + 1),
  occupiedRooms: 26,
  availableRooms: 48
}));

// Account balances simulating a typical hotel P&L
// Room Revenue = 7,378.00 (account 30100)
// F&B Revenue = 3,210.50 (account 31000)
// Other Revenue = 890.00 (account 34000)
// F&B Cost = 1,284.20 (account 42000)
// Operating Expenses = 4,520.00 (account 61000)
const balanceRows = [
  {
    code: "30100",
    closing_balance: new Prisma.Decimal("-7378.00"),
    account_type: "REVENUE",
    usali_department: "Rooms"
  },
  {
    code: "31000",
    closing_balance: new Prisma.Decimal("-3210.50"),
    account_type: "REVENUE",
    usali_department: "Food & Beverage"
  },
  {
    code: "34000",
    closing_balance: new Prisma.Decimal("-890.00"),
    account_type: "REVENUE",
    usali_department: null
  },
  {
    code: "42000",
    closing_balance: new Prisma.Decimal("1284.20"),
    account_type: "EXPENSE",
    usali_department: "Food & Beverage"
  },
  {
    code: "61000",
    closing_balance: new Prisma.Decimal("4520.00"),
    account_type: "EXPENSE",
    usali_department: "Rooms"
  }
];

// ── Mock Prisma ────────────────────────────────────────────────────────────

function createMockPrisma(overrides?: { period?: any; stats?: any[]; balances?: any[] }) {
  return {
    period: {
      findFirst: vi.fn().mockResolvedValue(overrides?.period ?? basePeriod)
    },
    pMSStatistic: {
      findMany: vi.fn().mockResolvedValue(overrides?.stats ?? pmsStats)
    },
    $queryRaw: vi.fn().mockResolvedValue(overrides?.balances ?? balanceRows),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined)
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("KPIService", () => {
  describe("getRevPAR — core hospitality KPIs", () => {
    it("calculates Occupancy % correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // 806 occupied / 1488 available × 100 = 54.16...%
      expect(result.occupiedRooms).toBe(806);
      expect(result.availableRooms).toBe(1488);
      expect(result.occupancyPct).toBeCloseTo(54.17, 1);
    });

    it("calculates ADR (Average Daily Rate) correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // ADR = Room Revenue / Occupied Rooms = 7378 / 806 = 9.154...
      const expectedADR = new Prisma.Decimal("7378").div(806);
      expect(result.adr).toBe(expectedADR.toFixed(2));
    });

    it("calculates RevPAR (Revenue Per Available Room) correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // RevPAR = Room Revenue / Available Rooms = 7378 / 1488 = 4.957...
      const expectedRevPAR = new Prisma.Decimal("7378").div(1488);
      expect(result.revpar).toBe(expectedRevPAR.toFixed(2));
    });

    it("calculates TRevPAR (Total Revenue Per Available Room) correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // Total Revenue = 7378 + 3210.50 + 890 = 11478.50
      // TRevPAR = 11478.50 / 1488 = 7.714...
      const totalRevenue = new Prisma.Decimal("11478.50");
      const expectedTRevPAR = totalRevenue.div(1488);
      expect(result.trevpar).toBe(expectedTRevPAR.toFixed(2));
    });

    it("calculates GOP and GOPPAR correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // GOP = Total Revenue - F&B Cost - Operating Expenses
      //     = 11478.50 - 1284.20 - 4520.00 = 5674.30
      const expectedGOP = new Prisma.Decimal("11478.50")
        .sub(new Prisma.Decimal("1284.20"))
        .sub(new Prisma.Decimal("4520.00"));
      expect(result.gopAmount).toBe(expectedGOP.toFixed(2));
      expect(result.gopAmount).toBe("5674.30");
    });

    it("calculates GOP % correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // GOP% = GOP / Total Revenue × 100 = 5674.30 / 11478.50 × 100 = 49.43...%
      const gopPct = new Prisma.Decimal("5674.30").div(new Prisma.Decimal("11478.50")).mul(100);
      expect(result.gopPct).toBe(gopPct.toFixed(2));
    });

    it("calculates F&B revenue and cost correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      expect(result.fbRevenue).toBe("3210.50");
      expect(result.fbCost).toBe("1284.20");
    });

    it("calculates F&B Cost % correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // F&B Cost % = F&B Cost / F&B Revenue × 100 = 1284.20 / 3210.50 × 100 = 39.99...%
      const fbCostPct = new Prisma.Decimal("1284.20").div(new Prisma.Decimal("3210.50")).mul(100);
      expect(result.fbCostPct).toBe(fbCostPct.toFixed(2));
    });

    it("calculates room revenue total correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      expect(result.roomRevenue).toBe("7378.00");
    });

    it("calculates total revenue correctly", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // 7378 + 3210.50 + 890 = 11478.50
      expect(result.totalRevenue).toBe("11478.50");
    });

    it("sets TRevPAC equal to TRevPAR", async () => {
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      expect(result.trevpac).toBe(result.trevpar);
    });
  });

  describe("getRevPAR — edge cases", () => {
    it("throws KPIServiceError when period not found", async () => {
      const prisma = createMockPrisma();
      prisma.period.findFirst.mockResolvedValueOnce(null);
      const svc = new KPIService(prisma);
      await expect(svc.getRevPAR({ entityId: ENTITY_ID, periodId: "nonexistent" })).rejects.toThrow(
        KPIServiceError
      );
    });

    it("returns zero KPIs when no PMS data and no balances", async () => {
      const svc = new KPIService(createMockPrisma({ stats: [], balances: [] }));
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // No PMS stats → defaults to 100 available rooms, 0 occupied
      expect(result.occupiedRooms).toBe(0);
      expect(result.availableRooms).toBe(100);
      expect(result.occupancyPct).toBe(0);
      expect(result.adr).toBe("0.00");
      expect(result.revpar).toBe("0.00");
      expect(result.trevpar).toBe("0.00");
      expect(result.gopAmount).toBe("0.00");
      expect(result.gopPct).toBe("0.00");
    });

    it("handles zero occupied rooms without division error", async () => {
      const statsNoOccupied = Array.from({ length: 31 }, (_, i) => ({
        id: `stat-${i}`,
        entityId: ENTITY_ID,
        statDate: new Date(2026, 2, i + 1),
        occupiedRooms: 0,
        availableRooms: 48
      }));
      const svc = new KPIService(createMockPrisma({ stats: statsNoOccupied }));
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      expect(result.occupancyPct).toBe(0);
      expect(result.adr).toBe("0.00");
    });

    it("classifies revenue by account code when usali_department is null", async () => {
      const balancesNoUSALI = [
        {
          code: "30100",
          closing_balance: new Prisma.Decimal("-5000.00"),
          account_type: "REVENUE",
          usali_department: null
        },
        {
          code: "31500",
          closing_balance: new Prisma.Decimal("-2000.00"),
          account_type: "REVENUE",
          usali_department: null
        },
        {
          code: "34000",
          closing_balance: new Prisma.Decimal("-500.00"),
          account_type: "REVENUE",
          usali_department: null
        },
        {
          code: "42500",
          closing_balance: new Prisma.Decimal("800.00"),
          account_type: "EXPENSE",
          usali_department: null
        },
        {
          code: "61500",
          closing_balance: new Prisma.Decimal("3000.00"),
          account_type: "EXPENSE",
          usali_department: null
        }
      ];
      const svc = new KPIService(createMockPrisma({ balances: balancesNoUSALI }));
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // 30100 → Room Revenue, 31500 → F&B Revenue, 34000 → Other Revenue
      expect(result.roomRevenue).toBe("5000.00");
      expect(result.fbRevenue).toBe("2000.00");
      // Total = 5000 + 2000 + 500 = 7500
      expect(result.totalRevenue).toBe("7500.00");
      // F&B Cost = 800 (42500)
      expect(result.fbCost).toBe("800.00");
    });
  });

  describe("getRevPAR — Decimal precision", () => {
    it("uses Decimal arithmetic (not floating point) for all calculations", async () => {
      // Use values that would cause floating point errors: 0.1 + 0.2 ≠ 0.3
      const precisionBalances = [
        {
          code: "30100",
          closing_balance: new Prisma.Decimal("-0.10"),
          account_type: "REVENUE",
          usali_department: "Rooms"
        },
        {
          code: "31000",
          closing_balance: new Prisma.Decimal("-0.20"),
          account_type: "REVENUE",
          usali_department: "Food & Beverage"
        }
      ];
      const precisionStats = [
        {
          id: "s1",
          entityId: ENTITY_ID,
          statDate: new Date(2026, 2, 1),
          occupiedRooms: 3,
          availableRooms: 10
        }
      ];
      const svc = new KPIService(
        createMockPrisma({
          stats: precisionStats,
          balances: precisionBalances
        })
      );
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // Total Revenue should be exactly 0.30, not 0.30000000000000004
      expect(result.totalRevenue).toBe("0.30");
    });

    it("handles large hotel revenue without precision loss", async () => {
      const largeBalances = [
        {
          code: "30100",
          closing_balance: new Prisma.Decimal("-1234567.89"),
          account_type: "REVENUE",
          usali_department: "Rooms"
        },
        {
          code: "31000",
          closing_balance: new Prisma.Decimal("-987654.32"),
          account_type: "REVENUE",
          usali_department: "Food & Beverage"
        },
        {
          code: "42000",
          closing_balance: new Prisma.Decimal("345678.91"),
          account_type: "EXPENSE",
          usali_department: "Food & Beverage"
        },
        {
          code: "61000",
          closing_balance: new Prisma.Decimal("876543.21"),
          account_type: "EXPENSE",
          usali_department: "Rooms"
        }
      ];
      const largeStats = Array.from({ length: 31 }, (_, i) => ({
        id: `s-${i}`,
        entityId: ENTITY_ID,
        statDate: new Date(2026, 2, i + 1),
        occupiedRooms: 250,
        availableRooms: 400
      }));
      const svc = new KPIService(
        createMockPrisma({
          stats: largeStats,
          balances: largeBalances
        })
      );
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // Total Revenue = 1234567.89 + 987654.32 = 2222222.21
      expect(result.totalRevenue).toBe("2222222.21");
      // GOP = 2222222.21 - 345678.91 - 876543.21 = 1000000.09
      expect(result.gopAmount).toBe("1000000.09");

      // ADR = 1234567.89 / 7750 (250 × 31)
      const expectedADR = new Prisma.Decimal("1234567.89").div(7750);
      expect(result.adr).toBe(expectedADR.toFixed(2));
    });
  });

  describe("getRevPAR — 48-room hotel scenario (full test)", () => {
    it("produces correct results for a realistic 48-room property", async () => {
      // 48-room hotel in March 2026 (31 days)
      // 26 rooms occupied per day average
      const svc = new KPIService(createMockPrisma());
      const result = await svc.getRevPAR({ entityId: ENTITY_ID, periodId: PERIOD_ID });

      // ── Room Stats ──
      // Available room-nights: 48 × 31 = 1,488
      // Occupied room-nights: 26 × 31 = 806
      expect(result.availableRooms).toBe(1488);
      expect(result.occupiedRooms).toBe(806);

      // ── Occupancy ──
      // 806 / 1488 × 100 = 54.1666...%
      const occupancy = new Prisma.Decimal(806).div(1488).mul(100);
      expect(result.occupancyPct).toBeCloseTo(occupancy.toDecimalPlaces(2).toNumber(), 1);

      // ── Revenue ──
      expect(result.roomRevenue).toBe("7378.00");
      expect(result.fbRevenue).toBe("3210.50");
      expect(result.totalRevenue).toBe("11478.50");

      // ── ADR ──
      // 7378 / 806 = 9.1538...
      const adr = new Prisma.Decimal("7378").div(806);
      expect(result.adr).toBe(adr.toFixed(2));

      // ── RevPAR ──
      // 7378 / 1488 = 4.9571...
      const revpar = new Prisma.Decimal("7378").div(1488);
      expect(result.revpar).toBe(revpar.toFixed(2));

      // ── TRevPAR ──
      // 11478.50 / 1488 = 7.7140...
      const trevpar = new Prisma.Decimal("11478.50").div(1488);
      expect(result.trevpar).toBe(trevpar.toFixed(2));

      // ── F&B Cost % ──
      // 1284.20 / 3210.50 × 100 = 39.998...%
      const fbCostPct = new Prisma.Decimal("1284.20").div(new Prisma.Decimal("3210.50")).mul(100);
      expect(result.fbCostPct).toBe(fbCostPct.toFixed(2));

      // ── GOP ──
      // 11478.50 - 1284.20 - 4520.00 = 5674.30
      expect(result.gopAmount).toBe("5674.30");

      // ── GOP % ──
      // 5674.30 / 11478.50 × 100 = 49.43...%
      const gopPct = new Prisma.Decimal("5674.30").div(new Prisma.Decimal("11478.50")).mul(100);
      expect(result.gopPct).toBe(gopPct.toFixed(2));
    });
  });
});
