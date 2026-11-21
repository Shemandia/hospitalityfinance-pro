/**
 * The top-bar property switcher: the tree comes from the access context
 * (properties under their group, siblings in the context's order), search
 * keeps a match in its place in the tree, and a choice is remembered per
 * tenant and user.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccessContext, ContextEntity } from "../lib/access";
import { buildPropertyTree, filterPropertyTree, shortLabel } from "../lib/property-tree";
import { AuthProvider } from "../components/auth-provider";
import { EntityProvider, useEntity } from "../components/entity-provider";
import { PropertySwitcher } from "../components/property-switcher";

function entity(id: string, name: string, extra: Partial<ContextEntity> = {}): ContextEntity {
  return {
    id,
    code: id.toUpperCase(),
    name,
    type: "PROPERTY",
    parentId: null,
    functionalCurrency: "TZS",
    reportingCurrency: "USD",
    timezone: "Africa/Dar_es_Salaam",
    countryCode: "TZ",
    isActive: true,
    permissions: ["GL_READ"],
    ...extra
  };
}

// The context's order: higher levels first, then by name (modules/access/context.ts).
const GROUP_EAST = entity("ge", "East Coast Group", { type: "GROUP", functionalCurrency: "USD" });
const GROUP_NORTH = entity("gn", "Northern Circuit", { type: "GROUP", functionalCurrency: "USD" });
const ARUSHA = entity("aru", "Arusha Lodge", { parentId: "gn" });
const BEACH = entity("bch", "Beach Resort", { parentId: "ge", functionalCurrency: "KES" });
const CITY = entity("cty", "City Hotel", { parentId: "ge" });
const ORPHAN = entity("orp", "Ngorongoro Camp", { parentId: "not-visible" });
const ENTITIES = [GROUP_EAST, GROUP_NORTH, ARUSHA, BEACH, CITY, ORPHAN];

function contextFor(tenantId: string, userId: string): AccessContext {
  return {
    tenant: { id: tenantId, slug: tenantId, code: tenantId, name: `Tenant ${tenantId}` },
    user: { id: userId, email: `${userId}@test`, name: userId, mustChangePassword: false },
    tenantPermissions: [],
    setup: { isCompleted: true, currentStep: 7 },
    entities: ENTITIES
  };
}

const flat = (rows: ReturnType<typeof buildPropertyTree>) =>
  rows.map((r) => `${"  ".repeat(r.depth)}${r.entity.id}`);

describe("buildPropertyTree", () => {
  it("puts properties under their group, in the context's order", () => {
    expect(flat(buildPropertyTree(ENTITIES))).toEqual([
      "ge",
      "  bch",
      "  cty",
      "gn",
      "  aru",
      "orp"
    ]);
  });

  it("makes an entity whose parent the user cannot open a root", () => {
    const rows = buildPropertyTree([ARUSHA, CITY]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  it("does not loop on a parent cycle", () => {
    const a = entity("a", "A", { parentId: "b" });
    const b = entity("b", "B", { parentId: "a" });
    expect(flat(buildPropertyTree([a, b])).sort()).toEqual(["a", "b"]);
  });

  it("labels narrow screens with the code, the name when there is none", () => {
    expect(shortLabel(BEACH)).toBe("BCH");
    expect(shortLabel({ ...BEACH, code: null })).toBe("Beach Resort");
  });
});

describe("filterPropertyTree", () => {
  const tree = buildPropertyTree(ENTITIES);

  it("keeps a match under its group", () => {
    expect(flat(filterPropertyTree(tree, "city"))).toEqual(["ge", "  cty"]);
  });

  it("matches the code and the currency, ignoring case and spaces", () => {
    expect(flat(filterPropertyTree(tree, " aru "))).toEqual(["gn", "  aru"]);
    expect(flat(filterPropertyTree(tree, "kes"))).toEqual(["ge", "  bch"]);
  });

  it("returns everything for an empty query and nothing for no match", () => {
    expect(filterPropertyTree(tree, "  ")).toHaveLength(ENTITIES.length);
    expect(filterPropertyTree(tree, "zanzibar")).toEqual([]);
  });
});

// ── The component, inside the real providers ─────────────────────────────────

function Selected() {
  const { entityId } = useEntity();
  return <span data-testid="selected">{entityId ?? ""}</span>;
}

function renderSwitcher(context: AccessContext) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: context, errors: [] }), { status: 200 }))
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <EntityProvider>
          <PropertySwitcher />
          <Selected />
        </EntityProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

async function openSwitcher() {
  const button = await screen.findByRole("button", { name: /^Property:/ });
  await userEvent.click(button);
  return screen.getByRole("listbox", { name: "Properties" });
}

describe("PropertySwitcher", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the tree with indentation and each entity's currency", async () => {
    renderSwitcher(contextFor("t1", "u1"));
    const list = await openSwitcher();
    const options = within(list).getAllByRole("option");

    expect(options.map((o) => o.getAttribute("data-depth"))).toEqual([
      "0",
      "1",
      "1",
      "0",
      "1",
      "0"
    ]);
    expect(options[0]).toHaveTextContent("East Coast Group");
    expect(options[1]).toHaveTextContent("Beach Resort");
    expect(options[1]).toHaveTextContent("KES");
    expect(options[2]).toHaveTextContent("TZS");
  });

  it("shows the code on narrow screens and the name with its currency otherwise", async () => {
    localStorage.setItem("hfp:selected-entity:t1:u1", "bch");
    renderSwitcher(contextFor("t1", "u1"));
    const button = await screen.findByRole("button", { name: /^Property: Beach Resort/ });
    expect(within(button).getByText("BCH")).toHaveClass("sm:hidden");
    expect(within(button).getByText("Beach Resort")).toHaveClass("hidden", "sm:inline");
    expect(within(button).getByText("KES")).toBeInTheDocument();
  });

  it("filters as the user types and selects with the keyboard", async () => {
    renderSwitcher(contextFor("t1", "u1"));
    await openSwitcher();
    await userEvent.type(screen.getByRole("combobox", { name: "Search properties" }), "city");

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("East Coast Group"),
      expect.stringContaining("City Hotel")
    ]);

    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("selected")).toHaveTextContent("cty");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderSwitcher(contextFor("t1", "u1"));
    await openSwitcher();
    await userEvent.type(screen.getByRole("combobox"), "zanzibar");
    expect(screen.getByText("No property matches.")).toBeInTheDocument();
  });

  it("remembers the choice per tenant and user", async () => {
    const first = renderSwitcher(contextFor("t1", "u1"));
    const list = await openSwitcher();
    await userEvent.click(within(list).getByText("Arusha Lodge"));
    expect(screen.getByTestId("selected")).toHaveTextContent("aru");
    expect(localStorage.getItem("hfp:selected-entity:t1:u1")).toBe("aru");
    first.unmount();
    vi.unstubAllGlobals();

    // The same user in the same tenant comes back to it.
    const again = renderSwitcher(contextFor("t1", "u1"));
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("aru"));
    again.unmount();
    vi.unstubAllGlobals();

    // Another user of that tenant, and the same user in another tenant, do not.
    const otherUser = renderSwitcher(contextFor("t1", "u2"));
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("ge"));
    otherUser.unmount();
    vi.unstubAllGlobals();

    renderSwitcher(contextFor("t2", "u1"));
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("ge"));
    expect(localStorage.getItem("hfp:selected-entity:t1:u1")).toBe("aru");
  });

  it("does not open a list for a user with one property", async () => {
    renderSwitcher({ ...contextFor("t1", "u1"), entities: [CITY] });
    const button = await screen.findByRole("button", { name: "Property: City Hotel" });
    await userEvent.click(button);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
