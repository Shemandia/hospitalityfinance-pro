/**
 * The property switcher's tree, built from the access context only.
 *
 * Each entity sits under its parent; an entity whose parent the user cannot
 * open (parentId null, or a parent not in the list) is a root. Siblings keep
 * the context's order (higher levels first, then by name), so the tree is
 * stable between loads.
 */
import type { ContextEntity } from "./access";

export type PropertyRow = { entity: ContextEntity; depth: number };

export function buildPropertyTree(entities: readonly ContextEntity[]): PropertyRow[] {
  const ids = new Set(entities.map((e) => e.id));
  const children = new Map<string | null, ContextEntity[]>();
  for (const entity of entities) {
    const parent = entity.parentId && ids.has(entity.parentId) ? entity.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(entity);
    children.set(parent, list);
  }

  const rows: PropertyRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const entity of children.get(parent) ?? []) {
      if (seen.has(entity.id)) continue; // a cycle in bad data must not loop
      seen.add(entity.id);
      rows.push({ entity, depth });
      walk(entity.id, depth + 1);
    }
  };
  walk(null, 0);
  // Entities caught in a parent cycle are never reached from a root: list them flat.
  for (const entity of entities) {
    if (!seen.has(entity.id)) rows.push({ entity, depth: 0 });
  }
  return rows;
}

function matches(entity: ContextEntity, needle: string): boolean {
  return [entity.name, entity.code ?? "", entity.functionalCurrency].some((field) =>
    field.toLowerCase().includes(needle)
  );
}

/**
 * The rows whose name, code or currency contains `query`, with the ancestors
 * that lead to them, so a match is still shown in its place in the tree.
 */
export function filterPropertyTree(rows: readonly PropertyRow[], query: string): PropertyRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];

  const byId = new Map(rows.map((row) => [row.entity.id, row.entity]));
  const keep = new Set<string>();
  for (const { entity } of rows) {
    if (!matches(entity, needle)) continue;
    let current: ContextEntity | undefined = entity;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return rows.filter((row) => keep.has(row.entity.id));
}

/** The short label for narrow screens: the entity's code, or its name when it has none. */
export function shortLabel(entity: ContextEntity): string {
  return entity.code?.trim() || entity.name;
}
