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
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { getEntities, type EntitySummaryItem } from "../lib/gl-api";

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

  // Fetch all entities the user can access
  const { data: entities = [], isLoading } = useQuery({
    queryKey: ["entities", accessToken],
    queryFn: () => {
      if (!accessToken) throw new Error("No session");
      // Use first granted entity or a placeholder for superadmin (empty entityIds)
      const contextEntityId = sessionEntityIds[0] ?? "00000000-0000-0000-0000-000000000001";
      return getEntities({ accessToken, entityId: contextEntityId }).then((res) => res.data);
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000
  });

  // Filter to entities the user has access to
  // Superadmin (empty entityIds) sees all; others see granted entities + their children
  const userEntities = useMemo(() => {
    if (sessionEntityIds.length === 0) return entities; // superadmin
    const granted = new Set(sessionEntityIds);
    return entities.filter((e) => {
      if (granted.has(e.id)) return true;
      // Include children of granted parents
      if (e.parentId && granted.has(e.parentId)) return true;
      return false;
    });
  }, [entities, sessionEntityIds]);

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

  const switchEntity = useCallback((id: string) => {
    setSelectedId(id);
    // Force refetch all queries when switching entity
    window.location.reload();
  }, []);

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

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>;
}

export function useEntity() {
  return useContext(EntityContext);
}
