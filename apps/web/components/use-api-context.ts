"use client";

import { useSession } from "next-auth/react";
import type { ApiContext } from "../lib/gl-api";

export function useApiContext(): ApiContext | null {
  const { data: session } = useSession();
  const accessToken = session?.accessToken;
  const entityId = session?.user?.entityIds?.[0];

  if (!accessToken || !entityId) {
    return null;
  }

  return { accessToken, entityId };
}
