/**
 * Pages on the global period: a dashboard shows the selected entity's
 * period for the chosen month, or the message (and asks for no figures)
 * when the entity has none; a report starts on the global period and can be
 * changed on the page without changing it.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const entity = vi.hoisted(() => ({ id: "prop", name: "City Hotel" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ code: "demo0001" }),
  usePathname: () => window.location.pathname
}));
vi.mock("../hooks/use-tenant-router", () => ({
  useTenantRouter: () => ({ push: vi.fn() }),
  useTenantHref: () => (p: string) => p,
  useTenantSlugSafe: () => "demo"
}));
vi.mock("../components/auth-provider", () => ({
  useAuth: () => ({ context: { tenant: { id: "t1" }, user: { id: "u1" } } })
}));
vi.mock("../components/entity-provider", () => ({
  useEntity: () => ({ currentEntity: { id: entity.id, name: entity.name }, entityId: entity.id })
}));
vi.mock("../components/use-api-context", () => ({
  useApiContext: () => ({ accessToken: "cookie", entityId: entity.id, tenantSlug: "demo" })
}));

import { PeriodProvider, useReportPeriodId } from "../components/period-provider";
import GMDashboardPage from "../app/t/[code]/(dashboard)/dashboard/gm/page";

const PERIODS = [
  { id: "p-11", year: 2026, month: 11, name: "Nov 2026", status: "OPEN" },
  { id: "p-09", year: 2026, month: 9, name: "Sep 2026", status: "CLOSED" }
];

let requested: string[] = [];

beforeEach(() => {
  requested = [];
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(String(url));
      if (String(url).startsWith("/api/v1/periods")) return Response.json({ data: PERIODS });
      return Response.json({ data: null });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function withPeriod(ui: React.ReactNode, search: string) {
  window.history.replaceState(null, "", `/t/demo0001/x${search}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PeriodProvider>{ui}</PeriodProvider>
    </QueryClientProvider>
  );
}

describe("a dashboard on the global period", () => {
  it("asks for the figures of the entity's period for the chosen month", async () => {
    withPeriod(<GMDashboardPage />, "?period=2026-09");
    await waitFor(() => expect(requested.some((u) => u.includes("p-09"))).toBe(true));
    expect(requested.some((u) => u.includes("p-11"))).toBe(false);
    expect(await screen.findByText("September 2026")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("shows the message, and asks for no figures, when the entity has no such period", async () => {
    withPeriod(<GMDashboardPage />, "?period=2026-10");
    expect(
      await screen.findByText("City Hotel has no period for October 2026")
    ).toBeInTheDocument();
    expect(requested.filter((u) => !u.startsWith("/api/v1/periods"))).toEqual([]);
  });
});

function ReportProbe() {
  const { periodId, setPeriodId, followsGlobal } = useReportPeriodId("NONE");
  return (
    <div>
      <span data-testid="report-period">{periodId}</span>
      <span data-testid="follows">{String(followsGlobal)}</span>
      <button onClick={() => setPeriodId("p-09")}>choose September here</button>
    </div>
  );
}

describe("a report with its own picker", () => {
  it("starts on the global period and can be changed on the page only", async () => {
    withPeriod(<ReportProbe />, "?period=2026-11");
    await waitFor(() => expect(screen.getByTestId("report-period")).toHaveTextContent("p-11"));
    act(() => screen.getByText("choose September here").click());
    expect(screen.getByTestId("report-period")).toHaveTextContent("p-09");
    expect(screen.getByTestId("follows")).toHaveTextContent("false");
    expect(window.location.search).toBe("?period=2026-11");
  });

  it("has no period when the entity has none for the global month", async () => {
    withPeriod(<ReportProbe />, "?period=2026-10");
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByTestId("report-period")).toHaveTextContent("NONE"));
  });
});
