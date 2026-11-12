import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsolidationService } from "../src/modules/consolidation/service.js";

const PARENT_ID = "parent-1";
const CHILD_ID = "child-1";
const GRANDCHILD_ID = "grandchild-1";
const SIBLING_ID = "sibling-1";
const PERIOD_ID = "period-1";

const ENTITY_TREE: Record<string, { id: string; parentId: string | null }> = {
  [PARENT_ID]: { id: PARENT_ID, parentId: null },
  [CHILD_ID]: { id: CHILD_ID, parentId: PARENT_ID },
  [GRANDCHILD_ID]: { id: GRANDCHILD_ID, parentId: CHILD_ID },
  [SIBLING_ID]: { id: SIBLING_ID, parentId: "other-parent" },
  "other-parent": { id: "other-parent", parentId: null }
};

function createMockPrisma() {
  const mock: any = {
    entity: {
      findUnique: vi
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            ENTITY_TREE[where.id]
              ? { id: where.id, name: where.id, functionalCurrency: "USD" }
              : null
          )
        ),
      findMany: vi
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            (where.id.in as string[])
              .filter((id) => ENTITY_TREE[id])
              .map((id) => ({ id, name: id, functionalCurrency: "USD" }))
          )
        )
    },
    period: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: PERIOD_ID, entityId: PARENT_ID, year: 2026, month: 5 })
    },
    fXRate: { findMany: vi.fn().mockResolvedValue([]) },
    journalLine: { findMany: vi.fn().mockResolvedValue([]) },
    consolidationRun: {
      create: vi.fn().mockResolvedValue({ id: "run-1" })
    },
    // Consolidation reads child journals and persists run rows through
    // withBypassRLS: under the parent's RLS context the children's journals are
    // invisible and consolidation_run_entities inserts are rejected. That helper
    // opens a transaction, so the stub needs one.
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mock)),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $queryRawUnsafe: vi.fn().mockImplementation(async (_sql: string, id: string) => {
      return ENTITY_TREE[id] ? [ENTITY_TREE[id]] : [];
    })
  };
  return mock;
}

describe("Consolidation child-entity lineage validation (NS3)", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: ConsolidationService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new ConsolidationService(mockPrisma);
  });

  it("rejects child entities that are not descendants of the parent (IDOR)", async () => {
    await expect(
      service.runConsolidation({
        parentEntityId: PARENT_ID,
        childEntityIds: [SIBLING_ID],
        reportingCurrency: "USD",
        periodId: PERIOD_ID
      })
    ).rejects.toMatchObject({ code: "CONSOL_CHILD_FORBIDDEN", statusCode: 403 });

    // The materialized view must never be touched for forbidden children
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a mix of valid and forbidden children", async () => {
    await expect(
      service.runConsolidation({
        parentEntityId: PARENT_ID,
        childEntityIds: [CHILD_ID, SIBLING_ID],
        reportingCurrency: "USD",
        periodId: PERIOD_ID
      })
    ).rejects.toMatchObject({ code: "CONSOL_CHILD_FORBIDDEN", statusCode: 403 });
  });

  it("rejects the parent listed as its own child", async () => {
    await expect(
      service.runConsolidation({
        parentEntityId: PARENT_ID,
        childEntityIds: [PARENT_ID],
        reportingCurrency: "USD",
        periodId: PERIOD_ID
      })
    ).rejects.toMatchObject({ code: "CONSOL_CHILD_FORBIDDEN", statusCode: 403 });
  });

  it("rejects unknown entity ids", async () => {
    await expect(
      service.runConsolidation({
        parentEntityId: PARENT_ID,
        childEntityIds: ["no-such-entity"],
        reportingCurrency: "USD",
        periodId: PERIOD_ID
      })
    ).rejects.toMatchObject({ code: "CONSOL_CHILD_FORBIDDEN", statusCode: 403 });
  });

  it("accepts direct children and deeper descendants", async () => {
    const result = await service.runConsolidation({
      parentEntityId: PARENT_ID,
      childEntityIds: [CHILD_ID, GRANDCHILD_ID],
      reportingCurrency: "USD",
      periodId: PERIOD_ID
    });

    expect(result.runId).toBe("run-1");
    expect(mockPrisma.consolidationRun.create).toHaveBeenCalledTimes(1);
  });
});
