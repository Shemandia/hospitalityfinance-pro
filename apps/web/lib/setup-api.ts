import type { ApiContext } from "./gl-api";

type Envelope<T> = {
  data: T;
  errors?: Array<{ code: string; message: string }>;
};

async function request<T>(
  context: ApiContext,
  path: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(context.accessToken && context.accessToken !== "cookie"
        ? { Authorization: `Bearer ${context.accessToken}` }
        : {}),
      ...(context.entityId ? { "X-Entity-ID": context.entityId } : {}),
      ...(context.tenantSlug ? { "X-Tenant-Slug": context.tenantSlug } : {}),
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => ({ data: null }))) as Envelope<T>;
  if (!response.ok) {
    const message = payload.errors?.[0]?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export type SetupRole = { id?: string; code?: string; name?: string; isActive?: boolean };
export type SetupDepartment = { id?: string; code?: string; name?: string; isActive?: boolean };
export type SetupCurrency = {
  code: string;
  name?: string;
  decimalPlaces?: number | null;
  isActive?: boolean;
};

function normalizeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.items)) return v.items as T[];
    if (Array.isArray(v.data)) return v.data as T[];
  }
  return [];
}

export async function getSetupRoles(context: ApiContext): Promise<SetupRole[]> {
  const res = await request<unknown>(context, "/api/v1/roles");
  return normalizeArray<SetupRole>(res.data).filter((r) => r && (r.code || r.name));
}

export async function getSetupDepartments(context: ApiContext): Promise<SetupDepartment[]> {
  const res = await request<unknown>(context, "/api/v1/departments");
  return normalizeArray<SetupDepartment>(res.data).filter((d) => d && (d.code || d.name));
}

export async function getSetupCurrencies(context: ApiContext): Promise<SetupCurrency[]> {
  const res = await request<unknown>(context, "/api/v1/fx/currencies");
  return normalizeArray<SetupCurrency>(res.data).filter((c) => c && c.code);
}
