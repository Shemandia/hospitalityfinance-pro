import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { serializeForAudit } from "../src/db/auditSerialization.js";

describe("serializeForAudit", () => {
  it("serializes decimals and dates", () => {
    const input = {
      amount: new Prisma.Decimal("123.4567"),
      when: new Date("2026-03-06T00:00:00.000Z")
    };

    const serialized = serializeForAudit(input) as Record<string, unknown>;
    expect(serialized.amount).toBe("123.4567");
    expect(serialized.when).toBe("2026-03-06T00:00:00.000Z");
  });
});
