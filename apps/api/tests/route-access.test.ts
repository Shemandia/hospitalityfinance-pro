/**
 * Route access table (AUT-04).
 *
 * Builds the real application and checks how every route is protected.
 * createApp() itself fails when a route has no classification, so a new route
 * cannot ship without one. The full table is kept in route-access.table.txt;
 * a change to any route's protection shows up there in review. Regenerate it
 * with: pnpm vitest run tests/route-access.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RouteAccess } from "../src/modules/access/route-access.js";
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES } from "../src/modules/access/system-catalog.js";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "route-access-test-secret-route-access-test-secret";
  process.env.PLATFORM_API_KEY ??= "route-access-test-platform-key";
});

// The table is about registration only; nothing here talks to Redis.
vi.mock("../src/db/redis.js", () => ({
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
  getRedisClient: () => {
    throw new Error("Redis is not available in the route-access test");
  }
}));

// Routes any signed-in user may call. They act on the caller's own session or
// profile, or return only what the caller's access allows.
const SESSION_ROUTES = [
  "DELETE /auth/sessions/:sessionId",
  "GET /api/v1/admin/profile",
  "GET /api/v1/context",
  "GET /api/v1/entities",
  "GET /api/v1/entities/:id",
  "GET /api/v1/license",
  "GET /api/v1/me",
  "GET /api/v1/setup/progress",
  "GET /auth/me",
  "GET /auth/sessions",
  "POST /auth/change-password",
  "POST /auth/logout",
  "POST /auth/logout-all",
  "PUT /api/v1/admin/profile"
];

// Routes that need no session at all.
const PUBLIC_ROUTES = [
  "GET /api/v1/version",
  "GET /auth/tenant/:tenantCode",
  "GET /health",
  "GET /ready",
  "OPTIONS *",
  "POST /auth/forgot-password",
  "POST /auth/login",
  "POST /auth/refresh",
  "POST /auth/reset-password"
];

// POST routes that compute a preview or a query result and store nothing, so a
// read permission is enough. Anything else that is not a GET must require more.
const READ_ONLY_POSTS = [
  "POST /api/v1/budget/definitions/:id/import-excel/preview",
  "POST /api/v1/gl/accounts/import/preview",
  "POST /api/v1/gl/accounts/import/sheets",
  "POST /api/v1/integration/import/saf/account-mapping",
  "POST /api/v1/integration/import/saf/preview",
  "POST /api/v1/integration/interfaces/:id/preview",
  "POST /api/v1/integration/interfaces/preview-draft",
  "POST /api/v1/integration/transfer-desk/formats/detect",
  "POST /api/v1/reports/drill-down",
  "POST /api/v1/transfer-desk/fsd/auto-detect",
  "POST /api/v1/transfer-desk/fsd/parse-preview",
  "POST /api/v1/transfer-desk/fsd/validate-schema"
];

// Prefixes whose routes take no X-Entity-ID header (plugins/auth.ts).
const NO_ENTITY_HEADER = /^\/api\/v1\/(admin|entities|setup)(\/|$)/;

describe("route access table", () => {
  let app: FastifyInstance;
  let table: Array<[string, RouteAccess]>;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = await createApp();
    await app.ready();
    table = [...app.routeAccess.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  afterAll(async () => {
    await app?.close();
  });

  const keysWithScope = (scope: RouteAccess["scope"]) =>
    table.filter(([, access]) => access.scope === scope).map(([key]) => key);

  it("classifies every route (the application starts)", () => {
    expect(table.length).toBeGreaterThan(300);
  });

  it("matches the reviewed table", async () => {
    const lines = table.map(([key, access]) => {
      const [method = "", url = ""] = key.split(" ");
      const detail =
        "anyOf" in access ? `${access.scope}  ${access.anyOf.join(" | ")}` : access.scope;
      return `${method.padEnd(7)}${url}  ->  ${detail}`;
    });
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot("./route-access.table.txt");
  });

  it("keeps the public routes to the known list", () => {
    expect(keysWithScope("public")).toEqual(PUBLIC_ROUTES);
  });

  it("keeps the session-only routes to the known list", () => {
    expect(keysWithScope("session")).toEqual(SESSION_ROUTES);
  });

  it("uses the platform key for the platform routes and nothing else", () => {
    const platform = keysWithScope("platform");
    expect(platform.length).toBeGreaterThan(0);
    for (const key of platform) expect(key).toMatch(/ \/api\/v1\/platform\//);
    for (const [key, access] of table) {
      if (/ \/api\/v1\/platform\//.test(key)) expect(access.scope, key).toBe("platform");
    }
  });

  it("requires a permission on every other route", () => {
    const named = new Set([...PUBLIC_ROUTES, ...SESSION_ROUTES]);
    for (const [key, access] of table) {
      if (named.has(key) || access.scope === "platform") continue;
      expect("anyOf" in access && access.anyOf.length > 0, key).toBe(true);
    }
  });

  it("checks the permission at the request's entity unless the route takes no entity", () => {
    for (const [key, access] of table) {
      if (access.scope !== "tenant" && access.scope !== "any-entity") continue;
      const url = key.split(" ")[1] ?? "";
      expect(NO_ENTITY_HEADER.test(url), key).toBe(true);
    }
  });

  it("requires more than a read permission to change data", () => {
    const readGuarded = table
      .filter(
        ([key, access]) =>
          !key.startsWith("GET ") &&
          "anyOf" in access &&
          access.anyOf.some((code) => code.endsWith("_READ"))
      )
      .map(([key]) => key);
    expect(readGuarded).toEqual(READ_ONLY_POSTS);
  });

  it("keeps the sensitive financial actions on their own permissions", () => {
    const lookup = new Map(table);
    const expectAccess = (key: string, scope: string, anyOf: string[]) =>
      expect(lookup.get(key), key).toEqual({ scope, anyOf });

    expectAccess("POST /api/v1/gl/journals/:id/post", "entity", ["GL_POST"]);
    expectAccess("POST /api/v1/authorization/approve/:journalId", "entity", ["GL_APPROVE"]);
    expectAccess("POST /api/v1/authorization/bulk-reject", "entity", ["GL_APPROVE"]);
    expectAccess("POST /api/v1/periods/:id/reopen", "entity", ["PERIOD_REOPEN"]);
    expectAccess("GET /api/v1/ap/payment-runs/:runId/voucher/:supplierId", "entity", [
      "AP_PAYMENT_CONFIRM"
    ]);
    expectAccess("GET /api/v1/reports/runs/:id/download", "entity", ["REPORT_EXPORT"]);
    expectAccess("GET /api/v1/kpi/balance-sheet/pdf", "entity", ["REPORT_EXPORT"]);
    expectAccess("POST /api/v1/consolidation/run", "entity", ["CONSOLIDATION_RUN"]);
    expectAccess("POST /api/v1/admin/roles", "tenant", ["ADMIN_ROLES_MANAGE"]);
    expectAccess("POST /api/v1/admin/roles/:id/permissions", "tenant", ["ADMIN_ROLES_MANAGE"]);
    expectAccess("PUT /api/v1/setup/steps/:step", "tenant", ["ADMIN_SETTINGS"]);
    expectAccess("POST /api/v1/entities", "any-entity", ["ADMIN_ENTITIES"]);
  });

  describe("the starting roles", () => {
    // What a role cannot do, counting only what its permissions allow — where
    // the role is assigned (one property, a group, the tenant) is a separate matter.
    const deniedTo = (roleCode: string, onlyReads: boolean) => {
      const role = SYSTEM_ROLES.find((candidate) => candidate.code === roleCode);
      if (!role) throw new Error(`No starting role ${roleCode}`);
      return table
        .filter(
          ([key, access]) =>
            "anyOf" in access &&
            (!onlyReads || key.startsWith("GET ")) &&
            !access.anyOf.some((code) => role.permissions.includes(code))
        )
        .map(([key]) => key);
    };

    it("routes name only permission codes that exist in the catalogue", () => {
      const catalogue = new Set(SYSTEM_PERMISSIONS.map((permission) => permission.code));
      const unknown = table.flatMap(([key, access]) =>
        "anyOf" in access
          ? access.anyOf.filter((code) => !catalogue.has(code)).map((code) => `${key}: ${code}`)
          : []
      );
      expect(unknown).toEqual([]);
    });

    // Every read route outside these lists is open to the role. None of the
    // routes listed was open to the role before the read guards were added:
    // each already required a permission the role does not hold.
    const ADMIN_READS = [
      "GET /api/v1/account-types/all",
      "GET /api/v1/admin/all-users",
      "GET /api/v1/admin/entity-tree",
      "GET /api/v1/admin/login-audit",
      "GET /api/v1/admin/permissions",
      "GET /api/v1/admin/roles",
      "GET /api/v1/admin/roles/:id"
    ];
    const PAYMENT_FILES = [
      "GET /api/v1/ap/payment-runs/:id/download",
      "GET /api/v1/ap/payment-runs/:runId/voucher/:supplierId"
    ];
    const INTERCOMPANY_READS = [
      "GET /api/v1/intercompany/account-pairs",
      "GET /api/v1/intercompany/journals",
      "GET /api/v1/intercompany/v2/pairs",
      "GET /api/v1/intercompany/v2/pairs/:id",
      "GET /api/v1/intercompany/v2/pairs/:pairId/mappings",
      "GET /api/v1/intercompany/v2/reconciliation",
      "GET /api/v1/intercompany/v2/transactions",
      "GET /api/v1/intercompany/v2/transactions/:id"
    ];
    const EXPORTS = [
      "GET /api/v1/kpi/balance-sheet/pdf",
      "GET /api/v1/kpi/cash-flow/pdf",
      "GET /api/v1/kpi/usali-comparative/pdf",
      "GET /api/v1/reports/runs/:id/download"
    ];

    it("VIEWER reads everything except administration, payment files, intercompany, exports and import batches", () => {
      expect(deniedTo("VIEWER", true)).toEqual(
        [
          ...ADMIN_READS,
          ...PAYMENT_FILES,
          ...INTERCOMPANY_READS,
          ...EXPORTS,
          "GET /api/v1/process-locks/status",
          "GET /api/v1/transfer-desk/batches",
          "GET /api/v1/transfer-desk/batches/:id"
        ].sort()
      );
    });

    it("CONTROLLER reads everything except administration, payment files and intercompany", () => {
      expect(deniedTo("CONTROLLER", true)).toEqual(
        [
          ...ADMIN_READS,
          ...PAYMENT_FILES,
          ...INTERCOMPANY_READS,
          "GET /api/v1/process-locks/status"
        ].sort()
      );
    });

    it("ADMIN can do everything except reopen a locked period", () => {
      expect(deniedTo("ADMIN", false)).toEqual(["POST /api/v1/periods/:id/reopen"]);
    });

    it("TENANT_ADMIN can do everything", () => {
      expect(deniedTo("TENANT_ADMIN", false)).toEqual([]);
    });
  });
});
