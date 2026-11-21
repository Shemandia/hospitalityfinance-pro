"use client";

import { Button } from "./ui/button";
import { lastPage, PAGE_SIZES } from "../lib/paging";

/** Rows per page, "21–40 of 312", and Previous / Next for a server-side page. */
export function TablePager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  busy = false
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** A page is loading: the buttons wait for it. */
  busy?: boolean;
}) {
  const last = lastPage(total, pageSize);
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            className="h-7 rounded border bg-white px-2 text-xs"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span aria-live="polite">
          {from}–{to} of {total}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={busy || page === 0}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {Math.min(page, last) + 1} of {last + 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => onPage(Math.min(last, page + 1))}
          disabled={busy || page >= last}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
