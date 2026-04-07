"use client";

import { useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import type { ApiContext } from "../lib/gl-api";
import { useEntity } from "./entity-provider";
import { useTenantSlug } from "../hooks/use-tenant-slug";

export function useApiContext(): ApiContext | null {
  const { data: session } = useSession();
  const { entityId } = useEntity();
  const accessToken = session?.accessToken;
  const urlTenantSlug = useTenantSlug();
  const tenantSlug = urlTenantSlug ?? session?.user?.tenantSlug;

  // If next-auth couldn't refresh the access token, force re-login.
  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      signIn();
    }
  }, [session?.error]);

  if (!accessToken || !entityId) {
    return null;
  }

  return { accessToken, entityId, tenantSlug };
}
