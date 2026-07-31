import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Platform admin credential verification (server-only).
 *
 * A single operator account is defined via environment variables on the web
 * server — no database, no plaintext password anywhere:
 *
 *   PLATFORM_ADMIN_USERNAME       e.g. "admin"
 *   PLATFORM_ADMIN_PASSWORD_HASH  output of hashPassword("<password>")
 *
 * Regenerate the hash (from apps/web) with:
 *   npx tsx -e "import{hashPassword}from './lib/platform-auth';console.log(hashPassword(process.argv[1]))" "<new password>"
 */

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const HASH_PREFIX = "scrypt";

/** Hash a password as `scrypt:<saltHex>:<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES);
  return `${HASH_PREFIX}:${salt.toString("hex")}:${key.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [prefix, saltHex, hashHex] = stored.split(":");
  if (prefix !== HASH_PREFIX || !saltHex || !hashHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = scryptSync(password, salt, KEY_BYTES);
  return timingSafeEqual(actual, expected);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify operator credentials against the configured account.
 * Fails closed: missing or malformed configuration always rejects.
 */
export function verifyPlatformCredentials(username: string, password: string): boolean {
  const configuredUser = process.env.PLATFORM_ADMIN_USERNAME;
  const configuredHash = process.env.PLATFORM_ADMIN_PASSWORD_HASH;
  if (!configuredUser || !configuredHash) return false;
  if (!username || !password) return false;

  const userOk = timingSafeStringEqual(username, configuredUser);
  const passOk = verifyPassword(password, configuredHash);
  return userOk && passOk;
}

/** True when the operator account is configured on this server. */
export function isPlatformLoginConfigured(): boolean {
  return !!process.env.PLATFORM_ADMIN_USERNAME && !!process.env.PLATFORM_ADMIN_PASSWORD_HASH;
}
