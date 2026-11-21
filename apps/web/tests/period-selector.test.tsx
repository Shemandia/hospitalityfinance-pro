/**
 * The global period: a month in the address and per tenant and user,
 * resolved to the selected entity's own period (a group to its own
 * calendar), with a clear message when the entity has no period for it.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  defaultMonth,
  monthLabel,
  parseMonth,
  parsePeriodSelection,
  resolvePeriod,
  selectedPeriodStorageKey,
  withPeriodParam,
  type EntityPeriod
} from "../lib/period";

// ── Pure logic ───────────────────────────────────────────────────────────────

const p = (year: number, month: number, status: EntityPeriod["status"]): EntityPeriod => ({
  id: `${year}-${month}`,
  year,
  month,
  name: `${year}-${month}`,
  status
});

describe("lib/period", () => {
  it("reads a month from the address and ignores anything else", () => {
    expect(parseMonth("2026-10")).toBe("2026-10");
    for (const bad of ["2026-13", "2026-1", "26-10", "2026-10-01", "", null]) {
      expect(parseMonth(bad)).toBeNull();
    }
    expect(parsePeriodSelection(new URLSearchParams("period=2026-03&x=1"))).toEqual({
      kind: "month",
      month: "2026-03"
    });
    expect(parsePeriodSelection(new URLSearchParams("from=2026-01&to=2026-03"))).toBeNull();
  });

  it("writes the month into the address and keeps the other parameters", () => {
    expect(withPeriodParam("?status=POSTED&period=2026-01", "2026-10")).toBe(
      "status=POSTED&period=2026-10"
    );
  });

  it("labels a month", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2026-10", "short")).toBe("Oct 2026");
  });

  it("resolves a month to the entity's own period, or to none", () => {
    const periods = [p(2026, 10, "OPEN"), p(2026, 9, "CLOSED")];
    expect(resolvePeriod(periods, "2026-09")?.id).toBe("2026-9");
    expect(resolvePeriod(periods, "2026-08")).toBeNull();
  });

  it("starts on this month when open, else the latest open, else the latest period", () => {
    const today = new Date(2026, 10, 21); // November 2026
    expect(defaultMonth([p(2026, 11, "OPEN"), p(2026, 12, "OPEN")], today)).toBe("2026-11");
    expect(
      defaultMonth([p(2026, 9, "OPEN"), p(2026, 10, "OPEN"), p(2026, 11, "LOCKED")], today)
    ).toBe("2026-10");
    expect(defaultMonth([p(2026, 8, "CLOSED"), p(2026, 9, "LOCKED")], today)).toBe("2026-09");
    expect(defaultMonth([], today)).toBeNull();
  });

  it("remembers per tenant and user", () => {
    expect(selectedPeriodStorageKey("t1", "u1")).not.toBe(selectedPeriodStorageKey("t1", "u2"));
    expect(selectedPeriodStorageKey("t1", "u1")).not.toBe(selectedPeriodStorageKey("t2", "u1"));
  });
});

// ── Provider, selector and gate ──────────────────────────────────────────────

const auth = vi.hoisted(() => ({ tenantId: "t1", userId: "u1" }));
const entity = vi.hoisted(() => ({ id: "prop", name: "City Hotel" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search)
}));
vi.mock("../components/auth-provider", () => ({
  useAuth: () => ({
    context: { tenant: { id: auth.tenantId }, user: { id: auth.userId } }
  })
}));
vi.mock("../components/entity-provider", () => ({
  useEntity: () => ({ currentEntity: { id: entity.id, name: entity.name }, entityId: entity.id })
}));
vi.mock("../components/use-api-context", () => ({
  useApiContext: () => ({ accessToken: "cookie", entityId: entity.id, tenantSlug: "demo" })
}));

import { PeriodProvider } from "../components/period-provider";
import { PeriodSelector } from "../components/period-selector";
import { PeriodGate } from "../components/period-gate";

// Each entity's own calendar: the group has October locked; the property has no October.
const CALENDARS: Record<string, EntityPeriod[]> = {
  prop: [p(2026, 11, "OPEN"), p(2026, 9, "CLOSED"), p(2026, 8, "SOFT_CLOSE")],
  group: [p(2026, 11, "OPEN"), p(2026, 10, "LOCKED")]
};

function stubPeriods() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const id = (init?.headers as Record<string, string>)["X-Entity-ID"]!;
      const data = (CALENDARS[id] ?? []).map((x) => ({ ...x, id: `${id}-${x.id}` }));
      return Response.json({ data, errors: [] });
    })
  );
}

function renderPeriod() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PeriodProvider>
        <PeriodSelector />
        <PeriodGate loading={<p>loading</p>}>
          {(period) => <p data-testid="page">figures for {period.id}</p>}
        </PeriodGate>
      </PeriodProvider>
    </QueryClientProvider>
  );
}

function setAddress(search: string) {
  window.history.replaceState(null, "", `/t/demo0001/dashboard${search}`);
}

describe("global period", () => {
  beforeEach(() => {
    localStorage.clear();
    auth.tenantId = "t1";
    auth.userId = "u1";
    entity.id = "prop";
    entity.name = "City Hotel";
    setAddress("");
    stubPeriods();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 21) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts on the entity's current open month and puts it in the address and storage", async () => {
    renderPeriod();
    expect(await screen.findByTestId("page")).toHaveTextContent("figures for prop-2026-11");
    const button = screen.getByRole("button", { name: /^Period: November 2026, Open/ });
    expect(within(button).getByText("Nov 2026")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe("?period=2026-11"));
    expect(localStorage.getItem("hfp:selected-period:t1:u1")).toBe("2026-11");
  });

  it("follows a month in the address, shows its status, and remembers it", async () => {
    setAddress("?period=2026-08&tab=x");
    renderPeriod();
    expect(await screen.findByTestId("page")).toHaveTextContent("prop-2026-8");
    expect(
      screen.getByRole("button", { name: /^Period: August 2026, Soft close/ })
    ).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("hfp:selected-period:t1:u1")).toBe("2026-08"));
    expect(window.location.search).toBe("?period=2026-08&tab=x");
  });

  it("uses the month remembered for this tenant and user, not another's", async () => {
    localStorage.setItem("hfp:selected-period:t1:u1", "2026-09");
    localStorage.setItem("hfp:selected-period:t1:u2", "2026-08");
    renderPeriod();
    expect(await screen.findByTestId("page")).toHaveTextContent("prop-2026-9");
    expect(screen.getByRole("button", { name: /Closed/ })).toBeInTheDocument();
  });

  it("says so when the entity has no period for the month, and shows nothing else", async () => {
    setAddress("?period=2026-10");
    renderPeriod();
    expect(
      await screen.findByText("City Hotel has no period for October 2026")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("page")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /October 2026, no period/ })).toBeInTheDocument();
  });

  it("resolves a group to its own calendar", async () => {
    entity.id = "group";
    entity.name = "East Coast Group";
    setAddress("?period=2026-10");
    renderPeriod();
    expect(await screen.findByTestId("page")).toHaveTextContent("group-2026-10");
    expect(screen.getByRole("button", { name: /October 2026, Locked/ })).toBeInTheDocument();
  });

  it("chooses another of the entity's periods from the list", async () => {
    vi.useRealTimers();
    setAddress("?period=2026-11");
    renderPeriod();
    await screen.findByTestId("page");
    await userEvent.click(screen.getByRole("button", { name: /^Period:/ }));
    const list = screen.getByRole("listbox", { name: "Periods" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("November 2026"),
      expect.stringContaining("September 2026"),
      expect.stringContaining("August 2026")
    ]);
    await userEvent.click(within(list).getByText("September 2026"));
    await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("prop-2026-9"));
    expect(window.location.search).toBe("?period=2026-09");
    expect(localStorage.getItem("hfp:selected-period:t1:u1")).toBe("2026-09");
  });
});
