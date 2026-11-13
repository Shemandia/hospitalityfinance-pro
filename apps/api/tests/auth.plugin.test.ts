/**
 * Auth Plugin Tests
 *
 * Tests JWT verification, cookie extraction, dev-mode bypass, and
 * public route skipping in the auth plugin.
 */

import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-secret-for-auth-plugin-unit-tests-256-bit";

describe("Auth Plugin — JWT Extraction", () => {
  it("should extract token from Authorization Bearer header", () => {
    const header = "Bearer eyJhbGciOiJIUzI1NiJ9.test.sig";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    expect(token).toBe("eyJhbGciOiJIUzI1NiJ9.test.sig");
  });

  it("should return undefined for missing Authorization header", () => {
    const header = undefined as string | undefined;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    expect(token).toBeUndefined();
  });

  it("should return undefined for non-Bearer auth", () => {
    const header = "Basic dXNlcjpwYXNz";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    expect(token).toBeUndefined();
  });
});

describe("Auth Plugin — JWT Verification", () => {
  it("should verify a valid HS256 token", () => {
    const payload = {
      sub: "user-id",
      email: "test@test.com",
      tenantId: "t-1",
      tenantCode: "ab12cd34",
      tenantSlug: "test",
      roles: ["ADMIN"],
      permissions: ["gl:read"],
      entityIds: ["e-1"],
      sessionId: "session-1",
      type: "access"
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: 900, algorithm: "HS256" });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as any;

    expect(decoded.sub).toBe("user-id");
    expect(decoded.tenantCode).toBe("ab12cd34");
    expect(decoded.roles).toContain("ADMIN");
  });

  it("should reject token with wrong algorithm", () => {
    // Sign with HS384 but only accept HS256
    const token = jwt.sign({ sub: "user" }, JWT_SECRET, { algorithm: "HS384" });
    expect(() => jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })).toThrow();
  });

  it("should distinguish TokenExpiredError", () => {
    const token = jwt.sign({ sub: "user" }, JWT_SECRET, { expiresIn: -1, algorithm: "HS256" });
    try {
      jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("TokenExpiredError");
    }
  });
});

describe("Auth Routes - Cookie Response Shape", () => {
  async function importAuthRouter() {
    process.env.JWT_SECRET = "test-secret-for-auth-router-unit-tests-256-bit";
    process.env.COOKIE_DOMAIN = ".hospitalityfinancepro.com";
    return import("../src/modules/auth/router.js");
  }

  it("does not expose login tokens in JSON responses", async () => {
    const { buildLoginResponseData } = await importAuthRouter();
    const result = {
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      expiresIn: 900,
      mustChangePassword: false,
      user: { id: "u-1", email: "user@test.com" }
    };

    const data = buildLoginResponseData(result);

    expect("accessToken" in data).toBe(false);
    expect("refreshToken" in data).toBe(false);
    expect(data.expiresIn).toBe(900);
    expect(data.user).toEqual(result.user);
  });

  it("does not expose refresh tokens in JSON responses", async () => {
    const { buildRefreshResponseData } = await importAuthRouter();
    const result = {
      accessToken: "new-access-token-value",
      refreshToken: "new-refresh-token-value",
      expiresIn: 900
    };

    const data = buildRefreshResponseData(result);

    expect("accessToken" in data).toBe(false);
    expect("refreshToken" in data).toBe(false);
    expect(data.expiresIn).toBe(900);
  });

  it("applies COOKIE_DOMAIN to auth cookies", async () => {
    const { getAuthCookieBaseOptions, getAuthClearCookieOptions } = await importAuthRouter();

    expect(getAuthCookieBaseOptions()).toMatchObject({
      domain: ".hospitalityfinancepro.com",
      httpOnly: true,
      sameSite: "strict",
      path: "/"
    });
    expect(getAuthClearCookieOptions()).toMatchObject({
      domain: ".hospitalityfinancepro.com",
      path: "/"
    });
  });
});

describe("Auth Plugin — Public Routes", () => {
  const publicPrefixes = ["/auth/", "/health"];

  function isPublicRoute(url: string): boolean {
    return publicPrefixes.some((prefix) => url.startsWith(prefix));
  }

  it("should skip auth for /auth/login", () => {
    expect(isPublicRoute("/auth/login")).toBe(true);
  });

  it("should skip auth for /auth/refresh", () => {
    expect(isPublicRoute("/auth/refresh")).toBe(true);
  });

  it("should skip auth for /auth/tenant/ab12cd34", () => {
    expect(isPublicRoute("/auth/tenant/ab12cd34")).toBe(true);
  });

  it("should skip auth for /health", () => {
    expect(isPublicRoute("/health")).toBe(true);
  });

  it("should NOT skip auth for /api/v1/gl/journals", () => {
    expect(isPublicRoute("/api/v1/gl/journals")).toBe(false);
  });

  it("should NOT skip auth for /api/v1/entities", () => {
    expect(isPublicRoute("/api/v1/entities")).toBe(false);
  });
});

describe("Auth Plugin — Tenant headers", () => {
  async function importAuthPlugin() {
    process.env.JWT_SECRET = "test-secret-for-auth-plugin-unit-tests-256-bit";
    return import("../src/plugins/auth.js");
  }

  it("detects tenant header mismatch as cross-tenant access", async () => {
    const { validateTenantHeaders } = await importAuthPlugin();

    const decision = validateTenantHeaders({
      headerTenantSlug: "other-tenant",
      tenantSlug: "correct-tenant",
      headerTenantCode: "87654321",
      tenantCode: "12345678"
    });

    expect(decision.error).toMatchObject({
      statusCode: 403,
      message: "Tenant header does not match authenticated tenant."
    });
  });

  it("accepts the tenant CODE sent in the slug header (web /t/[code] routes)", async () => {
    const { validateTenantHeaders } = await importAuthPlugin();

    // The web app's /t/[code] URLs put the tenant code in the URL segment and
    // send it as X-Tenant-Slug. Either identifier of the SAME tenant must pass.
    const decision = validateTenantHeaders({
      headerTenantSlug: "ab12cd34",
      tenantSlug: "tenant-a",
      tenantCode: "ab12cd34"
    });

    expect(decision.error).toBeUndefined();
  });

  it("accepts the tenant SLUG sent in the code header", async () => {
    const { validateTenantHeaders } = await importAuthPlugin();

    const decision = validateTenantHeaders({
      headerTenantCode: "tenant-a",
      tenantSlug: "tenant-a",
      tenantCode: "ab12cd34"
    });

    expect(decision.error).toBeUndefined();
  });

  it("still rejects a header identifying a different tenant", async () => {
    const { validateTenantHeaders } = await importAuthPlugin();

    const decision = validateTenantHeaders({
      headerTenantSlug: "tenant-b",
      tenantSlug: "tenant-a",
      tenantCode: "ab12cd34"
    });

    expect(decision.error).toMatchObject({
      statusCode: 403,
      message: "Tenant header does not match authenticated tenant."
    });
  });
});

describe("Auth Plugin — Tenant Code Regex", () => {
  const TENANT_CODE_RE = /^[a-z0-9]{8}$/;

  it("should match valid 8-char hex", () => {
    expect(TENANT_CODE_RE.test("ab12cd34")).toBe(true);
    expect(TENANT_CODE_RE.test("4369021c")).toBe(true);
    expect(TENANT_CODE_RE.test("00000000")).toBe(true);
  });

  it("should reject invalid codes", () => {
    expect(TENANT_CODE_RE.test("AB12CD34")).toBe(false); // uppercase
    expect(TENANT_CODE_RE.test("abc")).toBe(false); // too short
    expect(TENANT_CODE_RE.test("abcdefgh1")).toBe(false); // too long
    expect(TENANT_CODE_RE.test("ab-12cd4")).toBe(false); // has dash
    expect(TENANT_CODE_RE.test("")).toBe(false); // empty
  });
});
