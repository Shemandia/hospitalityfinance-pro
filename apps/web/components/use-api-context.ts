"use client";

import { useSession } from "next-auth/react";
import type { ApiContext } from "../lib/gl-api";
import { useEntity } from "./entity-provider";

export function useApiContext(): ApiContext | null {
  const { data: session } = useSession();
  const { entityId } = useEntity();
  const accessToken = session?.accessToken;

  if (!accessToken || !entityId) {
    return null;
  }

  return { accessToken, entityId };
}
