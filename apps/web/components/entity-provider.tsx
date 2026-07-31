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
import { useSession } from "./auth-provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getEntities, type EntitySummaryItem } from "../lib/gl-api";
import { useTenantSlug } from "../hooks/use-tenant-slug";

type EntityContextValue = {
  /** All entities the user has access to */
  entities: EntitySummaryItem[];
  /** Currently selected entity */
  currentEntity: EntitySummaryItem | null;
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

const STORAGE_KEY = "hfp-selected-entity";

export function EntityProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const accessToken = session?.accessToken;
  const sessionEntityIds = session?.user?.entityIds ?? [];
  const sessionRoles = session?.user?.roles ?? [];
  const isCrossEntityAdmin = sessionRoles.some((role) =>
    ["SUPERADMIN", "PLATFORM_ADMIN"].includes(role.toUpperCase())
  );
  const urlTenantSlug = useTenantSlug();
  // The session's slug is authoritative — the /t/[code] URL segment is the
  // tenant CODE, not the slug, and must not be sent as X-Tenant-Slug.
  const tenantSlug = session?.user?.tenantSlug ?? urlTenantSlug ?? undefined;

  // Fetch all entities the user can access
  const { data: entities = [], isLoading } = useQuery({
    queryKey: ["entities", accessToken, tenantSlug],
    queryFn: () => {
      if (!accessToken) throw new Error("No session");
      if (sessionEntityIds.length === 0 && !isCrossEntityAdmin) {
        throw new Error("No entity assignments");
      }
      // Empty entityIds omits X-Entity-ID only for SUPERADMIN/PLATFORM_ADMIN.
      // Normal users with no assignments are blocked above with a configuration error.
      const contextEntityId = sessionEntityIds[0] ?? "";
      return getEntities({ accessToken, entityId: contextEntityId, tenantSlug }).then(
        (res) => res.data
      );
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000
  });

  // Filter to entities the user has access to
  // Empty entityIds means global access only for SUPERADMIN/PLATFORM_ADMIN.
  // Other users see assigned entities plus children of assigned parents.
  const userEntities = useMemo(() => {
    if (sessionEntityIds.length === 0) return isCrossEntityAdmin ? entities : [];
    const granted = new Set(sessionEntityIds);
    return entities.filter((e) => {
      if (granted.has(e.id)) return true;
      // Include children of granted parents
      if (e.parentId && granted.has(e.parentId)) return true;
      return false;
    });
  }, [entities, sessionEntityIds, isCrossEntityAdmin]);

  // Selected entity ID — initialize from localStorage or first entity
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  // Resolve the current entity object
  const currentEntity = useMemo(() => {
    if (!userEntities.length) return null;
    // If stored ID matches an entity the user has access to, use it
    const stored = userEntities.find((e) => e.id === selectedId);
    if (stored) return stored;
    // Fallback to first available
    return userEntities[0] ?? null;
  }, [userEntities, selectedId]);

  const entityId = currentEntity?.id ?? null;

  // Persist selection
  useEffect(() => {
    if (entityId) {
      localStorage.setItem(STORAGE_KEY, entityId);
    }
  }, [entityId]);

  const queryClient = useQueryClient();

  const switchEntity = useCallback(
    (id: string) => {
      setSelectedId(id);
      localStorage.setItem(STORAGE_KEY, id);
      // Invalidate all queries so they refetch with the new entity context
      queryClient.invalidateQueries();
    },
    [queryClient]
  );

  const value = useMemo<EntityContextValue>(
    () => ({
      entities: userEntities,
      currentEntity,
      entityId,
      switchEntity,
      isLoading
    }),
    [userEntities, currentEntity, entityId, switchEntity, isLoading]
  );

  if (accessToken && sessionEntityIds.length === 0 && !isCrossEntityAdmin && !isLoading) {
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
