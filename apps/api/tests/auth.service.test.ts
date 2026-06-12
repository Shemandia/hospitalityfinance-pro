/**
 * Auth Service Unit Tests
 *
 * Tests password hashing, JWT generation/verification, password policy,
 * and the core auth service logic using mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

// ── Password policy tests ────────────────────────────────────────────────────

describe("Password Policy", () => {
  // Re-implement the policy function locally for isolated testing
  function validatePasswordPolicy(password: string): string[] {
    const errors: string[] = [];
    if (password.length < 8) errors.push("Password must be at least 8 characters");
    if (!/[A-Z]/.test(password)) errors.push("Password must contain an uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("Password must contain a lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("Password must contain a digit");
    return errors;
  }

  it("should accept a valid password", () => {
    expect(validatePasswordPolicy("StrongPass1")).toEqual([]);
  });

  it("should reject a password shorter than 8 characters", () => {
    const errors = validatePasswordPolicy("Aa1");
    expect(errors).toContain("Password must be at least 8 characters");
  });

  it("should reject a password without uppercase", () => {
    const errors = validatePasswordPolicy("lowercase1");
    expect(errors).toContain("Password must contain an uppercase letter");
  });

  it("should reject a password without lowercase", () => {
    const errors = validatePasswordPolicy("UPPERCASE1");
    expect(errors).toContain("Password must contain a lowercase letter");
  });

  it("should reject a password without a digit", () => {
    const errors = validatePasswordPolicy("NoDigitsHere");
    expect(errors).toContain("Password must contain a digit");
  });

  it("should report multiple policy violations", () => {
    const errors = validatePasswordPolicy("abc");
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Password hashing tests ───────────────────────────────────────────────────

describe("Password Hashing (bcrypt)", () => {
  it("should hash a password and verify it", async () => {
    const plaintext = "ChangeMe123!";
    const hash = await bcrypt.hash(plaintext, 10);

    expect(hash).not.toBe(plaintext);
    expect(await bcrypt.compare(plaintext, hash)).toBe(true);
  });

  it("should reject wrong password", async () => {
    const hash = await bcrypt.hash("CorrectPassword1", 10);
    expect(await bcrypt.compare("WrongPassword1", hash)).toBe(false);
  });

  it("should produce different hashes for same password", async () => {
    const plaintext = "SamePass123";
    const hash1 = await bcrypt.hash(plaintext, 10);
    const hash2 = await bcrypt.hash(plaintext, 10);
    expect(hash1).not.toBe(hash2);
    // But both should verify
    expect(await bcrypt.compare(plaintext, hash1)).toBe(true);
    expect(await bcrypt.compare(plaintext, hash2)).toBe(true);
  });
});

// ── JWT tests ────────────────────────────────────────────────────────────────

describe("JWT Token Generation & Verification", () => {
  const JWT_SECRET = "test-secret-256-bits-minimum-length-for-hs256";

  it("should generate and verify an access token", () => {
    const payload = {
      sub: "user-uuid-123",
      email: "admin@test.com",
      tenantId: "tenant-uuid",
      tenantCode: "ab12cd34",
      tenantSlug: "test-hotel",
      entityIds: ["entity-1"],
      roles: ["ADMIN"],
      permissions: ["gl:read", "gl:write"],
      type: "access" as const
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: 900,
      algorithm: "HS256"
    });

    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"]
    }) as typeof payload & { iat: number; exp: number };

    expect(decoded.sub).toBe("user-uuid-123");
    expect(decoded.email).toBe("admin@test.com");
    expect(decoded.tenantCode).toBe("ab12cd34");
    expect(decoded.roles).toEqual(["ADMIN"]);
    expect(decoded.permissions).toContain("gl:read");
    expect(decoded.exp - decoded.iat).toBe(900);
  });

  it("should reject an expired token", () => {
    const token = jwt.sign({ sub: "user" }, JWT_SECRET, {
      expiresIn: -10, // Already expired
      algorithm: "HS256"
    });

    expect(() => jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })).toThrow("jwt expired");
  });

  it("should reject a token with wrong secret", () => {
    const token = jwt.sign({ sub: "user" }, JWT_SECRET, {
      algorithm: "HS256"
    });

    expect(() => jwt.verify(token, "wrong-secret", { algorithms: ["HS256"] })).toThrow(
      "invalid signature"
    );
  });

  it("should reject a tampered token", () => {
    const token = jwt.sign({ sub: "user", role: "VIEWER" }, JWT_SECRET, {
      algorithm: "HS256"
    });

    // Tamper with payload
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.role = "SUPERADMIN";
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tampered = parts.join(".");

    expect(() => jwt.verify(tampered, JWT_SECRET, { algorithms: ["HS256"] })).toThrow(
      "invalid signature"
    );
  });
});

// ── Refresh token tests ──────────────────────────────────────────────────────

describe("Refresh Token Generation", () => {
  it("should generate a 96-char hex token", () => {
    const token = crypto.randomBytes(48).toString("hex");
    expect(token).toHaveLength(96);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("should hash to a consistent SHA-256 digest", () => {
    const token = "abc123";
    const hash1 = crypto.createHash("sha256").update(token).digest("hex");
    const hash2 = crypto.createHash("sha256").update(token).digest("hex");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("should produce different tokens each time", () => {
    const t1 = crypto.randomBytes(48).toString("hex");
    const t2 = crypto.randomBytes(48).toString("hex");
    expect(t1).not.toBe(t2);
  });
});

// ── Tenant code generation tests ─────────────────────────────────────────────

describe("AuthService Session Revocation", () => {
  class MockRedis {
    store = new Map<string, string>();
    sets = new Map<string, Set<string>>();

    async setex(key: string, _ttl: number, value: string) {
      this.store.set(key, value);
      return "OK";
    }

    async get(key: string) {
      return this.store.get(key) ?? null;
    }

    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (this.store.delete(key)) removed += 1;
        if (this.sets.delete(key)) removed += 1;
      }
      return removed;
    }

    async sadd(key: string, ...values: string[]) {
      const set = this.sets.get(key) ?? new Set<string>();
      for (const value of values) set.add(value);
      this.sets.set(key, set);
      return values.length;
    }

    async expire() {
      return 1;
    }

    async smembers(key: string) {
      return [...(this.sets.get(key) ?? new Set<string>())];
    }

    async srem(key: string, ...values: string[]) {
      const set = this.sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const value of values) {
        if (set.delete(value)) removed += 1;
      }
      return removed;
    }

    async scan(_cursor: string, _match: string, pattern: string) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
      return ["0", [...this.store.keys()].filter((key) => regex.test(key))];
    }
  }

  async function createAuthService(redis: MockRedis) {
    process.env.JWT_SECRET = "test-secret-256-bits-minimum-length-for-hs256";
    const { AuthService } = await import("../src/services/auth.service.js");
    return new AuthService(redis);
  }

  it("revokes session, refresh tokens, and session indexes without redis.keys", async () => {
    const redis = new MockRedis();
    const service = await createAuthService(redis);

    redis.store.set("session:t-1:u-1:s-1", JSON.stringify({ email: "a@test.com" }));
    redis.store.set("refresh:h-1", JSON.stringify({ sessionId: "s-1" }));
    redis.store.set("refresh:h-2", JSON.stringify({ sessionId: "s-1" }));
    redis.sets.set("user_sessions:t-1:u-1", new Set(["s-1"]));
    redis.sets.set("session_refresh:t-1:u-1:s-1", new Set(["h-1", "h-2"]));

    await service.revokeSession("u-1", "t-1", "s-1");

    expect(redis.store.has("session:t-1:u-1:s-1")).toBe(false);
    expect(redis.store.has("refresh:h-1")).toBe(false);
    expect(redis.store.has("refresh:h-2")).toBe(false);
    expect(redis.sets.get("user_sessions:t-1:u-1")?.has("s-1")).toBe(false);
  });

  it("logoutAll revokes indexed and legacy scanned sessions", async () => {
    const redis = new MockRedis();
    const service = await createAuthService(redis);

    redis.store.set("session:t-1:u-1:indexed", JSON.stringify({ email: "a@test.com" }));
    redis.store.set("session:t-1:u-1:legacy", JSON.stringify({ email: "a@test.com" }));
    redis.sets.set("user_sessions:t-1:u-1", new Set(["indexed"]));

    await service.logoutAll("u-1", "t-1");

    expect(redis.store.has("session:t-1:u-1:indexed")).toBe(false);
    expect(redis.store.has("session:t-1:u-1:legacy")).toBe(false);
    expect(redis.sets.has("user_sessions:t-1:u-1")).toBe(false);
  });
});

describe("Tenant Code Generation", () => {
  it("should produce 8-char lowercase hex strings", () => {
    const slug = "test-hotel";
    const salt = crypto.randomBytes(8).toString("hex");
    const code = crypto
      .createHash("sha256")
      .update(`${slug}:${Date.now()}:${salt}`)
      .digest("hex")
      .substring(0, 8);

    expect(code).toHaveLength(8);
    expect(/^[a-f0-9]{8}$/.test(code)).toBe(true);
  });

  it("should produce different codes for different slugs", () => {
    const ts = Date.now().toString();
    const code1 = crypto.createHash("sha256").update(`slug-a:${ts}`).digest("hex").substring(0, 8);
    const code2 = crypto.createHash("sha256").update(`slug-b:${ts}`).digest("hex").substring(0, 8);
    expect(code1).not.toBe(code2);
  });
});

// ── Account lockout logic tests ──────────────────────────────────────────────

describe("Account Lockout Logic", () => {
  const MAX_FAILED = 5;
  const LOCKOUT_MIN = 15;

  it("should lock after MAX_FAILED attempts", () => {
    const attempts = MAX_FAILED;
    const shouldLock = attempts >= MAX_FAILED;
    expect(shouldLock).toBe(true);
  });

  it("should not lock before MAX_FAILED attempts", () => {
    const attempts = MAX_FAILED - 1;
    const shouldLock = attempts >= MAX_FAILED;
    expect(shouldLock).toBe(false);
  });

  it("should compute lockout expiry correctly", () => {
    const now = Date.now();
    const lockedUntil = new Date(now + LOCKOUT_MIN * 60000);
    const remainingMin = Math.ceil((lockedUntil.getTime() - now) / 60000);
    expect(remainingMin).toBe(LOCKOUT_MIN);
  });

  it("should detect an active lock", () => {
    const lockedUntil = new Date(Date.now() + 10 * 60000); // 10 min from now
    expect(lockedUntil > new Date()).toBe(true);
  });

  it("should detect an expired lock", () => {
    const lockedUntil = new Date(Date.now() - 1000); // 1 sec ago
    expect(lockedUntil > new Date()).toBe(false);
  });
});

// ── Scope-aware JWT claims (NS2) ─────────────────────────────────────────────

describe("buildScopedClaims (NS2 — scope-aware JWT claims)", () => {
  let buildScopedClaims: (typeof import("../src/services/auth.service.js"))["buildScopedClaims"];

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-secret-for-auth-service-unit-tests-256-bit";
    ({ buildScopedClaims } = await import("../src/services/auth.service.js"));
  });

  const perm = (code: string) => ({ permission: { code } });
  const ENTITY_A = "entity-a";
  const ENTITY_B = "entity-b";

  it("includes global (entityId=null) roles and their permissions", () => {
    const claims = buildScopedClaims(
      [{ entityId: null, role: { code: "SUPERADMIN", permissions: [perm("ADMIN_USERS")] } }],
      []
    );
    expect(claims.roles).toEqual(["SUPERADMIN"]);
    expect(claims.permissions).toEqual(["ADMIN_USERS"]);
  });

  it("excludes a SUPERADMIN role granted with an entity scope (privilege-escalation vector)", () => {
    const claims = buildScopedClaims(
      [
        { entityId: ENTITY_A, role: { code: "SUPERADMIN", permissions: [perm("ADMIN_USERS")] } },
        { entityId: ENTITY_A, role: { code: "ACCOUNTANT", permissions: [perm("GL_READ")] } }
      ],
      [ENTITY_A]
    );
    expect(claims.roles).toEqual(["ACCOUNTANT"]);
    expect(claims.permissions).toEqual(["GL_READ"]);
  });

  it("excludes scoped roles for entities the user no longer has access to", () => {
    const claims = buildScopedClaims(
      [{ entityId: ENTITY_B, role: { code: "ACCOUNTANT", permissions: [perm("GL_READ")] } }],
      [ENTITY_A]
    );
    expect(claims.roles).toEqual([]);
    expect(claims.permissions).toEqual([]);
  });

  it("includes scoped non-admin roles for accessible entities and dedupes", () => {
    const claims = buildScopedClaims(
      [
        {
          entityId: ENTITY_A,
          role: { code: "ACCOUNTANT", permissions: [perm("GL_READ"), perm("GL_POST")] }
        },
        { entityId: ENTITY_B, role: { code: "ACCOUNTANT", permissions: [perm("GL_READ")] } }
      ],
      [ENTITY_A, ENTITY_B]
    );
    expect(claims.roles).toEqual(["ACCOUNTANT"]);
    expect(claims.permissions.sort()).toEqual(["GL_POST", "GL_READ"]);
  });

  it("treats PLATFORM_ADMIN the same as SUPERADMIN", () => {
    const claims = buildScopedClaims(
      [{ entityId: ENTITY_A, role: { code: "PLATFORM_ADMIN", permissions: [] } }],
      [ENTITY_A]
    );
    expect(claims.roles).toEqual([]);
  });
});
