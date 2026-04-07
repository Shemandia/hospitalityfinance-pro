"use client";

import { useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import type { ApiContext } from "../lib/gl-api";
import { useTenantSlug } from "../hooks/use-tenant-slug";

/**
 * Builds an ApiContext for an import flow, using an explicitly-selected
 * property entity ID rather than the sidebar entity. The selected ID is sent
 * to the backend via the X-Entity-ID header (handled by lib/gl-api request()).
 *
 * Returns null when there is no session or no entity selection — consumers
 * use this to disable import action buttons.
 */
export function useImportApiContext(overrideEntityId: string | null): ApiContext | null {
  const { data: session } = useSession();
  const accessToken = session?.accessToken;
  const urlTenantSlug = useTenantSlug();
  const tenantSlug = urlTenantSlug ?? session?.user?.tenantSlug;

  // If next-auth couldn't refresh the access token, force re-login. Otherwise
  // mid-import the user would silently get "Token verification failed" because
  // the cached access token is expired and refresh is no longer possible.
  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      signIn();
    }
  }, [session?.error]);

  if (!accessToken || !overrideEntityId) {
    return null;
  }

  return { accessToken, entityId: overrideEntityId, tenantSlug };
}
