/** Every log line carries the request ID, tenant and entity it was written in (OPS-06). */
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/shared/logger.js";
import { runWithContext, updateRequestContext } from "../src/db/requestContext.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ write: (chunk: string) => void lines.push(JSON.parse(chunk)) });
  return { log, lines };
}

describe("logger", () => {
  it("adds the request ID, tenant and entity of the current context", () => {
    const { log, lines } = capture();
    runWithContext({ requestId: "req-abc", tenantId: "t-1" }, () => {
      updateRequestContext({ entityId: "e-1" });
      log.info("inside");
    });
    expect(lines[0]).toMatchObject({
      msg: "inside",
      reqId: "req-abc",
      tenantId: "t-1",
      entityId: "e-1"
    });
  });

  it("adds nothing outside a request or job", () => {
    const { log, lines } = capture();
    log.info("outside");
    expect(lines[0]).not.toHaveProperty("reqId");
    expect(lines[0]).not.toHaveProperty("tenantId");
    expect(lines[0]).not.toHaveProperty("entityId");
  });

  it("does not repeat reqId on a logger that already carries it (Fastify's request logger)", () => {
    const chunks: string[] = [];
    const child = createLogger({ write: (c: string) => void chunks.push(c) }).child({
      reqId: "req-1"
    });
    runWithContext({ requestId: "req-1", tenantId: "t-1" }, () => child.info("request"));
    expect(chunks[0].match(/"reqId"/g)).toHaveLength(1);
    expect(JSON.parse(chunks[0])).toMatchObject({ reqId: "req-1", tenantId: "t-1" });
  });

  it("serializes an error under err with its message and stack", () => {
    const { log, lines } = capture();
    log.error({ err: new Error("boom") }, "failed");
    expect(lines[0]).toMatchObject({ msg: "failed", err: { message: "boom", type: "Error" } });
  });
});
