import { describe, expect, it } from "vitest";
import { plaintextSecrets } from "../src/db/registry-secrets.js";

describe("readable secrets in the registry", () => {
  it("flags a connection string that carries a password, and only that", () => {
    expect(
      plaintextSecrets([
        { slug: "adopted", databaseUrl: null },
        { slug: "legacy", databaseUrl: "postgresql://hfp:s3cret@localhost:5432/hfp_db" },
        { slug: "no-password", databaseUrl: "postgresql://hfp@localhost:5432/hfp_x" },
        { slug: "garbled", databaseUrl: "not a url" }
      ])
    ).toEqual(["legacy", "garbled"]);
  });
});
