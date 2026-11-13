/**
 * Roles & Access (WP-A step 10): grant a role at tenant, group or property
 * level, and show the user's effective permissions per property.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiContext = {
  tenantSlug: "demo",
  tenantCode: "ab12cd34",
  entityId: "prop-a",
  accessToken: "cookie"
};
vi.mock("../components/use-api-context", () => ({ useApiContext: () => apiContext }));

const perms = vi.hoisted(() => ({ tenantWide: false }));
vi.mock("../components/use-permissions", () => ({
  usePermissions: () => ({
    can: (_code: string, scope?: string) => (scope === "tenant" ? perms.tenantWide : true)
  })
}));

const api = vi.hoisted(() => ({
  assignUserRole: vi.fn(),
  revokeUserRole: vi.fn(),
  getUserAccess: vi.fn()
}));
vi.mock("../lib/gl-api", () => ({
  getEntityTree: async () => ({
    data: {
      flat: [
        {
          id: "group",
          name: "Demo Group",
          code: "HFP",
          type: "GROUP",
          parentId: null,
          isActive: true
        },
        {
          id: "prop-a",
          name: "Jumeirah",
          code: "JUM",
          type: "PROPERTY",
          parentId: "group",
          isActive: true
        },
        {
          id: "prop-b",
          name: "Doha",
          code: "DOH",
          type: "PROPERTY",
          parentId: "group",
          isActive: true
        }
      ],
      tree: []
    }
  }),
  getAdminEntityUsers: async () => ({
    data: [
      {
        userId: "u1",
        user: { id: "u1", name: "Carla Controller", email: "carla@hfp.test", isActive: true },
        createdAt: "2026-11-01T00:00:00Z",
        roles: [
          {
            roleId: "r-ctl",
            code: "CONTROLLER",
            name: "Controller",
            scopeType: "ENTITY",
            entityId: "prop-a"
          }
        ]
      }
    ]
  }),
  getAdminRoles: async () => ({
    data: [
      { id: "r-ctl", code: "CONTROLLER", name: "Controller" },
      { id: "r-view", code: "VIEWER", name: "Viewer" }
    ]
  }),
  getUserAccess: api.getUserAccess,
  assignUserRole: api.assignUserRole,
  revokeUserRole: api.revokeUserRole
}));

import RolesAndAccessPage from "../app/t/[code]/(dashboard)/settings/user-assignments/page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RolesAndAccessPage />
    </QueryClientProvider>
  );
}

describe("Roles & Access", () => {
  beforeEach(() => {
    perms.tenantWide = false;
    api.assignUserRole.mockReset().mockResolvedValue({ data: {} });
    api.revokeUserRole.mockReset().mockResolvedValue({ data: null });
    api.getUserAccess.mockReset().mockResolvedValue({
      data: {
        assignments: [
          {
            roleId: "r-ctl",
            roleCode: "CONTROLLER",
            roleName: "Controller",
            scopeType: "ENTITY",
            entity: { id: "prop-a", name: "Jumeirah", code: "JUM", type: "PROPERTY" }
          }
        ],
        tenantPermissions: [],
        effective: [
          {
            entity: {
              id: "prop-a",
              name: "Jumeirah",
              code: "JUM",
              type: "PROPERTY",
              parentId: "group"
            },
            permissions: ["GL_POST", "GL_READ"]
          }
        ]
      }
    });
  });

  it("shows the user's roles and effective permissions per property", async () => {
    renderPage();
    await userEvent.click(await screen.findByText("Carla Controller"));

    expect(await screen.findByRole("button", { name: "Revoke Controller" })).toBeInTheDocument();
    expect(screen.getByText("2 permissions")).toBeInTheDocument();
    expect(screen.getByText("GL_POST")).toBeInTheDocument();
    expect(api.getUserAccess).toHaveBeenCalledWith(apiContext, "u1");
  });

  it("grants a role on a group, which the API applies to every property under it", async () => {
    renderPage();
    await userEvent.click(await screen.findByText("Carla Controller"));
    await userEvent.click(await screen.findByRole("button", { name: /grant role/i }));

    await userEvent.selectOptions(screen.getByLabelText("Role"), "r-view");
    await userEvent.selectOptions(screen.getByLabelText("Where"), "group");
    await userEvent.click(screen.getByRole("button", { name: "Grant" }));

    await waitFor(() =>
      expect(api.assignUserRole).toHaveBeenCalledWith(apiContext, "u1", {
        roleId: "r-view",
        entityId: "group"
      })
    );
  });

  it("offers the whole tenant only to someone who administers users tenant-wide", async () => {
    renderPage();
    await userEvent.click(await screen.findByText("Carla Controller"));
    await userEvent.click(await screen.findByRole("button", { name: /grant role/i }));
    expect(screen.queryByRole("option", { name: "Whole tenant" })).not.toBeInTheDocument();
  });

  it("grants tenant-wide when chosen", async () => {
    perms.tenantWide = true;
    renderPage();
    await userEvent.click(await screen.findByText("Carla Controller"));
    await userEvent.click(await screen.findByRole("button", { name: /grant role/i }));

    await userEvent.selectOptions(screen.getByLabelText("Role"), "r-view");
    await userEvent.selectOptions(screen.getByLabelText("Where"), "Whole tenant");
    await userEvent.click(screen.getByRole("button", { name: "Grant" }));

    await waitFor(() =>
      expect(api.assignUserRole).toHaveBeenCalledWith(apiContext, "u1", {
        roleId: "r-view",
        scope: "TENANT"
      })
    );
  });

  it("revokes one grant at its property", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await userEvent.click(await screen.findByText("Carla Controller"));
    await userEvent.click(await screen.findByRole("button", { name: "Revoke Controller" }));

    await waitFor(() =>
      expect(api.revokeUserRole).toHaveBeenCalledWith(apiContext, "u1", "r-ctl", "prop-a")
    );
  });
});
