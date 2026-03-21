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
      }
    } as unknown as ConstructorParameters<typeof PeriodService>[0];

    const service = new PeriodService(prismaStub as never);
    const reopened = await service.reopenPeriod("entity-1", "period-1", ["SUPERADMIN"]);

    expect(reopened.status).toBe("OPEN");
  });
});
