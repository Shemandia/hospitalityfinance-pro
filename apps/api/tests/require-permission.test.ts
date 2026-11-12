import { afterEach, describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  loadRequestAccess,
  permittedEntityIds,
  requirePermission
} from "../src/middleware/requirePermission.js";
import type { ResolvedAccess } from "../src/modules/access/resolver.js";
import { setAccessService } from "../src/modules/access/runtime.js";
import { AccessService } from "../src/modules/access/service.js";
import { staticAccessService } from "./helpers/access.js";

// Accountant on A, viewer on B, nothing on C, and one tenant-wide permission.
const ACCESS: ResolvedAccess = {
  tenantPermissions: ["ADMIN_ROLES_MANAGE"],
  entityPermissions: {
    "prop-a": ["ADMIN_ROLES_MANAGE", "ADMIN_USERS", "GL_POST", "GL_READ"],
    "prop-b": ["ADMIN_ROLES_MANAGE", "GL_READ"]
  }
};

type Sent = { statusCode: number; body: { errors: Array<{ code: string }> } | null };

function mockReply(): FastifyReply & { sent: Sent } {
  const sent: Sent = { statusCode: 200, body: null };
  const reply = {
    sent,
    code(statusCode: number) {
      sent.statusCode = statusCode;
      return reply;
    },
    send(body: Sent["body"]) {
      sent.body = body;
      return reply;
    }
  };
  return reply as unknown as FastifyReply & { sent: Sent };
}

function mockRequest(overrides: { entityId?: string; user?: object | null } = {}): FastifyRequest {
  return {
    user:
      overrides.user === null ? undefined : (overrides.user ?? { sub: "u1", tenantId: "tenant-1" }),
    entityId: overrides.entityId,
    log: { error: () => undefined }
  } as unknown as FastifyRequest;
}

async function run(
  guard: ReturnType<typeof requirePermission>,
  request: FastifyRequest
): Promise<Sent> {
  const reply = mockReply();
  await guard(request, reply);
  return reply.sent;
}

const allowed = (sent: Sent) => sent.body === null && sent.statusCode === 200;

describe("requirePermission", () => {
  afterEach(() => setAccessService(null));

  describe("entity scope (default)", () => {
    it("allows when the permission is held at the request's entity", async () => {
      setAccessService(staticAccessService(ACCESS));
      const sent = await run(requirePermission("GL_POST"), mockRequest({ entityId: "prop-a" }));
      expect(allowed(sent)).toBe(true);
    });

    it("denies with 403 when the permission is held at another entity only", async () => {
      setAccessService(staticAccessService(ACCESS));
      const sent = await run(requirePermission("GL_POST"), mockRequest({ entityId: "prop-b" }));
      expect(sent.statusCode).toBe(403);
      expect(sent.body?.errors[0]?.code).toBe("INSUFFICIENT_PERMISSIONS");
    });

    it("denies with 403 when the user cannot open the entity", async () => {
      setAccessService(staticAccessService(ACCESS));
      const sent = await run(requirePermission("GL_READ"), mockRequest({ entityId: "prop-c" }));
      expect(sent.statusCode).toBe(403);
      expect(sent.body?.errors[0]?.code).toBe("ENTITY_ACCESS_DENIED");
    });

    it("answers 400 when the request names no entity", async () => {
      setAccessService(staticAccessService(ACCESS));
      const sent = await run(requirePermission("GL_READ"), mockRequest());
      expect(sent.statusCode).toBe(400);
      expect(sent.body?.errors[0]?.code).toBe("ENTITY_CONTEXT_REQUIRED");
    });

    it("accepts any one of several permissions, case-insensitively", async () => {
      setAccessService(staticAccessService(ACCESS));
      const guard = requirePermission(["gl_write", "gl_post"]);
      expect(allowed(await run(guard, mockRequest({ entityId: "prop-a" })))).toBe(true);
      expect((await run(guard, mockRequest({ entityId: "prop-b" }))).statusCode).toBe(403);
    });

    it("ignores permissions and roles carried in the token", async () => {
      setAccessService(staticAccessService(ACCESS));
      const request = mockRequest({
        entityId: "prop-b",
        user: { sub: "u1", tenantId: "tenant-1", permissions: ["GL_POST"], roles: ["SUPERADMIN"] }
      });
      expect((await run(requirePermission("GL_POST"), request)).statusCode).toBe(403);
    });
  });

  describe("tenant scope", () => {
    it("allows a permission held through a tenant-wide assignment, with no entity", async () => {
      setAccessService(staticAccessService(ACCESS));
      const guard = requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" });
      expect(allowed(await run(guard, mockRequest()))).toBe(true);
    });

    it("denies a permission held only at an entity", async () => {
      setAccessService(staticAccessService(ACCESS));
      const guard = requirePermission("ADMIN_USERS", { scope: "tenant" });
      const sent = await run(guard, mockRequest({ entityId: "prop-a" }));
      expect(sent.statusCode).toBe(403);
    });
  });

  describe("any-entity scope", () => {
    it("allows when the permission is held at one entity at least", async () => {
      setAccessService(staticAccessService(ACCESS));
      const guard = requirePermission("ADMIN_USERS", { scope: "any-entity" });
      expect(allowed(await run(guard, mockRequest()))).toBe(true);
    });

    it("denies when the permission is held nowhere", async () => {
      setAccessService(staticAccessService(ACCESS));
      const guard = requirePermission("PERIOD_REOPEN", { scope: "any-entity" });
      expect((await run(guard, mockRequest())).statusCode).toBe(403);
    });

    it("records the admitting permissions and exposes the caller's reach", async () => {
      setAccessService(staticAccessService(ACCESS));
      const request = mockRequest();
      await run(requirePermission("ADMIN_USERS", { scope: "any-entity" }), request);
      expect(request.admittedBy).toEqual(["ADMIN_USERS"]);
      expect(permittedEntityIds(ACCESS, "ADMIN_USERS")).toEqual(["prop-a"]);
      expect(permittedEntityIds(ACCESS, ["GL_READ", "GL_POST"])).toEqual(["prop-a", "prop-b"]);
      expect(permittedEntityIds(ACCESS, "ADMIN_ROLES_MANAGE")).toBe("all");
      expect(permittedEntityIds(ACCESS, "PERIOD_REOPEN")).toEqual([]);
    });
  });

  describe("failure handling", () => {
    it("answers 401 when no user is authenticated", async () => {
      setAccessService(staticAccessService(ACCESS));
      const sent = await run(requirePermission("GL_READ"), mockRequest({ user: null }));
      expect(sent.statusCode).toBe(401);
    });

    it("answers 401 when the session carries no tenant", async () => {
      setAccessService(staticAccessService(ACCESS));
      const request = mockRequest({ entityId: "prop-a", user: { sub: "u1", tenantId: "" } });
      expect((await run(requirePermission("GL_READ"), request)).statusCode).toBe(401);
    });

    it("answers 503, not 401 or 403, when the access check cannot be made (AUT-10)", async () => {
      const broken = {
        read: async () => {
          throw new Error("ECONNREFUSED");
        },
        write: async () => undefined,
        invalidateUser: async () => undefined,
        invalidateTenant: async () => undefined
      };
      setAccessService(
        new AccessService({ loadSnapshot: async () => Promise.reject(new Error("unused")) }, broken)
      );
      const sent = await run(requirePermission("GL_READ"), mockRequest({ entityId: "prop-a" }));
      expect(sent.statusCode).toBe(503);
      expect(sent.body?.errors[0]?.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("resolves access once per request, however many checks follow", async () => {
      let reads = 0;
      const counting = staticAccessService(ACCESS);
      const original = counting.resolve.bind(counting);
      counting.resolve = async (subject) => {
        reads += 1;
        return original(subject);
      };
      setAccessService(counting);
      const request = mockRequest({ entityId: "prop-a" });
      await run(requirePermission("GL_READ"), request);
      await loadRequestAccess(request, mockReply());
      expect(reads).toBe(1);
    });
  });

  it("refuses to build a guard without a permission code", () => {
    expect(() => requirePermission([])).toThrow(/at least one permission/);
    expect(() => requirePermission(" ")).toThrow(/at least one permission/);
  });
});
