/** A run's records show their document and the journal it posted. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useParams: () => ({ executionId: "x1", code: "demo0001" }) }));
vi.mock("../hooks/use-tenant-router", () => ({
  useTenantHref: () => (p: string) => `/t/demo0001${p}`
}));
vi.mock("../components/use-api-context", () => ({
  useApiContext: () => ({ accessToken: "cookie", entityId: "e1", tenantSlug: "demo" })
}));
vi.mock("../components/use-permissions", () => ({
  usePermissions: () => ({
    canIntegrationUser: true,
    canIntegrationPowerUser: true,
    canIntegrationAdmin: true
  })
}));
vi.mock("../lib/gl-api", async (original) => ({
  ...(await original<object>()),
  getIntegrationExecution: vi.fn(async () => ({
    data: {
      id: "x1",
      profileId: "p1",
      automationId: null,
      status: "COMPLETED",
      jobId: null,
      triggeredBy: null,
      recordsTotal: 3,
      recordsSucceeded: 2,
      recordsFailed: 1,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-04-14T00:00:00Z",
      profile: { id: "p1", name: "Night audit", profileType: "IMPORT" }
    },
    errors: []
  })),
  getIntegrationExecutionLogs: vi.fn(async () => ({
    data: {
      rows: [
        {
          id: "l1",
          executionId: "x1",
          recordIndex: 0,
          status: "SUCCESS",
          sourceData: null,
          transformedData: null,
          errorCode: null,
          errorMessage: null,
          documentRef: "EZZ-2026-04-14",
          journalId: "j-1"
        },
        {
          id: "l2",
          executionId: "x1",
          recordIndex: 1,
          status: "FAILED",
          sourceData: null,
          transformedData: null,
          errorCode: "UNMAPPED_CODE",
          errorMessage: 'Revenue codes has no entry for "SPA"',
          documentRef: "EZZ-2026-04-15",
          journalId: null
        }
      ],
      total: 2,
      take: 100,
      skip: 0
    },
    errors: []
  }))
}));

import ExecutionPage from "../app/t/[code]/(dashboard)/integrations/history/[executionId]/page";

describe("run history", () => {
  it("shows each record's document, the journal it posted, or why not", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ExecutionPage />
      </QueryClientProvider>
    );
    expect(await screen.findByText("EZZ-2026-04-14")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      "/t/demo0001/gl/journals/j-1"
    );
    expect(screen.getByText("EZZ-2026-04-15")).toBeTruthy();
    expect(screen.getByText("UNMAPPED_CODE")).toBeTruthy();
  });
});
