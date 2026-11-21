/**
 * Leaving the setup wizard for the dashboard reloads the access context first.
 * The dashboard's guard decides from that context; left at "setup not
 * finished" from sign-in, it sent the user back to the wizard, which sent
 * them to the dashboard again, in a loop.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: string[] = [];
const replace = vi.fn((url: string) => void calls.push(`replace ${url}`));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useParams: () => ({ code: "ab12cd34" })
}));

const reloadContext = vi.fn(async () => void calls.push("reloadContext"));
vi.mock("../components/auth-provider", () => ({
  useAuth: () => ({ reloadContext }),
  useSession: () => ({ data: { accessToken: "cookie", user: {} }, status: "authenticated" })
}));

import SetupPage from "../app/t/[code]/(setup)/setup/page";

afterEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("setup wizard, setup already finished", () => {
  it("reloads the access context, then opens the dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            isCompleted: true,
            currentStep: 7,
            completedSteps: [1, 2, 3, 4, 5, 6],
            stepData: {}
          }
        })
      )
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SetupPage />
      </QueryClientProvider>
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/t/ab12cd34/dashboard"));
    expect(calls).toEqual(["reloadContext", "replace /t/ab12cd34/dashboard"]);
  });
});
