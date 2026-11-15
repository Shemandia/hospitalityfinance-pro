/**
 * A PostgreSQL SCRAM-SHA-256 password verifier, computed here (RFC 5802/7677,
 * PostgreSQL's format).
 *
 * `CREATE ROLE ... PASSWORD '<verifier>'` stores the verifier as is, so the
 * password itself never appears in SQL text, server logs or
 * pg_stat_statements. A client still signs in with the plain password.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 4096;

export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** A random password of URL-safe characters: safe in a connection string. */
export function randomPassword(): string {
  return randomBytes(32).toString("base64url");
}
