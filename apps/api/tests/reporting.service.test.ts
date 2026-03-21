import { describe, expect, it } from "vitest";
import { ReportingService, ReportingServiceError } from "../src/modules/reporting/service.js";

describe("ReportingService.createRun", () => {
  it("throws when definition is missing", async () => {
    const prismaStub = {
      reportDefinition: {
        findFirst: async () => null
      }
    } as unknown as ConstructorParameters<typeof ReportingService>[0];

    const service = new ReportingService(prismaStub as never);

    await expect(
      service.createRun("entity-1", {
        definitionId: "00000000-0000-0000-0000-000000000001",
        parameters: {}
      })
    ).rejects.toThrowError(ReportingServiceError);
  });
});
