/**
 * Access resolver — the pure rule behind every authorization decision (WP-A).
 *
 *   A request is allowed when the user holds the permission at the entity it
 *   acts on.
 *
 * Given the tenant's entity tree, a user's role assignments and the
 * permissions of each role, this computes which entities the user can open and
 * which permissions they hold at each. It does no I/O, so the rule can be
 * tested exhaustively; AccessService supplies the data and caches the result.
 *
 * Rules:
 *  - A TENANT assignment applies on tenant-level routes and at every entity.
 *  - An ENTITY assignment applies at its entity and at every entity below it,
 *    to any depth. It never applies to a parent or a sibling.
 *  - Permissions from several assignments that cover the same entity are
 *    unioned.
 *  - A user can open an entity when at least one assignment covers it, even if
 *    the role currently carries no permissions.
 *  - Inactive entities cannot be opened, but grants still flow through them to
 *    the active entities below.
 *  - An assignment that names an unknown role or an unknown entity grants
 *    nothing.
 */

export type AccessEntityNode = {
  id: string;
  parentId: string | null;
  isActive: boolean;
};

export type AccessAssignment =
  | { scopeType: "TENANT"; roleId: string }
  | { scopeType: "ENTITY"; roleId: string; entityId: string };

export type AccessInput = {
  entities: readonly AccessEntityNode[];
  assignments: readonly AccessAssignment[];
  /** Permission codes of every role referenced by the assignments. */
  rolePermissions: ReadonlyMap<string, readonly string[]>;
};

/** JSON-serialisable so it can be cached as-is. Arrays are sorted and unique. */
export type ResolvedAccess = {
  /** Permissions held through tenant-wide assignments. */
  tenantPermissions: string[];
  /** Entity id -> permissions held there. The keys are the entities the user can open. */
  entityPermissions: Record<string, string[]>;
};

export const NO_ACCESS: ResolvedAccess = Object.freeze({
  tenantPermissions: [],
  entityPermissions: {}
}) as ResolvedAccess;

export function normalizePermission(code: string): string {
  return code.trim().toUpperCase();
}

export function resolveAccess(input: AccessInput): ResolvedAccess {
  const byId = new Map<string, AccessEntityNode>();
  const children = new Map<string, string[]>();
  for (const entity of input.entities) {
    byId.set(entity.id, entity);
  }
  for (const entity of input.entities) {
    // A parent that is not part of the tree is treated as absent: the entity
    // is a root, and nothing is inherited from the unknown parent.
    if (entity.parentId !== null && byId.has(entity.parentId)) {
      const siblings = children.get(entity.parentId);
      if (siblings) siblings.push(entity.id);
      else children.set(entity.parentId, [entity.id]);
    }
  }

  const tenantPermissions = new Set<string>();
  let hasTenantAssignment = false;
  // Entity id -> permissions granted by ENTITY assignments covering it.
  const scoped = new Map<string, Set<string>>();

  for (const assignment of input.assignments) {
    const permissions = input.rolePermissions.get(assignment.roleId);
    if (!permissions) continue;

    if (assignment.scopeType === "TENANT") {
      hasTenantAssignment = true;
      for (const code of permissions) tenantPermissions.add(normalizePermission(code));
      continue;
    }

    if (!byId.has(assignment.entityId)) continue;
    const normalized = permissions.map(normalizePermission);

    // Walk the subtree. `seen` guards against a cycle in parent links.
    const seen = new Set<string>();
    const stack = [assignment.entityId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);

      let granted = scoped.get(id);
      if (!granted) {
        granted = new Set<string>();
        scoped.set(id, granted);
      }
      for (const code of normalized) granted.add(code);

      const below = children.get(id);
      if (below) stack.push(...below);
    }
  }

  const entityPermissions: Record<string, string[]> = {};
  for (const entity of input.entities) {
    if (!entity.isActive) continue;
    const granted = scoped.get(entity.id);
    if (!granted && !hasTenantAssignment) continue;
    const merged = new Set<string>(tenantPermissions);
    if (granted) for (const code of granted) merged.add(code);
    entityPermissions[entity.id] = [...merged].sort();
  }

  return {
    tenantPermissions: [...tenantPermissions].sort(),
    entityPermissions
  };
}

// ── Queries over a resolved result ───────────────────────────────────────────

export function canOpenEntity(access: ResolvedAccess, entityId: string): boolean {
  return Object.prototype.hasOwnProperty.call(access.entityPermissions, entityId);
}

export function hasEntityPermission(
  access: ResolvedAccess,
  entityId: string,
  permission: string
): boolean {
  if (!canOpenEntity(access, entityId)) return false;
  const held = access.entityPermissions[entityId];
  return held !== undefined && held.includes(normalizePermission(permission));
}

/** Tenant-level routes look only at tenant-wide assignments. */
export function hasTenantPermission(access: ResolvedAccess, permission: string): boolean {
  return access.tenantPermissions.includes(normalizePermission(permission));
}

export function openableEntityIds(access: ResolvedAccess): string[] {
  return Object.keys(access.entityPermissions);
}

/**
 * The entities at which the user holds at least one of `permissions`, or "all"
 * when one is held tenant-wide. This is how far an administrator's authority
 * reaches on routes that take no entity of their own.
 */
export function permittedEntityIds(
  access: ResolvedAccess,
  permissions: string | readonly string[]
): string[] | "all" {
  const wanted = (typeof permissions === "string" ? [permissions] : permissions).map(
    normalizePermission
  );
  if (wanted.some((code) => access.tenantPermissions.includes(code))) return "all";
  return Object.entries(access.entityPermissions)
    .filter(([, held]) => wanted.some((code) => held.includes(code)))
    .map(([entityId]) => entityId);
}
