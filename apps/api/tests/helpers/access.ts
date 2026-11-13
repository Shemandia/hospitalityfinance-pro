import type { ResolvedAccess } from "../../src/modules/access/resolver.js";
import { AccessService } from "../../src/modules/access/service.js";

/** An AccessService that answers every user with the same resolved access. */
export function staticAccessService(access: ResolvedAccess): AccessService {
  return new AccessService(
    {
      loadSnapshot: async () => {
        throw new Error("staticAccessService never loads");
      }
    },
    {
      read: async () => ({ access, slot: { key: "static" } }),
      write: async () => undefined,
      invalidateUser: async () => undefined,
      invalidateTenant: async () => undefined
    }
  );
}
