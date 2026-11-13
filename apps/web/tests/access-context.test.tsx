/**
 * The web side of WP-A step 6: access decisions come from the context
 * endpoint only, the property list is the context's, the selection is kept
 * per tenant and user (AUT-08), and a server fault is not a sign-out (AUT-10).
 *
 * That these decisions equal the API's is proven against the real guard in
 * apps/api/tests/integration/menus-match-api.test.ts.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  allows,
  allowsAnywhere,
  allowsAt,
  allowsTenantWide,
  pickEntity,
  selectedEntityStorageKey,
  type AccessContext,
  type ContextEntity
} from "../lib/access";
import { AuthProvider, useAuth } from "../components/auth-provider";
import { EntityProvider, useEntity } from "../components/entity-provider";
import { usePermissions } from "../components/use-permissions";

function entity(id: string, permissions: string[], extra: Partial<ContextEntity> = {}) {
  return {
    id,
    code: id.toUpperCase(),
    name: `Entity ${id}`,
    type: "PROPERTY",
    parentId: null,
    functionalCurrency: "USD",
    reportingCurrency: "USD",
    timezone: "UTC",
    countryCode: "TZ",
    isActive: true,
    permissions,
    ...extra
  } satisfies ContextEntity;
}

function contextFor(
  tenantId: string,
  entities: ContextEntity[],
  tenantPermissions: string[] = []
): AccessContext {
  return {
    tenant: { id: tenantId, slug: `slug-${tenantId}`, code: `code-${tenantId}`, name: tenantId },
    user: { id: "user-1", email: "u@test", name: "U", mustChangePassword: false },
    tenantPermissions,
    entities
  };
}

const CONTEXT = contextFor("t1", [entity("a", ["GL_POST", "GL_READ"]), entity("b", ["GL_READ"])]);

describe("lib/access", () => {
  it("allows at an entity only what is held there", () => {
    expect(allowsAt(CONTEXT, "a", "GL_POST")).toBe(true);
    expect(allowsAt(CONTEXT, "b", "GL_POST")).toBe(false);
    expect(allowsAt(CONTEXT, "c", "GL_READ")).toBe(false);
    expect(allowsAt(CONTEXT, null, "GL_READ")).toBe(false);
    expect(allowsAt(null, "a", "GL_READ")).toBe(false);
  });

  it("accepts any of several codes and normalises them like the API", () => {
    expect(allowsAt(CONTEXT, "b", ["GL_POST", " gl_read "])).toBe(true);
  });

  it("allows tenant-wide only what a tenant-wide assignment holds", () => {
    expect(allowsTenantWide(CONTEXT, "GL_READ")).toBe(false);
    expect(
      allowsTenantWide(contextFor("t1", [], ["ADMIN_ROLES_MANAGE"]), "ADMIN_ROLES_MANAGE")
    ).toBe(true);
  });

  it("allows anywhere what is held tenant-wide or at one entity", () => {
    expect(allowsAnywhere(CONTEXT, "GL_POST")).toBe(true);
    expect(allowsAnywhere(CONTEXT, "ADMIN_USERS")).toBe(false);
    expect(allows(CONTEXT, "any-entity", "GL_POST", null)).toBe(true);
    expect(allows(CONTEXT, "entity", "GL_POST", "b")).toBe(false);
  });

  it("keeps the selection per tenant and user", () => {
    expect(selectedEntityStorageKey(CONTEXT)).toBe("hfp:selected-entity:t1:user-1");
    expect(selectedEntityStorageKey(contextFor("t2", []))).not.toBe(
      selectedEntityStorageKey(CONTEXT)
    );
  });

  it("picks the remembered entity only while the user can still open it", () => {
    expect(pickEntity(CONTEXT, "b")?.id).toBe("b");
    expect(pickEntity(CONTEXT, "gone")?.id).toBe("a");
    expect(pickEntity(contextFor("t1", []), "a")).toBeNull();
  });
});

// ── Providers ────────────────────────────────────────────────────────────────

function Probe() {
  const { status, error } = useAuth();
  const { entities, entityId } = useEntity();
  const { can } = usePermissions();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="entities">{entities.map((e) => e.id).join(",")}</span>
      <span data-testid="entity">{entityId ?? ""}</span>
      <span data-testid="can-post">{String(can("GL_POST"))}</span>
    </div>
  );
}

function renderProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <EntityProvider>
          <Probe />
        </EntityProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}

describe("AuthProvider and EntityProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("draw the property list and the buttons from the context", async () => {
    respondWith(200, { data: CONTEXT, errors: [] });
    renderProviders();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("entities")).toHaveTextContent("a,b");
    expect(screen.getByTestId("entity")).toHaveTextContent("a");
    expect(screen.getByTestId("can-post")).toHaveTextContent("true");
  });

  it("restore the selection of this tenant and user, not another tenant's", async () => {
    localStorage.setItem("hfp:selected-entity:t1:user-1", "b");
    localStorage.setItem("hfp:selected-entity:t2:user-1", "a");
    respondWith(200, { data: CONTEXT, errors: [] });
    renderProviders();
    await waitFor(() => expect(screen.getByTestId("entity")).toHaveTextContent("b"));
    // GL_POST is held on A, not on B: the button follows the selected property.
    expect(screen.getByTestId("can-post")).toHaveTextContent("false");
  });

  it("ignore a remembered entity the user can no longer open", async () => {
    localStorage.setItem("hfp:selected-entity:t1:user-1", "revoked");
    respondWith(200, { data: CONTEXT, errors: [] });
    renderProviders();
    await waitFor(() => expect(screen.getByTestId("entity")).toHaveTextContent("a"));
    await act(async () => {});
    expect(localStorage.getItem("hfp:selected-entity:t1:user-1")).toBe("a");
  });

  it("treat a 503 as unavailable, not as signed out", async () => {
    respondWith(503, { data: null, errors: [{ code: "SERVICE_UNAVAILABLE" }] });
    renderProviders();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unavailable"));
    expect(screen.getByTestId("error")).toHaveTextContent("503");
  });

  it("treat a 401 as signed out", async () => {
    respondWith(401, { data: null, errors: [{ code: "AUTHENTICATION_FAILED" }] });
    renderProviders();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it("tell a user with nothing to open that access is not configured", async () => {
    respondWith(200, { data: contextFor("t1", []), errors: [] });
    renderProviders();
    await waitFor(() =>
      expect(screen.getByText("Entity access is not configured")).toBeInTheDocument()
    );
  });

  it("let a tenant-wide administrator of an empty tenant through to set it up", async () => {
    respondWith(200, { data: contextFor("t1", [], ["ADMIN_SETTINGS"]), errors: [] });
    renderProviders();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.queryByText("Entity access is not configured")).not.toBeInTheDocument();
  });
});
