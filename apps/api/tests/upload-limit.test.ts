import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/tenant/entitlements.js", () => ({
  // Tenant "small" may upload 1 MB; any other tenant 5 MB.
  tenantEntitlements: vi.fn(async (tenantId: string) => {
    const mb = tenantId === "small" ? 1 : 5;
    return { uploadMaxMb: mb, uploadMaxBytes: mb * 1024 * 1024 };
  })
}));

import { enforceTenantUploadLimits } from "../src/modules/tenant/upload-limit.js";

const MB = 1024 * 1024;

describe("tenant upload limit", () => {
  const app = Fastify({ bodyLimit: 10 * MB });
  const signedIn = async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const tenantId = request.headers["x-test-tenant"];
    if (typeof tenantId === "string") request.user = { tenantId };
  };
  let handled = 0;

  beforeAll(async () => {
    enforceTenantUploadLimits(app);
    // The route's own pre-handler signs the caller in; the limit runs after it.
    app.post("/import", { preHandler: signedIn as never }, async () => {
      handled++;
      return { ok: true };
    });
    app.get("/read", { preHandler: signedIn as never }, async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (tenant: string | null, bytes: number) =>
    app.inject({
      method: "POST",
      url: "/import",
      headers: {
        "content-type": "application/json",
        ...(tenant ? { "x-test-tenant": tenant } : {})
      },
      payload: JSON.stringify({ file: "x".repeat(bytes) })
    });

  it("refuses a body above the tenant's limit with 413, before the handler", async () => {
    const before = handled;
    const res = await post("small", 2 * MB);
    expect(res.statusCode).toBe(413);
    expect(res.json().errors[0].code).toBe("UPLOAD_TOO_LARGE");
    expect(handled).toBe(before);
  });

  it("accepts the same body for a tenant whose limit is higher", async () => {
    expect((await post("large", 2 * MB)).statusCode).toBe(200);
  });

  it("accepts a body within the limit", async () => {
    expect((await post("small", 100_000)).statusCode).toBe(200);
  });

  it("leaves requests without a tenant to the platform ceiling", async () => {
    expect((await post(null, 2 * MB)).statusCode).toBe(200);
  });

  it("does not touch routes without a body", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/read",
      headers: { "x-test-tenant": "small" }
    });
    expect(res.statusCode).toBe(200);
  });
});
