import { describe, expect, it } from "vitest";
import { requireWriteAccess } from "../src/middleware/requireWriteAccess.js";

function mockRequest(method: string, roles: string[]) {
  return { method, user: { roles } } as any;
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
  it("allows GET requests for VIEWER", async () => {
    const req = mockRequest("GET", ["viewer"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("allows HEAD requests for VIEWER", async () => {
    const req = mockRequest("HEAD", ["viewer"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks POST for VIEWER", async () => {
    const req = mockRequest("POST", ["viewer"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as any)?.errors?.[0]?.code).toBe("INSUFFICIENT_ROLE");
  });

  it("blocks PUT for VIEWER", async () => {
    const req = mockRequest("PUT", ["viewer"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("blocks DELETE for VIEWER", async () => {
    const req = mockRequest("DELETE", ["viewer"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("allows POST for CONTROLLER", async () => {
    const req = mockRequest("POST", ["controller"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("allows POST for ADMIN", async () => {
    const req = mockRequest("POST", ["admin"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("allows DELETE for SUPERADMIN", async () => {
    const req = mockRequest("DELETE", ["superadmin"]);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull();
  });

  it("blocks POST for user with no roles", async () => {
    const req = mockRequest("POST", []);
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });
});
