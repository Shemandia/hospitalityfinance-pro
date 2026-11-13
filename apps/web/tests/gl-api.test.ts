import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiContext } from "../lib/gl-api";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Reset process.env for API base URL

describe("gl-api", () => {
  let mod: typeof import("../lib/gl-api");
  const context: ApiContext = {
    accessToken: "test-token-123",
    entityId: "entity-001",
    tenantSlug: "demo-hotel"
  };

  beforeEach(async () => {
    mockFetch.mockReset();
    // Dynamic import so env var is read fresh
    mod = await import("../lib/gl-api");
  });

  it("getGLAccounts sends correct headers and returns data", async () => {
    const accounts = [
      { id: "a1", code: "1000", name: "Cash", type: "ASSET" },
      { id: "a2", code: "2000", name: "Liabilities", type: "LIABILITY" }
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: accounts, errors: [] })
    });

    const result = await mod.getGLAccounts(context);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/gl/accounts");
    expect(init.headers.Authorization).toBe("Bearer test-token-123");
    expect(init.headers["X-Entity-ID"]).toBe("entity-001");
    expect(init.headers["X-Tenant-Slug"]).toBe("demo-hotel");
    expect(result.data).toEqual(accounts);
  });

  it("throws error with message from API error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        data: null,
        errors: [{ code: "NOT_FOUND", message: "Journal not found." }]
      })
    });

    let error: Error | undefined;
    try {
      await mod.getGLJournal(context, "missing-id");
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toBe("Journal not found.");
  });

  it("throws generic error when no error message in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ data: null })
    });

    let error: Error | undefined;
    try {
      await mod.getGLAccounts(context);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toBe("Request failed (500)");
  });

  it("skips Authorization header when accessToken is 'cookie'", async () => {
    const cookieCtx: ApiContext = { accessToken: "cookie", entityId: "e1" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], errors: [] })
    });

    await mod.getGLAccounts(cookieCtx);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("createGLJournal sends POST with JSON body", async () => {
    const journalPayload = {
      description: "Test journal",
      lines: [
        { accountId: "a1", debit: "100.00", credit: "0.00" },
        { accountId: "a2", debit: "0.00", credit: "100.00" }
      ]
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "j1", ...journalPayload }, errors: [] })
    });

    const result = await mod.createGLJournal(context, journalPayload);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(journalPayload);
    expect(result.data.id).toBe("j1");
  });

  it("getTrialBalance includes query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], errors: [] })
    });

    await mod.getTrialBalance(context, { periodId: "p1", showZeroBalances: true });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("period_id=p1");
    expect(url).toContain("show_zero_balances=true");
  });

  it("deleteEntity sends DELETE request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: null, errors: [] })
    });

    await mod.deleteEntity(context, "e123");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/entities/e123");
    expect(init.method).toBe("DELETE");
  });
});
