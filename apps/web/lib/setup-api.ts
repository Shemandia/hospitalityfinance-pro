/**
 * Requests the setup wizard makes. A tenant in setup has no entity yet, so
 * these carry the session and the tenant only, never an entity.
 */
export type SetupContext = { accessToken: string; tenantSlug?: string };

type Envelope<T> = {
  data: T;
  errors?: Array<{ code: string; message: string }>;
};

async function request<T>(
  context: SetupContext,
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

/** A role of this tenant (GET /api/v1/admin/roles). */
export type SetupRole = { id: string; code: string; name: string; isSystem: boolean };

/** Starting data the API offers a new tenant (GET /api/v1/setup/templates). */
export type SetupTemplates = {
  departments: Array<{ code: string; name: string }>;
  currencies: Array<{ code: string; name: string }>;
};

/** The tenant's roles, for inviting users in the setup wizard. */
export async function getSetupRoles(context: SetupContext): Promise<SetupRole[]> {
  const res = await request<SetupRole[]>(context, "/api/v1/admin/roles");
  return res.data ?? [];
}

/** USALI departments and currencies to start from; the tenant chooses among them. */
export async function getSetupTemplates(context: SetupContext): Promise<SetupTemplates> {
  const res = await request<SetupTemplates>(context, "/api/v1/setup/templates");
  return res.data;
}
