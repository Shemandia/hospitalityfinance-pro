import { describe, expect, it } from "vitest";
import { requireRole } from "../src/middleware/requireRole.js";

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
