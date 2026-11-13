/**
 * The dashboard is not drawn until the setup state is known (WP-A step 8).
 * An unconfigured tenant goes straight to the wizard; nothing of the
 * dashboard appears first.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useParams: () => ({ code: "ab12cd34" })
}));

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../components/auth-provider", () => ({ useAuth: () => auth.value }));

import { SetupGuard } from "../components/setup-guard";

function context(isCompleted: boolean, currentStep = 3) {
  return {
    tenant: { id: "t", slug: "s", code: "ab12cd34", name: "T" },
    user: { id: "u", email: "e", name: "n", mustChangePassword: false },
    tenantPermissions: [],
    setup: { isCompleted, currentStep },
    entities: []
  };
}

function renderGuard(value: Record<string, unknown>) {
  auth.value = { reloadContext: vi.fn(), error: undefined, ...value };
  return render(
    <SetupGuard>
      <p>Dashboard</p>
    </SetupGuard>
  );
}

describe("SetupGuard", () => {
  afterEach(() => replace.mockReset());

  it("shows nothing of the dashboard while the context loads", () => {
    renderGuard({ status: "loading", context: null });
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an unconfigured tenant to the wizard without drawing the dashboard", async () => {
    renderGuard({ status: "authenticated", context: context(false, 3) });
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/t/ab12cd34/setup?step=3"));
  });

  it("draws the dashboard for a configured tenant", () => {
    renderGuard({ status: "authenticated", context: context(true) });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a signed-out user to sign in", async () => {
    renderGuard({ status: "unauthenticated", context: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/t/ab12cd34/login"));
  });

  it("offers a retry, not the dashboard, when the context is unavailable", () => {
    renderGuard({ status: "unavailable", context: null, error: "Server busy (503)." });
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("Server busy (503).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
