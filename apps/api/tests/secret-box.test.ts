/** Sealed registry secrets (WP-2, ARC-06). */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keyId, open, parseKey, seal, SecretBoxError } from "../src/shared/secret-box.js";
import { scramSha256Verifier } from "../src/db/scram.js";
import { appConnectionUrl, ownerConnectionUrl } from "../src/db/tenant-location.js";

const key = randomBytes(32);

describe("secret box", () => {
  it("opens what it sealed, and the sealed value does not contain the secret", () => {
    const sealed = seal("p@ss/word:1", key);
    expect(sealed).not.toContain("p@ss");
    expect(sealed.split(".")).toHaveLength(5);
    expect(sealed.startsWith(`v1.${keyId(key)}.`)).toBe(true);
    expect(open(sealed, key)).toBe("p@ss/word:1");
  });

  it("seals the same secret differently each time", () => {
    expect(seal("x", key)).not.toBe(seal("x", key));
  });

  it("names the key when a value was sealed with another one", () => {
    const other = randomBytes(32);
    expect(() => open(seal("x", other), key)).toThrow(`Sealed with key ${keyId(other)}`);
  });

  it("refuses an altered value", () => {
    const parts = seal("secret", key).split(".");
    const ct = Buffer.from(parts[4]!, "base64url");
    ct[0] = ct[0]! ^ 1;
    parts[4] = ct.toString("base64url");
    expect(() => open(parts.join("."), key)).toThrow(SecretBoxError);
  });

  it("accepts only a 32-byte key", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow("32 bytes");
    expect(parseKey(key.toString("base64"))).toEqual(key);
  });
});

describe("SCRAM-SHA-256 verifier", () => {
  // PostgreSQL accepting it is proven by the provisioning integration test,
  // which signs in as roles created with these verifiers.
  it("has PostgreSQL's format and never contains the password", () => {
    const v = scramSha256Verifier("pencil-and-paper");
    expect(v).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/
    );
    expect(v).not.toContain("pencil");
  });

  it("is deterministic for a given salt, and differs between salts", () => {
    const salt = Buffer.alloc(16, 7);
    expect(scramSha256Verifier("pw", salt)).toBe(scramSha256Verifier("pw", salt));
    expect(scramSha256Verifier("pw")).not.toBe(scramSha256Verifier("pw"));
  });
});

describe("tenant connection strings", () => {
  const location = {
    databaseUrl: null,
    dbHost: "db.internal",
    dbPort: 5432,
    dbName: "hfp_acme",
    ownerRole: "hfp_ab12cd34_owner",
    ownerPasswordEnc: "",
    appRole: "hfp_ab12cd34_app",
    appPasswordEnc: ""
  };

  it("builds the application role's and the owner's from the sealed passwords", () => {
    const k = key.toString("base64");
    process.env.PLATFORM_ENCRYPTION_KEY = k;
    const withPasswords = {
      ...location,
      ownerPasswordEnc: seal("owner-pw", key),
      appPasswordEnc: seal("app/pw:é", key)
    };
    expect(appConnectionUrl(withPasswords)).toBe(
      `postgresql://hfp_ab12cd34_app:${encodeURIComponent("app/pw:é")}@db.internal:5432/hfp_acme`
    );
    expect(ownerConnectionUrl(withPasswords)).toBe(
      "postgresql://hfp_ab12cd34_owner:owner-pw@db.internal:5432/hfp_acme"
    );
  });

  it("uses a pre-WP-2 tenant's stored connection string, and has no owner for it", () => {
    const legacy = { ...location, dbHost: null, databaseUrl: "postgresql://hfp:x@h/hfp_db" };
    expect(appConnectionUrl(legacy)).toBe("postgresql://hfp:x@h/hfp_db");
    expect(() => ownerConnectionUrl(legacy)).toThrow("no owner role");
  });
});
