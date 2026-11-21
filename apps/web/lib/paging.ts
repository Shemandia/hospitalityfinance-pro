/**
 * Server-side pages of a list.
 *
 * A list endpoint takes `limit` and `offset` and answers with one page of
 * rows and `meta: { total, limit, offset }`. The table asks only for the page
 * it shows, so filters and counts cover every row, not the rows loaded.
 */
import { useEffect, useState } from "react";

export type PageMeta = { total: number; limit: number; offset: number };
export type Page<T> = { rows: T[]; total: number };

export const PAGE_SIZES = [10, 20, 50] as const;

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The rows and total of a list response; a response without a total counts its rows. */
export function pageFrom<T>(envelope: {
  data: T[] | null | undefined;
  meta?: Record<string, unknown>;
}): Page<T> {
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  return { rows, total: asNumber(envelope.meta?.total) ?? rows.length };
}

/**
 * Every row of a list, page after page (for an export). Stops on the total,
 * on a short page, or after `maxPages` as a guard against a list that grows
 * while it is read.
 */
export async function fetchAllRows<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  limit = 200,
  maxPages = 500
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(rows.length, limit);
    rows.push(...page.rows);
    if (page.rows.length === 0 || page.rows.length < limit || rows.length >= page.total) break;
  }
  return rows;
}

/**
 * The page a table shows. Back to the first page whenever one of `resetOn`
 * changes (a filter, a search, the selected property).
 */
export function usePaging(resetOn: readonly unknown[], initialSize = 20) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(initialSize);

  // Reset during render, not in an effect, so no request goes out for the old
  // page with the new filter.
  const key = JSON.stringify(resetOn);
  const [seenKey, setSeenKey] = useState(key);
  const changed = key !== seenKey;
  if (changed) {
    setSeenKey(key);
    setPage(0);
  }
  const current = changed ? 0 : page;

  return {
    page: current,
    pageSize,
    offset: current * pageSize,
    setPage,
    setPageSize: (size: number) => {
      setPageSizeState(size);
      setPage(0);
    }
  };
}

/** The last page index for `total` rows, at least 0. */
export function lastPage(total: number, pageSize: number): number {
  return Math.max(0, Math.ceil(total / pageSize) - 1);
}

/** `value`, once it has stopped changing for `ms` (so a search box asks the server once). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
