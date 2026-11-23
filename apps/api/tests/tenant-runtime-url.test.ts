import { describe, expect, it } from "vitest";
import { runtimeConnectionUrl } from "../src/db/tenant-location.js";

const direct = "postgresql://hfp_ab12cd34_app:p%40ss@db.internal:5432/hfp_demo?schema=public";

describe("runtime connection string", () => {
  it("connects directly with the connection limit when there is no pooler", () => {
    const url = new URL(runtimeConnectionUrl(direct, { connectionLimit: 3 }));
    expect(url.host).toBe("db.internal:5432");
    expect(url.searchParams.get("connection_limit")).toBe("3");
    expect(url.searchParams.get("schema")).toBe("public");
  });

  it("routes through the pooler, keeping database, role and password", () => {
    const url = new URL(
      runtimeConnectionUrl(direct, { connectionLimit: 2, poolerHost: "pooler", poolerPort: 6432 })
    );
    expect(url.host).toBe("pooler:6432");
    expect(url.pathname).toBe("/hfp_demo");
    expect(url.username).toBe("hfp_ab12cd34_app");
    expect(decodeURIComponent(url.password)).toBe("p@ss");
    expect(url.searchParams.get("connection_limit")).toBe("2");
  });

  it("keeps the database's port when the pooler's is not given", () => {
    const url = new URL(runtimeConnectionUrl(direct, { connectionLimit: 3, poolerHost: "pooler" }));
    expect(url.host).toBe("pooler:5432");
  });

  it("replaces a connection limit already in the string", () => {
    const url = new URL(
      runtimeConnectionUrl(`${direct}&connection_limit=40`, { connectionLimit: 3 })
    );
    expect(url.searchParams.getAll("connection_limit")).toEqual(["3"]);
  });
});
