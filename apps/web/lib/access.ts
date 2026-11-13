/**
 * Access decisions in the web app (WP-A step 6).
 *
 * The only input is the access context from GET /api/v1/context. The three
 * checks mirror the API's route guard (apps/api/src/middleware/requirePermission.ts):
 *
 *   entity      the permission is held at the entity the request acts on
 *   tenant      the permission is held through a tenant-wide assignment
 *   any-entity  the permission is held tenant-wide or at one entity at least
 *
 * Menus and buttons call these, never a role name, so what the screen offers
 * is what the API allows. The API's integration tests run these functions
 * against the guard for every permission code (acceptance check 4).
 *
 * No imports: the module is shared with the API's tests by path.
 */

export type ContextEntity = {
  id: string;
  code: string | null;
  name: string;
  type: "CORPORATE" | "GROUP" | "CLUSTER" | "PROPERTY";
  /** The parent, when the user can open it too; otherwise null. */
  parentId: string | null;
  functionalCurrency: string;
  reportingCurrency: string;
  timezone: string;
  countryCode: string;
  isActive: boolean;
  /** Permission codes held at this entity, tenant-wide ones included. */
  permissions: string[];
};

export type AccessContext = {
  tenant: { id: string; slug: string; code: string; name: string };
  user: { id: string; email: string; name: string | null; mustChangePassword: boolean };
  tenantPermissions: string[];
  entities: ContextEntity[];
};

export type PermissionScope = "entity" | "tenant" | "any-entity";

function normalize(code: string): string {
  return code.trim().toUpperCase();
}

function wanted(codes: string | readonly string[]): string[] {
  return (typeof codes === "string" ? [codes] : [...codes]).map(normalize).filter(Boolean);
}

/** Whether the user holds any of `codes` at `entityId`. */
export function allowsAt(
  context: AccessContext | null,
  entityId: string | null,
  codes: string | readonly string[]
): boolean {
  if (!context || !entityId) return false;
  const entity = context.entities.find((e) => e.id === entityId);
  if (!entity) return false;
  return wanted(codes).some((code) => entity.permissions.includes(code));
}

/** Whether the user holds any of `codes` through a tenant-wide assignment. */
export function allowsTenantWide(
  context: AccessContext | null,
  codes: string | readonly string[]
): boolean {
  if (!context) return false;
  return wanted(codes).some((code) => context.tenantPermissions.includes(code));
}

/** Whether the user holds any of `codes` tenant-wide or at one entity at least. */
export function allowsAnywhere(
  context: AccessContext | null,
  codes: string | readonly string[]
): boolean {
  if (!context) return false;
  const codesWanted = wanted(codes);
  if (codesWanted.some((code) => context.tenantPermissions.includes(code))) return true;
  return context.entities.some((entity) =>
    codesWanted.some((code) => entity.permissions.includes(code))
  );
}

/** The check for a route of the given scope, as the guard makes it. */
export function allows(
  context: AccessContext | null,
  scope: PermissionScope,
  codes: string | readonly string[],
  entityId: string | null
): boolean {
  if (scope === "tenant") return allowsTenantWide(context, codes);
  if (scope === "any-entity") return allowsAnywhere(context, codes);
  return allowsAt(context, entityId, codes);
}

/**
 * Where the selected entity is remembered: per tenant and user (AUT-08), so a
 * selection made in one tenant is never sent to another.
 */
export function selectedEntityStorageKey(context: AccessContext): string {
  return `hfp:selected-entity:${context.tenant.id}:${context.user.id}`;
}

/** The entity to act on: the remembered one if the user can still open it, else the first. */
export function pickEntity(
  context: AccessContext | null,
  rememberedId: string | null
): ContextEntity | null {
  if (!context || context.entities.length === 0) return null;
  const usable = context.entities.filter((e) => e.isActive);
  const pool = usable.length > 0 ? usable : context.entities;
  return pool.find((e) => e.id === rememberedId) ?? pool[0] ?? null;
}
