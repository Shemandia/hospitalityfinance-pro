/**
 * The setup wizard of a fresh tenant offers what the API serves (no lists in
 * the web app): the 12 USALI departments, all pre-selected; the tenant's real
 * roles; the full currency list. The template response is the API's own
 * setupTemplates(), so the test checks the data the API really sends.
 *
 * A tenant in setup has no entity yet; the wizard's requests must not need one.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupTemplates } from "../../api/src/modules/setup/templates";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ code: "ab12cd34" })
}));
vi.mock("../components/auth-provider", () => ({
  useAuth: () => ({ reloadContext: vi.fn() }),
  useSession: () => ({
    data: { accessToken: "cookie", user: { tenantSlug: "acme" } },
    status: "authenticated"
  })
}));

import SetupPage from "../app/t/[code]/(setup)/setup/page";

const ROLES = [
  { id: "r1", code: "ADMIN", name: "Administrator", isSystem: false },
  { id: "r2", code: "CONTROLLER", name: "Controller", isSystem: false },
  { id: "r3", code: "NIGHT_AUDITOR", name: "Night Auditor", isSystem: false },
  { id: "r4", code: "TENANT_ADMIN", name: "Tenant Administrator", isSystem: true },
  { id: "r5", code: "VIEWER", name: "Viewer", isSystem: false }
];

const requested: Array<{ url: string; headers: Record<string, string> }> = [];

/** A fresh tenant at `step`: nothing saved yet. */
function serve(step: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requested.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url === "/api/v1/setup/progress") {
        return Response.json({
          data: { isCompleted: false, currentStep: step, completedSteps: [], stepData: {} }
        });
      }
      if (url === "/api/v1/setup/templates") return Response.json({ data: setupTemplates() });
      if (url === "/api/v1/admin/roles") return Response.json({ data: ROLES });
      return Response.json({ data: null, errors: [{ code: "NOT_FOUND" }] }, { status: 404 });
    })
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SetupPage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  requested.length = 0;
  vi.unstubAllGlobals();
});

describe("setup wizard of a fresh tenant", () => {
  it("pre-selects the 12 USALI departments the API serves", async () => {
    serve(2);
    await waitFor(() => expect(screen.getByText("Rooms")).toBeInTheDocument());
    const boxes = screen
      .getAllByRole("checkbox")
      .filter((b) => b.closest("label")?.querySelector(".font-mono"));
    expect(boxes).toHaveLength(12);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    for (const name of ["Rooms", "Food & Beverage", "Admin & General", "Non-Operating"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText(/No departments available/)).not.toBeInTheDocument();
  });

  it("offers the tenant's real roles, defaulting to one that is not the administrator's", async () => {
    serve(6);
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Night Auditor" })).toBeInTheDocument()
    );
    const select = screen.getByRole("option", { name: "Night Auditor" }).closest("select")!;
    const options = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(ROLES.map((r) => r.code));
    expect((select as HTMLSelectElement).value).toBe("ADMIN");
  });

  it("offers the full currency list", async () => {
    serve(1);
    const codes = setupTemplates().currencies.map((c) => c.code);
    expect(codes).toHaveLength(33);
    // Step 1 has ~1,100 options (countries, timezones): query the DOM directly.
    const currencySelects = () =>
      [...document.querySelectorAll("select")].filter((s) =>
        [...s.options].some((o) => o.value === "JOD")
      );
    // Rendering ~1,100 options is slow when every test file runs at once.
    await waitFor(() => expect(currencySelects().length).toBeGreaterThan(0), { timeout: 10_000 });
    for (const select of currencySelects()) {
      expect([...select.options].map((o) => o.value)).toEqual(codes);
    }
  }, 20_000);

  it("asks for roles and templates without an entity (a tenant in setup has none)", async () => {
    serve(6);
    await waitFor(() => expect(requested.some((r) => r.url === "/api/v1/admin/roles")).toBe(true));
    for (const r of requested.filter((r) => r.url !== "/api/v1/setup/progress")) {
      expect(r.headers).not.toHaveProperty("X-Entity-ID");
    }
    expect(requested.some((r) => r.url === "/api/v1/setup/templates")).toBe(true);
  });
});
