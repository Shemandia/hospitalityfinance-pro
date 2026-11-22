import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  newIntegrationPath,
  registerOldIntegrationPaths
} from "../src/modules/integrations/old-paths.js";

describe("old Transfer Desk API paths redirect to Integrations for one release", () => {
  it("maps each old prefix to its new path", () => {
    expect(newIntegrationPath("/api/v1/integration/transfer-desk/formats?limit=5")).toBe(
      "/api/v1/integrations/formats?limit=5"
    );
    expect(newIntegrationPath("/api/v1/transfer-desk/fsd/auto-detect")).toBe(
      "/api/v1/integrations/builder/fsd/auto-detect"
    );
    expect(newIntegrationPath("/api/v1/integration/import/saf/preview")).toBe(
      "/api/v1/integrations/import/saf/preview"
    );
    // The profile builder's profile routes were merged into the one profiles API.
    expect(newIntegrationPath("/api/v1/integrations/builder/profiles?limit=5")).toBe(
      "/api/v1/integrations/profiles?limit=5"
    );
    expect(newIntegrationPath("/api/v1/integrations/builder/profiles/p1/schedule")).toBe(
      "/api/v1/integrations/profiles/p1/schedule"
    );
    expect(newIntegrationPath("/api/v1/transfer-desk/profiles/p1/test")).toBe(
      "/api/v1/integrations/profiles/p1/test"
    );
    expect(newIntegrationPath("/api/v1/integrations/builder/fsd/parse-preview")).toBeNull();
    expect(newIntegrationPath("/api/v1/integrations/formats")).toBeNull();
  });

  it("answers 308, so a POST stays a POST with its body", async () => {
    const app = Fastify();
    await registerOldIntegrationPaths(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integration/transfer-desk/profiles/p1/execute?dry=1",
      payload: { a: 1 }
    });
    expect(response.statusCode).toBe(308);
    expect(response.headers.location).toBe("/api/v1/integrations/profiles/p1/execute?dry=1");
    await app.close();
  });
});
