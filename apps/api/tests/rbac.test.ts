import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { requireRole } from "../src/middleware/requireRole.js";
import { requirePermission } from "../src/middleware/requirePermission.js";

async function readSource(relativePath: string): Promise<string> {
  return readFile(new URL(`../src/${relativePath}`, import.meta.url), "utf8");
}

// Mock Fastify request/reply
function mockRequest(roles: string[]) {
  return { user: { roles } } as any;
}

function mockReply() {
  let statusCode = 200;
  let body: unknown = null;
  const reply = {
    code(c: number) {
      statusCode = c;
      return reply;
    },
    send(b: unknown) {
      body = b;
      return reply;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
  return reply as any;
}

describe("requireRole middleware", () => {
  it("allows ADMIN when requiring ADMIN", async () => {
    const handler = requireRole(["ADMIN"]);
    const req = mockRequest(["admin"]);
    const reply = mockReply();
    await handler(req, reply);
    // If allowed, reply.send is not called (handler returns void)
    expect(reply.body).toBeNull();
  });

  it("allows SUPERADMIN when requiring ADMIN", async () => {
    const handler = requireRole(["ADMIN", "SUPERADMIN"]);
    const req = mockRequest(["superadmin"]);
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks VIEWER when requiring ADMIN", async () => {
    const handler = requireRole(["ADMIN"]);
    const req = mockRequest(["viewer"]);
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as any)?.errors?.[0]?.code).toBe("AUTHORIZATION_FAILED");
  });

  it("blocks CONTROLLER when requiring ADMIN", async () => {
    const handler = requireRole(["ADMIN"]);
    const req = mockRequest(["controller"]);
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("allows CONTROLLER when requiring CONTROLLER", async () => {
    const handler = requireRole(["CONTROLLER", "ADMIN", "SUPERADMIN"]);
    const req = mockRequest(["controller"]);
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.body).toBeNull();
  });

  it("is case-insensitive", async () => {
    const handler = requireRole(["ADMIN"]);
    const req = mockRequest(["Admin"]);
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks when user has no roles", async () => {
    const handler = requireRole(["ADMIN"]);
    const req = mockRequest([]);
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("blocks when user object is missing", async () => {
    const handler = requireRole(["ADMIN"]);
    const req = { user: undefined } as any;
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
  });
});

describe("requirePermission middleware", () => {
  it("allows the exact financial action permission", async () => {
    const handler = requirePermission("GL_POST");
    const req = { user: { permissions: ["GL_READ", "GL_POST"] } } as any;
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks unrelated write permissions from sensitive financial actions", async () => {
    const handler = requirePermission("GL_POST");
    const req = { user: { permissions: ["AP_WRITE", "REPORT_WRITE"] } } as any;
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as any)?.errors?.[0]?.code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("blocks AP invoice approval without AP_APPROVE", async () => {
    const handler = requirePermission("AP_APPROVE");
    const req = { user: { permissions: ["AP_WRITE", "PAYMENT_RUN_CREATE"] } } as any;
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("blocks payment file download without AP_PAYMENT_CONFIRM", async () => {
    const handler = requirePermission("AP_PAYMENT_CONFIRM");
    const req = { user: { permissions: ["PAYMENT_RUN_READ", "PAYMENT_RUN_CREATE"] } } as any;
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("allows any listed permission when a route intentionally accepts alternatives", async () => {
    const handler = requirePermission(["GL_WRITE", "ADMIN_SETTINGS"]);
    const req = { user: { permissions: ["ADMIN_SETTINGS"] } } as any;
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.body).toBeNull();
  });
});

describe("financial route RBAC coverage", () => {
  it("does not leave integration or authorization routers behind generic write access", async () => {
    const integrationRouter = await readSource("modules/integration/router.ts");
    const authorizationRouter = await readSource("modules/authorization/router.ts");

    expect(integrationRouter).not.toContain("requireWriteAccess");
    expect(authorizationRouter).not.toContain("requireWriteAccess");
  });

  it("guards remaining Phase 3 financial actions with explicit permissions", async () => {
    const authorizationRouter = await readSource("modules/authorization/router.ts");
    const setupRouter = await readSource("modules/setup/router.ts");
    const apRouter = await readSource("modules/ap/router.ts");
    const reportingRouter = await readSource("modules/reporting/router.ts");
    const kpiRouter = await readSource("modules/kpi/router.ts");
    const entityRouter = await readSource("modules/entity/router.ts");
    const integrationBank = await readSource("modules/integration/routes/bank.ts");
    const integrationInterfaces = await readSource("modules/integration/routes/interfaces.ts");
    const integrationInbound = await readSource("modules/integration/routes/inbound.ts");
    const transferDesk = await readSource("modules/integration/routes/transfer-desk.ts");
    const transferDeskFsd = await readSource("modules/transfer-desk/fsd-router.ts");
    const transferDeskTest = await readSource("modules/transfer-desk/test-router.ts");

    expect(authorizationRouter).toContain('requirePermission("GL_APPROVE")');
    expect(authorizationRouter).toContain('"/authorization/approve/:journalId"');
    expect(authorizationRouter).toContain('"/authorization/bulk-reject"');
    expect(authorizationRouter).toContain('"/authorization/sets/:id/reject"');
    expect(authorizationRouter).toContain('requirePermission("GL_WRITE")');

    expect(setupRouter).toContain('requirePermission("ADMIN_SETTINGS")');
    expect(apRouter).toContain('"/payment-runs/:runId/voucher/:supplierId"');
    expect(apRouter).toMatch(
      /"\/payment-runs\/:runId\/voucher\/:supplierId"[\s\S]*?requirePermission\("AP_PAYMENT_CONFIRM"\)/
    );
    expect(reportingRouter).toContain('"/reports/runs/:id/download"');
    expect(reportingRouter).toContain('requirePermission("REPORT_EXPORT")');
    expect(kpiRouter).toContain('"/usali-comparative/pdf"');
    expect(kpiRouter).toContain('"/balance-sheet/pdf"');
    expect(kpiRouter).toContain('"/cash-flow/pdf"');
    expect(kpiRouter.match(/requirePermission\("REPORT_EXPORT"\)/g)).toHaveLength(3);
    expect(entityRouter).toContain('requirePermission("ADMIN_ENTITIES")');

    expect(integrationBank).toContain('requirePermission("INTEGRATION_IMPORT")');
    expect(integrationBank).toContain('requirePermission("INTEGRATION_CONFIG")');
    expect(integrationInterfaces).toContain('requirePermission("INTEGRATION_CONFIG")');
    expect(integrationInterfaces).toContain('requirePermission("INTEGRATION_IMPORT")');
    expect(integrationInbound).toContain('requirePermission("INTEGRATION_IMPORT")');
    expect(transferDesk).toContain(
      'requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])'
    );
    expect(transferDesk).toContain(
      'requirePermission(["TRANSFER_DESK_EXECUTE", "INTEGRATION_IMPORT"])'
    );
    expect(transferDeskFsd).toContain('requirePermission("TRANSFER_DESK_READ")');
    expect(transferDeskTest).toContain(
      'requirePermission(["TRANSFER_DESK_EXECUTE", "TRANSFER_DESK_CONFIG"])'
    );
  });
});
