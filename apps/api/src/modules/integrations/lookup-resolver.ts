/**
 * Resolves a transformation's lookups against the tenant's lookup tables
 * (integration_lookup_*): how a source code becomes a ledger code.
 *
 * A table has named columns and ordered rows. A row covers a key range
 * (rangeFrom..rangeTo; equal bounds for one key) and, optionally, one
 * business unit (the record's entityCode). The first row in order that
 * covers the key and applies to the business unit gives the value of the
 * column asked for (the table's first column by default):
 *
 *   CONSTANT, MAP_TO  the value written in the row
 *   COPY              the key itself
 *   OMIT              nothing: the target is left empty
 *   REVERSE_SIGN      the key with its sign reversed (for amounts)
 *
 * When no row covers the key, a row whose value for the column is marked
 * default is used; otherwise the key is unmapped, and the profile's unmapped
 * policy decides (docs/IMPORT-PLAN.md section 5).
 */
import type { TmlLookupResolver, TmlRule } from "@hfp/tml-engine";

export type LookupValue = {
  columnId: string;
  valueType: "CONSTANT" | "COPY" | "MAP_TO" | "OMIT" | "REVERSE_SIGN";
  valueParam: string | null;
  isDefault: boolean;
};

export type LookupTableData = {
  name: string;
  columns: Array<{ id: string; name: string; columnOrder: number }>;
  rows: Array<{
    businessUnit: string | null;
    rangeFrom: string;
    rangeTo: string;
    rowOrder: number;
    values: LookupValue[];
  }>;
};

const NUMBER = /^-?\d+(\.\d+)?$/;

/** key within from..to; numerically when all three are numbers, else as text. */
function covers(from: string, to: string, key: string): boolean {
  if (NUMBER.test(from) && NUMBER.test(to) && NUMBER.test(key)) {
    const k = Number(key);
    return Number(from) <= k && k <= Number(to);
  }
  return from <= key && key <= to;
}

function valueOf(value: LookupValue, key: string): string | null {
  switch (value.valueType) {
    case "COPY":
      return key;
    case "OMIT":
      return null;
    case "REVERSE_SIGN": {
      const trimmed = key.trim();
      if (trimmed === "" || /^-?0+(\.0+)?$/.test(trimmed)) return trimmed;
      return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
    }
    default:
      return value.valueParam ?? "";
  }
}

/** The value for `key` in `table`'s `column`: a string, null (omit), or undefined (unmapped). */
export function resolveLookup(
  table: LookupTableData,
  request: { column?: string; key: string; businessUnit?: string }
): string | null | undefined {
  const columns = [...table.columns].sort((a, b) => a.columnOrder - b.columnOrder);
  const column = request.column ? columns.find((c) => c.name === request.column) : columns[0];
  if (!column) {
    throw new Error(
      `lookup table "${table.name}" has no column ${request.column ? `"${request.column}"` : ""}`.trim()
    );
  }
  const rows = [...table.rows]
    .sort((a, b) => a.rowOrder - b.rowOrder)
    .filter((r) => !r.businessUnit || r.businessUnit === request.businessUnit);
  for (const row of rows) {
    if (!covers(row.rangeFrom, row.rangeTo, request.key)) continue;
    const value = row.values.find((v) => v.columnId === column.id);
    if (value) return valueOf(value, request.key);
  }
  for (const row of rows) {
    const value = row.values.find((v) => v.columnId === column.id && v.isDefault);
    if (value) return valueOf(value, request.key);
  }
  return undefined;
}

/** The lookup tables a transformation's rules name (conditional branches included). */
export function lookupTablesOf(rules: ReadonlyArray<TmlRule>): string[] {
  const names = new Set<string>();
  const walk = (list: ReadonlyArray<TmlRule>) => {
    for (const rule of list) {
      if (rule.type === "lookup") names.add(rule.table);
      if (rule.type === "conditional") {
        walk(rule.then);
        walk(rule.else ?? []);
      }
    }
  };
  walk(rules);
  return [...names];
}

type LookupDb = {
  integrationLookupTable: {
    findMany(args: unknown): Promise<
      Array<{
        name: string;
        columns: LookupTableData["columns"];
        rows: Array<LookupTableData["rows"][number]>;
      }>
    >;
  };
};

/**
 * Loads the named tables and returns a resolver for the transformation
 * engine. A table that does not exist is an error of the profile (not an
 * unmapped value).
 */
export async function loadLookupResolver(
  db: unknown,
  names: ReadonlyArray<string>
): Promise<TmlLookupResolver> {
  const tables = new Map<string, LookupTableData>();
  if (names.length > 0) {
    const found = await (db as LookupDb).integrationLookupTable.findMany({
      where: { name: { in: [...names] } },
      select: {
        name: true,
        columns: { select: { id: true, name: true, columnOrder: true } },
        rows: {
          select: {
            businessUnit: true,
            rangeFrom: true,
            rangeTo: true,
            rowOrder: true,
            values: {
              select: { columnId: true, valueType: true, valueParam: true, isDefault: true }
            }
          }
        }
      }
    });
    for (const table of found) tables.set(table.name, table);
  }
  return ({ table, column, key, record }) => {
    const data = tables.get(table);
    if (!data) throw new Error(`lookup table "${table}" not found`);
    const businessUnit = record.entityCode ?? record.businessUnit;
    return resolveLookup(data, {
      ...(column !== undefined && { column }),
      key,
      ...(businessUnit != null && businessUnit !== "" && { businessUnit: String(businessUnit) })
    });
  };
}
