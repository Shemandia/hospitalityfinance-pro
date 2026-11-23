/**
 * A database's structure and security, as sorted lines (WP-2, ARC-03).
 *
 * Covers what a tenant database's correctness depends on: tables and their
 * row-level security flags, columns, constraints, indexes, enums, functions,
 * triggers, policies, views and sequences in the public schema. Two databases
 * with the same lines have the same schema and the same security; the lines
 * that differ say exactly how they differ.
 *
 * Used to prove the baseline migration reproduces what the old setup built,
 * and by the adoption script to refuse a database that differs from it.
 * Prisma's own diff covers tables only, not policies, functions or triggers.
 *
 * Not compared: comments, ownership and grants (roles differ by design), and
 * Prisma's _prisma_migrations table.
 */

type Query = <T = unknown>(sql: string) => Promise<T[]>;

const SECTIONS: Array<{ name: string; sql: string }> = [
  {
    name: "table",
    sql: `select c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity as line
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> '_prisma_migrations'`
  },
  {
    name: "column",
    sql: `select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                 || case when a.attnotnull then ' not null' else '' end
                 || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') as line
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where n.nspname = 'public' and c.relkind in ('r', 'p', 'm') and a.attnum > 0
            and not a.attisdropped and c.relname <> '_prisma_migrations'`
  },
  {
    name: "constraint",
    sql: `select c.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid) as line
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname <> '_prisma_migrations' and con.contype <> 'n'`
  },
  {
    name: "index",
    sql: `select pg_get_indexdef(i.indexrelid) as line
          from pg_index i
          join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname <> '_prisma_migrations'`
  },
  {
    name: "enum",
    sql: `select t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as line
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public'
          group by t.typname`
  },
  {
    name: "function",
    sql: `select regexp_replace(pg_get_functiondef(p.oid), '\\s+', ' ', 'g') as line
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind in ('f', 'p')`
  },
  {
    name: "trigger",
    sql: `select pg_get_triggerdef(t.oid) as line
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and not t.tgisinternal`
  },
  {
    name: "policy",
    sql: `select tablename || ' ' || policyname || ' ' || permissive || ' ' || cmd
                 || ' roles=' || array_to_string(roles, ',')
                 || ' using=' || coalesce(regexp_replace(qual, '\\s+', ' ', 'g'), '-')
                 || ' check=' || coalesce(regexp_replace(with_check, '\\s+', ' ', 'g'), '-') as line
          from pg_policies where schemaname = 'public'`
  },
  {
    name: "view",
    sql: `select c.relname || ' ' || c.relkind::text || ' ' || regexp_replace(pg_get_viewdef(c.oid), '\\s+', ' ', 'g') as line
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('v', 'm')`
  },
  {
    name: "sequence",
    sql: `select c.relname as line
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'S'`
  }
];

/** Every line of the catalog, "section: detail", sorted. */
export async function catalogLines(query: Query): Promise<string[]> {
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const rows = await query<{ line: string }>(section.sql);
    for (const row of rows) lines.push(`${section.name}: ${row.line}`);
  }
  return lines.sort();
}

export type CatalogDiff = { missing: string[]; extra: string[] };

/** Lines `expected` has and `actual` lacks (missing), and the reverse (extra). */
export function diffCatalogs(expected: string[], actual: string[]): CatalogDiff {
  const a = new Set(actual);
  const e = new Set(expected);
  return {
    missing: expected.filter((line) => !a.has(line)),
    extra: actual.filter((line) => !e.has(line))
  };
}
