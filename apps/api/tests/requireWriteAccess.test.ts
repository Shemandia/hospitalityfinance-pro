import { describe, expect, it } from "vitest";
import { requireWriteAccess } from "../src/middleware/requireWriteAccess.js";

function mockRequest(method: string, roles: string[], permissions: string[] = []) {
  return { method, user: { roles, permissions } } as any;
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

describe("requireWriteAccess middleware", () => {
  it("allows GET requests for read-only user", async () => {
    const req = mockRequest("GET", ["VIEWER"], ["GL_READ", "AP_READ"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("allows HEAD requests for read-only user", async () => {
    const req = mockRequest("HEAD", ["VIEWER"], ["GL_READ"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks POST for user with only read permissions", async () => {
    const req = mockRequest("POST", ["VIEWER"], ["GL_READ", "AP_READ", "REPORT_READ"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as any)?.errors?.[0]?.code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("blocks PUT for user with only read permissions", async () => {
    const req = mockRequest("PUT", ["VIEWER"], ["GL_READ"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("blocks DELETE for user with only read permissions", async () => {
    const req = mockRequest("DELETE", ["VIEWER"], ["GL_READ"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("allows POST for user with write permissions", async () => {
    const req = mockRequest("POST", ["CONTROLLER"], ["GL_READ", "GL_WRITE", "GL_POST"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("allows POST for admin with manage permissions", async () => {
    const req = mockRequest("POST", ["ADMIN"], ["GL_READ", "GL_WRITE", "ADMIN_USERS"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("allows DELETE for TENANT_ADMIN role even without explicit permissions", async () => {
    const req = mockRequest("DELETE", ["TENANT_ADMIN"], []);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks POST for user with no roles or permissions", async () => {
    const req = mockRequest("POST", [], []);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });
});
