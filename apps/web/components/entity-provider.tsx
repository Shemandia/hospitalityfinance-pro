"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth-provider";
import { pickEntity, selectedEntityStorageKey, type ContextEntity } from "../lib/access";

/**
 * The entity the user is working in (WP-A step 6).
 *
 * The list is the access context's: exactly the entities the API lets the
 * user open, by the same rule (AUT-07). The selection is remembered per
 * tenant and user (AUT-08) and is only a preference: every request is checked
 * by the API again.
 */

type EntityContextValue = {
  /** The entities the user can open, higher levels of the tree first. */
  entities: ContextEntity[];
  /** Currently selected entity */
  currentEntity: ContextEntity | null;
  /** Currently selected entity ID */
  entityId: string | null;
  /** Switch to a different entity */
  switchEntity: (id: string) => void;
  /** Loading state */
  isLoading: boolean;
};

const EntityContext = createContext<EntityContextValue>({
  entities: [],
  currentEntity: null,
  entityId: null,
  switchEntity: () => {},
  isLoading: true
});

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the selection lasts for this page only.
  }
}

export function EntityProvider({ children }: { children: ReactNode }) {
  const { context, status } = useAuth();
  const storageKey = context ? selectedEntityStorageKey(context) : null;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load the remembered selection for this tenant and user.
  useEffect(() => {
    setSelectedId(storageKey ? readStored(storageKey) : null);
  }, [storageKey]);

  const currentEntity = useMemo(() => pickEntity(context, selectedId), [context, selectedId]);
  const entityId = currentEntity?.id ?? null;

  useEffect(() => {
    if (storageKey && entityId) writeStored(storageKey, entityId);
  }, [storageKey, entityId]);

  const queryClient = useQueryClient();

  const switchEntity = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (storageKey) writeStored(storageKey, id);
      // Refetch everything with the new entity context.
      void queryClient.invalidateQueries();
    },
    [queryClient, storageKey]
  );

  const value = useMemo<EntityContextValue>(
    () => ({
      entities: context?.entities ?? [],
      currentEntity,
      entityId,
      switchEntity,
      isLoading: status === "loading"
    }),
    [context, currentEntity, entityId, switchEntity, status]
  );

  // A user with nothing to open. A tenant-wide grant (for example the
  // administrator of a tenant still being set up) is not blocked.
  if (
    status === "authenticated" &&
    context &&
    context.entities.length === 0 &&
    context.tenantPermissions.length === 0
  ) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-xl rounded-lg border border-amber-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Entity access is not configured</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your account is active, but no entity has been assigned to it. Contact an administrator
            to assign property or group access before using financial modules.
          </p>
        </div>
      </div>
    );
  }

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>;
}

export function useEntity() {
  return useContext(EntityContext);
}
