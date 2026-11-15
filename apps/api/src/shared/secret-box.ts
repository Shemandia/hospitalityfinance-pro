/**
 * Encryption of secrets kept in the registry (WP-2, ARC-06).
 *
 * AES-256-GCM with the platform key from PLATFORM_ENCRYPTION_KEY (32 bytes,
 * base64), supplied by the environment and never stored. A sealed value is
 *
 *   v1.<key id>.<iv>.<tag>.<ciphertext>          (base64url parts)
 *
 * The key id (first 8 hex characters of the key's SHA-256) names the key that
 * sealed the value, so a value sealed with another key is refused with a clear
 * message instead of failing authentication, and a rotation (docs/
 * SECRETS-ROTATION.md) can find the values still sealed with the old key.
 * Plain text exists only in memory.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { requireConfig } from "../config.js";

const VERSION = "v1";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/** The key's id: the first 8 hex characters of its SHA-256. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** Decodes and checks a base64 key of exactly 32 bytes. */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new SecretBoxError("PLATFORM_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  }
  return key;
}

function platformKey(): Buffer {
  const { PLATFORM_ENCRYPTION_KEY } = requireConfig(
    ["PLATFORM_ENCRYPTION_KEY"],
    "the registry's encrypted secrets"
  );
  return parseKey(PLATFORM_ENCRYPTION_KEY);
}

/** Seals `plain` with `key` (default: the platform key). */
export function seal(plain: string, key: Buffer = platformKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    keyId(key),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

/** Opens a value sealed by `seal`. Throws on another key, a damaged value or tampering. */
export function open(sealed: string, key: Buffer = platformKey()): string {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new SecretBoxError("Not a sealed value.");
  }
  const [, id, iv, tag, ciphertext] = parts as [string, string, string, string, string];
  if (id !== keyId(key)) {
    throw new SecretBoxError(
      `Sealed with key ${id}, but PLATFORM_ENCRYPTION_KEY is key ${keyId(key)}.`
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new SecretBoxError("The sealed value is damaged or was altered.");
  }
}
