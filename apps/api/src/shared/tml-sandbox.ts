/**
 * Whether a TML sandbox may fall back to Node's vm, which is not a security
 * boundary, when isolated-vm cannot load: only when TML_ALLOW_INSECURE_SANDBOX
 * is set, and never in production. The engine itself reads no environment.
 */
import { config } from "../config.js";

export function insecureTmlSandboxAllowed(): boolean {
  const { TML_ALLOW_INSECURE_SANDBOX, NODE_ENV } = config();
  return TML_ALLOW_INSECURE_SANDBOX && NODE_ENV !== "production";
}
