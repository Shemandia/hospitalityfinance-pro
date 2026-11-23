/**
 * Rotating PLATFORM_ENCRYPTION_KEY and resetting tenant database passwords
 * (docs/SECRETS-ROTATION.md), run as an operator runs them: the two commands
 * as separate processes.
 *
 *   1. db:reseal-secrets with the new key and the old one as _PREVIOUS:
 *      every sealed password names the new key and still opens to a working
 *      password; the old key alone can no longer open them.
 *   2. db:reset-tenant-passwords (the recovery for a lost key): new passwords
 *      work, the old ones are refused.
 *   3. A lost key: with only a new key, nothing opens and re-sealing fails;
 *      resetting the passwords under the new key restores access.
 *   4. The registry row holds nothing readable: no connection string, and
 *      both passwords sealed (v1.<key id>.…).
 *
 * Needs TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL (migrated) and
 * PLATFORM_ENCRYPTION_KEY; the test role needs CREATEDB and CREATEROLE.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_REGISTRY_DATABASE_URL &&
    process.env.PLATFORM_ENCRYPTION_KEY
  );
  if (ready) process.env.REGISTRY_DATABASE_URL = process.env.TEST_REGISTRY_DATABASE_URL;
  return { ready, oldKey: process.env.PLATFORM_ENCRYPTION_KEY ?? "" };
});

import { PrismaClient } from "../../src/db/client.js";
import { PrismaClient as RegistryClient } from "../../src/db/registry-client.js";
import type { NewLocation } from "../../src/db/tenant-location.js";
import { dropTenantDatabase } from "../../src/db/tenant-roles.js";
import { plaintextSecrets } from "../../src/db/registry-secrets.js";
import { keyId, open, parseKey } from "../../src/shared/secret-box.js";
import {
  createDatabase,
  migrateDatabase,
  planTenantDatabase,
  secureDatabase
} from "../../src/modules/tenant/tenant-database.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function command(script: string, extra: Record<string, string>) {
  const r = spawnSync("pnpm", ["run", "-s", script, "--tenant", slug], {
    cwd: apiRoot,
    env: { ...process.env, ...extra },
    encoding: "utf8"
  });
  return { code: r.status, output: `${r.stdout}${r.stderr}` };
}

const slug = `it-sec-${Date.now().toString(36)}`;

async function canConnect(url: string): Promise<boolean> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await db.$queryRawUnsafe("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await db.$disconnect();
  }
}

if (!env.ready) {
  describe("tenant secrets", () => {
    it("requires TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY", () => {
      expect(env.ready).toBe(true);
    });
  });
} else {
  describe("tenant secrets", () => {
    const registry = new RegistryClient({ datasourceUrl: process.env.TEST_REGISTRY_DATABASE_URL });
    const admin = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const newKey = randomBytes(32).toString("base64");
    let location: NewLocation;
    const row = () => registry.tenant.findUniqueOrThrow({ where: { slug } });

    beforeAll(async () => {
      location = planTenantDatabase(slug, Date.now().toString(16).slice(-8));
      await registry.tenant.create({
        data: {
          slug,
          tenantCode: location.ownerRole.slice(4, 12),
          name: slug,
          adminEmail: "o@it.test",
          ...location,
          provisionedAt: new Date()
        }
      });
      await createDatabase(location);
      await migrateDatabase(location);
      await secureDatabase(location);
    }, 300_000);

    afterAll(async () => {
      await dropTenantDatabase(admin, location);
      await registry.tenant.deleteMany({ where: { slug } });
      await registry.$disconnect();
      await admin.$disconnect();
    }, 60_000);

    it("re-seals every password under the new key, and the passwords still work", async () => {
      const before = await row();
      const appPassword = open(before.appPasswordEnc!, parseKey(env.oldKey));
      const result = command("db:reseal-secrets", {
        PLATFORM_ENCRYPTION_KEY: newKey,
        PLATFORM_ENCRYPTION_KEY_PREVIOUS: env.oldKey
      });
      expect(result.code, result.output).toBe(0);
      const after = await row();
      const id = keyId(parseKey(newKey));
      expect(after.appPasswordEnc!.split(".")[1]).toBe(id);
      expect(after.ownerPasswordEnc!.split(".")[1]).toBe(id);
      expect(open(after.appPasswordEnc!, parseKey(newKey))).toBe(appPassword);
      expect(() => open(after.appPasswordEnc!, parseKey(env.oldKey))).toThrow(/Sealed with key/);
    }, 120_000);

    it("resets the passwords: the new ones work, the old ones are refused", async () => {
      const before = await row();
      // Opened with the new key: the previous test re-sealed them.
      const oldPassword = open(before.appPasswordEnc!, parseKey(newKey));
      const result = command("db:reset-tenant-passwords", { PLATFORM_ENCRYPTION_KEY: newKey });
      expect(result.code, result.output).toBe(0);
      const after = await row();
      const newPassword = open(after.appPasswordEnc!, parseKey(newKey));
      expect(newPassword).not.toBe(oldPassword);
      const url = (password: string) => {
        const u = new URL("postgresql://placeholder.invalid");
        u.hostname = after.dbHost!;
        u.port = String(after.dbPort);
        u.pathname = `/${after.dbName}`;
        u.username = after.appRole!;
        u.password = password;
        return u.toString();
      };
      expect(await canConnect(url(newPassword))).toBe(true);
      expect(await canConnect(url(oldPassword))).toBe(false);
    }, 120_000);

    it("recovers from a lost key: a password reset under a new key restores access", async () => {
      const sealedBefore = (await row()).appPasswordEnc!;
      const replacement = randomBytes(32).toString("base64");
      // The key in use (newKey, since the first test) is lost: only the replacement is configured.
      const reseal = command("db:reseal-secrets", {
        PLATFORM_ENCRYPTION_KEY: replacement,
        PLATFORM_ENCRYPTION_KEY_PREVIOUS: ""
      });
      expect(reseal.code, reseal.output).toBe(1);
      expect((await row()).appPasswordEnc).toBe(sealedBefore);

      const reset = command("db:reset-tenant-passwords", {
        PLATFORM_ENCRYPTION_KEY: replacement,
        PLATFORM_ENCRYPTION_KEY_PREVIOUS: ""
      });
      expect(reset.code, reset.output).toBe(0);
      const after = await row();
      const password = open(after.appPasswordEnc!, parseKey(replacement));
      const u = new URL("postgresql://placeholder.invalid");
      u.hostname = after.dbHost!;
      u.port = String(after.dbPort);
      u.pathname = `/${after.dbName}`;
      u.username = after.appRole!;
      u.password = password;
      expect(await canConnect(u.toString())).toBe(true);
      expect(() => open(after.appPasswordEnc!, parseKey(newKey))).toThrow(/Sealed with key/);
    }, 180_000);

    it("leaves nothing readable in the registry row", async () => {
      const r = await row();
      expect(plaintextSecrets([r])).toEqual([]);
      for (const sealed of [r.appPasswordEnc!, r.ownerPasswordEnc!]) {
        expect(sealed.startsWith("v1.")).toBe(true);
      }
      expect(r.databaseUrl).toBeNull();
    });
  });
}
