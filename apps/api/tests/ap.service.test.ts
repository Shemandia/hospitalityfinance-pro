import { describe, expect, it } from "vitest";
import { APService, APServiceError } from "../src/modules/ap/service.js";

describe("APService.postInvoice", () => {
  it("rejects posting when invoice status is not APPROVED", async () => {
    const transactionStub = {
      $queryRaw: async () => [{ id: "inv-1", status: "DRAFT" }],
      $executeRaw: async () => 0,
      aPInvoice: {
        findFirst: async () => ({
          id: "inv-1",
          entityId: "entity-1",
          status: "DRAFT",
          periodId: "period-1",
          period: { id: "period-1", name: "Mar 2026", status: "OPEN" },
          lines: []
        })
      }
    };

    const prismaStub = {
      user: {
        findFirst: async () => ({ id: "user-1" })
      },
      $transaction: async (callback: (tx: typeof transactionStub) => Promise<unknown>) =>
        callback(transactionStub)
    } as unknown as ConstructorParameters<typeof APService>[0];

    const service = new APService(prismaStub as never);

    await expect(service.postInvoice("entity-1", "inv-1", "user-1")).rejects.toThrowError(
      APServiceError
    );
  });
});
