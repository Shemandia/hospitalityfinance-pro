import crypto from "node:crypto";
import { getRegistryClient } from "./tenantRegistry.js";

/**
 * Generate a unique 8-character opaque hex code for a tenant.
 * Collision-checked against existing tenant codes in the registry.
 *
 * @param seed — any string to mix into the hash (e.g. slug, tenantId, etc.)
 */
export async function generateTenantCode(seed: string): Promise<string> {
  const registry = getRegistryClient();

  for (let attempt = 0; attempt < 10; attempt++) {
    const salt = crypto.randomBytes(8).toString("hex");
    const hash = crypto.createHash("sha256").update(`${seed}:${Date.now()}:${salt}`).digest("hex");
    const code = hash.substring(0, 8);

    const existing = await registry.tenant.findUnique({
      where: { tenantCode: code }
    });
    if (!existing) return code;
  }

  throw new Error("Failed to generate unique tenant code after 10 attempts");
}
