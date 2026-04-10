import { describe, expect, it } from "vitest";
import { PeriodService, PeriodServiceError } from "../src/modules/period/service.js";

describe("PeriodService.reopenPeriod", () => {
  it("requires SUPERADMIN role", async () => {
    const prismaStub = {
      period: {
        findFirst: async () => ({
          id: "period-1",
          entityId: "entity-1",
          status: "LOCKED"
        })
      }
    } as unknown as ConstructorParameters<typeof PeriodService>[0];

    const service = new PeriodService(prismaStub as never);
    await expect(service.reopenPeriod("entity-1", "period-1", ["CONTROLLER"])).rejects.toThrowError(
      PeriodServiceError
    );
  });

  it("reopens when role is SUPERADMIN and no other open period exists", async () => {
    let queryRawCallCount = 0;
    const txStub = {
      $queryRaw: async () => {
        queryRawCallCount++;
        if (queryRawCallCount === 1) {
          // First call: SELECT period FOR UPDATE
          return [{ id: "period-1", status: "LOCKED" }];
        }
        // Second call: SELECT open periods → none exist
        return [];
      },
      $executeRaw: async () => 0,
      periodCloseStatus: {
        findFirst: async () => null
      },
      ledgerSetup: {
        findFirst: async () => null
      },
      period: {
        update: async () => ({
          id: "period-1",
          status: "OPEN"
        })
      }
    };

    const prismaStub = {
      period: {
        findFirst: async () => ({
          id: "period-1",
          entityId: "entity-1",
          status: "LOCKED"
        }),
        count: async () => 0,
        update: async () => ({
          id: "period-1",
          status: "OPEN"
        })
      },
      processLock: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => null,
        create: async () => ({ id: "lock-1" }),
        deleteMany: async () => ({ count: 0 }),
        delete: async () => ({})
      },
      $transaction: async (callback: (tx: typeof txStub) => Promise<unknown>) => callback(txStub)
    } as unknown as ConstructorParameters<typeof PeriodService>[0];

    const service = new PeriodService(prismaStub as never);
    const reopened = await service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"]);

    expect(reopened.status).toBe("OPEN");
  });
});
