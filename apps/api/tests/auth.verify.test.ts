/**
 * verifyAccessToken through a real Fastify instance, with the tenant registry,
 * Redis and the tenant database replaced by stubs so each failure can be
 * produced on demand (AUT-10).
 */
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  process.env.JWT_SECRET = "test-secret-for-auth-verify-unit-tests-256-bit";
  return process.env.JWT_SECRET;
});

const stubs = vi.hoisted(() => ({
  resolveTenantById: vi.fn(),
  sessionExists: vi.fn()
}));

vi.mock("../src/db/tenantRegistry.js", () => ({ resolveTenantById: stubs.resolveTenantById }));
vi.mock("../src/db/redis.js", () => ({
  getRedisClient: () => ({ exists: stubs.sessionExists })
}));
import authPlugin from "../src/plugins/auth.js";
import { getRequestContext, runWithContext } from "../src/db/requestContext.js";
import { requireAuth } from "../src/middleware/requireAuth.js";
import { setAccessService } from "../src/modules/access/runtime.js";
import { staticAccessService } from "./helpers/access.js";
import { AccessService } from "../src/modules/access/service.js";

const TENANT = {
  id: "tenant-1",
  slug: "demo-hotels",
  tenantCode: "ab12cd34",
  databaseUrl: "postgresql://unused",
  isActive: true
};

function token(claims: Record<string, unknown>, options: jwt.SignOptions = {}): string {
  return jwt.sign(claims, SECRET, { algorithm: "HS256", expiresIn: 600, ...options });
}

const VALID = { sub: "user-1", tenantId: "tenant-1", sessionId: "s-1", type: "access" };

describe("verifyAccessToken", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    stubs.resolveTenantById.mockReset().mockResolvedValue(TENANT);
    stubs.sessionExists.mockReset().mockResolvedValue(1);

    app = Fastify({ logger: false });
    // As app.ts does: every request gets its own context before auth runs.
    app.addHook("onRequest", (_request, _reply, done) => runWithContext({}, done));
    await app.register(authPlugin);
    app.get("/whoami", { preHandler: [requireAuth] }, async (request) => ({
      user: request.user,
      entityId: request.entityId ?? null,
      boundEntityId: getRequestContext().entityId
    }));
    await app.ready();
  });

  afterEach(async () => {
    setAccessService(null);
    await app.close();
  });

  const call = (headers: Record<string, string>) =>
    app.inject({ method: "GET", url: "/whoami", headers });
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it("accepts a valid token and takes the tenant's slug and code from the registry", async () => {
    const response = await call(bearer(token(VALID)));
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({
      sub: "user-1",
      tenantId: "tenant-1",
      tenantSlug: "demo-hotels",
      tenantCode: "ab12cd34",
      sessionId: "s-1"
    });
  });

  it("ignores roles, permissions and entities carried in an old token", async () => {
    const legacy = token({
      ...VALID,
      roles: ["SUPERADMIN"],
      permissions: ["GL_POST"],
      entityIds: ["entity-9"],
      tenantSlug: "someone-else"
    });
    const { user } = (await call(bearer(legacy))).json();
    expect(user).not.toHaveProperty("roles");
    expect(user).not.toHaveProperty("permissions");
    expect(user).not.toHaveProperty("entityIds");
    expect(user.tenantSlug).toBe("demo-hotels");
  });

  describe("the entity in X-Entity-ID (AUT-15)", () => {
    beforeEach(() => {
      setAccessService(
        staticAccessService({ tenantPermissions: [], entityPermissions: { "prop-a": ["GL_READ"] } })
      );
    });

    it("binds an entity the caller can open to the request context", async () => {
      const response = await call({ ...bearer(token(VALID)), "x-entity-id": "prop-a" });
      expect(response.json()).toMatchObject({ entityId: "prop-a", boundEntityId: "prop-a" });
    });

    it("records but does not bind an entity the caller cannot open", async () => {
      const response = await call({ ...bearer(token(VALID)), "x-entity-id": "prop-b" });
      expect(response.json()).toMatchObject({ entityId: "prop-b", boundEntityId: null });
    });
  });

  describe("401 — the token or the session is not good", () => {
    it.each([
      ["no token", () => ({})],
      ["a token signed with another secret", () => bearer(jwt.sign(VALID, "another-secret"))],
      ["an expired token", () => bearer(token(VALID, { expiresIn: -10 }))],
      ["a token without a session", () => bearer(token({ ...VALID, sessionId: undefined }))],
      ["a token without a tenant", () => bearer(token({ ...VALID, tenantId: "" }))],
      ["a refresh-type token", () => bearer(token({ ...VALID, type: "refresh" }))],
      ["a development token", () => bearer("dev-a15c0667-e920-4e66-8b15-e1a561b965c4")]
    ])("%s", async (_label, headers) => {
      const response = await call(headers());
      expect(response.statusCode).toBe(401);
      expect(response.json().errors[0].code).toBe("AUTHENTICATION_FAILED");
    });

    it("a tenant the registry does not know", async () => {
      stubs.resolveTenantById.mockResolvedValue(null);
      expect((await call(bearer(token(VALID)))).statusCode).toBe(401);
    });

    it("a session that has been revoked", async () => {
      stubs.sessionExists.mockResolvedValue(0);
      expect((await call(bearer(token(VALID)))).statusCode).toBe(401);
    });
  });

  describe("403 — the session is good but not for this tenant", () => {
    it("a request naming another tenant", async () => {
      const response = await call({ ...bearer(token(VALID)), "x-tenant-code": "99999999" });
      expect(response.statusCode).toBe(403);
    });

    it("a deactivated tenant", async () => {
      stubs.resolveTenantById.mockResolvedValue({ ...TENANT, isActive: false });
      expect((await call(bearer(token(VALID)))).statusCode).toBe(403);
    });

    it("accepts the session's own tenant code in either header", async () => {
      const response = await call({ ...bearer(token(VALID)), "x-tenant-slug": "ab12cd34" });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("503 — a dependency failed; the caller is not signed out (AUT-10)", () => {
    it("the tenant registry", async () => {
      stubs.resolveTenantById.mockRejectedValue(new Error("registry down"));
      const response = await call(bearer(token(VALID)));
      expect(response.statusCode).toBe(503);
      expect(response.json().errors[0].code).toBe("SERVICE_UNAVAILABLE");
    });

    it("the session store", async () => {
      stubs.sessionExists.mockRejectedValue(new Error("ECONNREFUSED"));
      expect((await call(bearer(token(VALID)))).statusCode).toBe(503);
    });

    it("the access check, when the request names an entity", async () => {
      const down = async () => {
        throw new Error("ECONNREFUSED");
      };
      setAccessService(
        new AccessService(
          { loadSnapshot: down },
          { read: down, write: down, invalidateUser: down, invalidateTenant: down }
        )
      );
      const response = await call({ ...bearer(token(VALID)), "x-entity-id": "prop-a" });
      expect(response.statusCode).toBe(503);
      expect(response.json().errors[0].code).toBe("SERVICE_UNAVAILABLE");
    });

    it("does not reveal the cause to the caller", async () => {
      stubs.sessionExists.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.7:6379"));
      expect((await call(bearer(token(VALID)))).body).not.toContain("10.0.0.7");
    });
  });
});
