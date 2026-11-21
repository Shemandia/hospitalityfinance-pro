/**
 * Server-side table pages: the table asks the API for one page (limit and
 * offset), shows the API's total, and sends its filters to the API so they
 * cover every row, not the rows loaded.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchAllRows, lastPage, pageFrom } from "../lib/paging";
import { TablePager } from "../components/table-pager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ code: "demo0001" }),
  usePathname: () => "/t/demo0001/ap/suppliers"
}));
vi.mock("../hooks/use-tenant-router", () => ({
  useTenantRouter: () => ({ push: vi.fn() }),
  useTenantHref: () => (p: string) => p,
  useTenantSlugSafe: () => "demo"
}));
vi.mock("../components/use-api-context", () => ({
  useApiContext: () => ({ accessToken: "cookie", entityId: "prop-1", tenantSlug: "demo" })
}));

import SuppliersPage from "../app/t/[code]/(dashboard)/ap/suppliers/page";

describe("paging helpers", () => {
  it("read rows and total from a list response", () => {
    expect(pageFrom({ data: [1, 2], meta: { total: 40 } })).toEqual({ rows: [1, 2], total: 40 });
    expect(pageFrom({ data: [1, 2] })).toEqual({ rows: [1, 2], total: 2 });
    expect(pageFrom({ data: null })).toEqual({ rows: [], total: 0 });
  });

  it("fetch every row page by page for an export", async () => {
    const all = Array.from({ length: 450 }, (_, i) => i);
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllRows(async (offset, limit) => {
      calls.push([offset, limit]);
      return { rows: all.slice(offset, offset + limit), total: all.length };
    }, 200);
    expect(rows).toEqual(all);
    expect(calls).toEqual([
      [0, 200],
      [200, 200],
      [400, 200]
    ]);
  });

  it("read on past a page the server capped below the limit", async () => {
    const all = Array.from({ length: 250 }, (_, i) => i);
    const calls: number[] = [];
    const rows = await fetchAllRows(async (offset, limit) => {
      calls.push(offset);
      const capped = Math.min(limit, 100); // PAGE_SIZE_MAX of 100
      return { rows: all.slice(offset, offset + capped), total: all.length };
    }, 200);
    expect(rows).toEqual(all);
    expect(calls).toEqual([0, 100, 200]);
  });

  it("know the last page", () => {
    expect(lastPage(0, 20)).toBe(0);
    expect(lastPage(20, 20)).toBe(0);
    expect(lastPage(21, 20)).toBe(1);
  });
});

describe("TablePager", () => {
  it("shows the server's total and moves between pages", async () => {
    const onPage = vi.fn();
    render(<TablePager page={1} pageSize={20} total={45} onPage={onPage} onPageSize={vi.fn()} />);
    expect(screen.getByText("21–40 of 45")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("stops at the last page", () => {
    render(<TablePager page={2} pageSize={20} total={45} onPage={vi.fn()} onPageSize={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

describe("Suppliers page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the API for one page, filtered there, and shows the API's totals", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        requested.push(url);
        const limit = Number(url.searchParams.get("limit") ?? 0);
        const total = url.searchParams.get("search") ? 3 : limit === 1 ? 57 : 41;
        const rows = Array.from({ length: Math.min(limit || total, 3) }, (_, i) => ({
          id: `s-${url.searchParams.get("offset") ?? 0}-${i}`,
          code: `S${i}`,
          name: `Supplier ${i}`,
          currency: "TZS",
          isActive: true
        }));
        return Response.json({ data: rows, meta: { total, limit, offset: 0 }, errors: [] });
      })
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SuppliersPage />
      </QueryClientProvider>
    );

    await screen.findByText("57 suppliers registered");
    expect(await screen.findByText("1–20 of 41")).toBeInTheDocument();
    const pageRequest = requested.find((u) => u.searchParams.get("limit") === "20")!;
    expect(pageRequest.pathname).toBe("/api/v1/ap/suppliers");
    expect(pageRequest.searchParams.get("status")).toBe("active");
    expect(pageRequest.searchParams.get("offset")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(requested.some((u) => u.searchParams.get("offset") === "20")).toBe(true)
    );

    await userEvent.type(screen.getByPlaceholderText("Search by name or code…"), "lodge");
    await waitFor(() =>
      expect(requested.some((u) => u.searchParams.get("search") === "lodge")).toBe(true)
    );
    const searched = requested.find((u) => u.searchParams.get("search") === "lodge")!;
    // A new search starts again at the first page.
    expect(searched.searchParams.get("offset")).toBeNull();
    expect(await screen.findByText("1–3 of 3")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Show inactive"));
    await waitFor(() =>
      expect(
        requested.some(
          (u) => u.searchParams.get("search") === "lodge" && !u.searchParams.has("status")
        )
      ).toBe(true)
    );
  });
});
