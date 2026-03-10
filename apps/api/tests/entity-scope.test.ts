import { describe, expect, it } from "vitest";
import { applyEntityScope } from "../src/db/entityScope.js";

describe("applyEntityScope", () => {
  it("adds entityId filter to findMany queries", () => {
    const scoped = applyEntityScope("findMany", {}, "entity-1");
    expect(scoped.where).toEqual({ entityId: "entity-1" });
  });

  it("preserves existing filters by wrapping in AND", () => {
    const scoped = applyEntityScope(
      "findMany",
      { where: { isActive: true } },
      "entity-1"
    );

    expect(scoped.where).toEqual({
      AND: [{ entityId: "entity-1" }, { isActive: true }]
    });
  });

  it("injects entityId into create payload when missing", () => {
    const scoped = applyEntityScope(
      "create",
      { data: { name: "Entity User" } },
      "entity-1"
    );

    expect(scoped.data).toEqual({
      name: "Entity User",
      entityId: "entity-1"
    });
  });

  it("adds entityId to each createMany row", () => {
    const scoped = applyEntityScope(
      "createMany",
      {
        data: [{ name: "A" }, { name: "B", entityId: "already-set" }]
      },
      "entity-1"
    );

    expect(scoped.data).toEqual([
      { name: "A", entityId: "entity-1" },
      { name: "B", entityId: "already-set" }
    ]);
  });
});
