/**
 * The Integrations screens for ledger imports: Sources, and the profile's
 * posting settings.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const perms = vi.hoisted(() => ({ admin: true }));
vi.mock("../components/use-permissions", () => ({
  usePermissions: () => ({ canIntegrationUser: true, canIntegrationAdmin: perms.admin })
}));
vi.mock("../components/use-api-context", () => ({
  useApiContext: () => ({ accessToken: "cookie", entityId: "e1", tenantSlug: "demo" })
}));
const api = vi.hoisted(() => ({
  listSourceSystems: vi.fn(),
  createSourceSystem: vi.fn(),
  updateSourceSystem: vi.fn(),
  updateIntegrationProfile: vi.fn()
}));
vi.mock("../lib/gl-api", async (original) => ({ ...(await original<object>()), ...api }));

import SourcesPage from "../app/t/[code]/(dashboard)/integrations/sources/page";
import {
  ImportSettingsCard,
  settingsPayload
} from "../components/integrations/import-settings-card";
import type { IntegrationProfileDetail } from "../lib/gl-api";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const sources = [
  { id: "1", code: "OPERA", name: "Opera PMS", isActive: true },
  { id: "2", code: "JANA", name: "Jana materials", isActive: false }
];

beforeEach(() => {
  perms.admin = true;
  for (const fn of Object.values(api)) fn.mockReset();
  api.listSourceSystems.mockResolvedValue({ data: sources, errors: [] });
});

describe("Sources", () => {
  it("lists the tenant's sources with their status", async () => {
    wrap(<SourcesPage />);
    expect(await screen.findByText("Opera PMS")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
  });

  it("adds a source with a well-formed code, written in capitals", async () => {
    api.createSourceSystem.mockResolvedValue({ data: sources[0], errors: [] });
    wrap(<SourcesPage />);
    await screen.findByText("Opera PMS");
    fireEvent.change(screen.getByPlaceholderText("OPERA"), { target: { value: "simphony" } });
    fireEvent.change(screen.getByPlaceholderText("Opera PMS night audit"), {
      target: { value: "Simphony POS" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    await waitFor(() =>
      expect(api.createSourceSystem).toHaveBeenCalledWith(expect.anything(), {
        code: "SIMPHONY",
        name: "Simphony POS"
      })
    );
  });

  it("does not offer a malformed code", async () => {
    wrap(<SourcesPage />);
    await screen.findByText("Opera PMS");
    fireEvent.change(screen.getByPlaceholderText("OPERA"), { target: { value: "opera pms" } });
    fireEvent.change(screen.getByPlaceholderText("Opera PMS night audit"), {
      target: { value: "x" }
    });
    expect((screen.getByRole("button", { name: /Add/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("deactivates and activates; read-only users see no controls", async () => {
    api.updateSourceSystem.mockResolvedValue({ data: sources[0], errors: [] });
    const { unmount } = wrap(<SourcesPage />);
    await screen.findByText("Opera PMS");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(api.updateSourceSystem).toHaveBeenCalledWith(expect.anything(), "OPERA", {
        isActive: false
      })
    );
    unmount();

    perms.admin = false;
    wrap(<SourcesPage />);
    await screen.findByText("Opera PMS");
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
    expect(screen.queryByPlaceholderText("OPERA")).toBeNull();
  });
});

const profile = {
  id: "p1",
  name: "Night audit",
  profileType: "IMPORT",
  targetComponent: "GL_JOURNAL",
  targetParams: { journalSource: "PMS", other: 1 },
  sourceSystemCode: "OPERA",
  reviewMode: "AUTO_COMMIT",
  atomicity: "WHOLE_FILE",
  unmappedPolicy: "REJECT",
  suspenseAccountCode: null,
  fxRateType: null
} as unknown as IntegrationProfileDetail;

describe("Posting to the ledger (profile settings)", () => {
  it("shows how the profile posts", () => {
    wrap(<ImportSettingsCard profile={profile} canEdit={false} onSaved={vi.fn()} />);
    expect(screen.getByText("OPERA")).toBeTruthy();
    expect(screen.getByText("The whole file or nothing")).toBeTruthy();
    expect(screen.getByText("Refuse the document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("says when no source system is set", () => {
    wrap(
      <ImportSettingsCard
        profile={{ ...profile, sourceSystemCode: null }}
        canEdit
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByText(/the profile cannot import yet/)).toBeTruthy();
  });

  it("needs a suspense account for the suspense policy, and saves the journal source inside targetParams", async () => {
    api.updateIntegrationProfile.mockResolvedValue({ data: profile, errors: [] });
    const onSaved = vi.fn();
    wrap(<ImportSettingsCard profile={profile} canEdit onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Refuse the document"), {
      target: { value: "SUSPENSE" }
    });
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1999" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateIntegrationProfile.mock.calls[0]![2]).toEqual({
      sourceSystemCode: "OPERA",
      reviewMode: "AUTO_COMMIT",
      atomicity: "WHOLE_FILE",
      unmappedPolicy: "SUSPENSE",
      suspenseAccountCode: "1999",
      fxRateType: null,
      targetParams: { journalSource: "PMS", other: 1 }
    });
  });

  it("clears the suspense account when the policy is not SUSPENSE", () => {
    const payload = settingsPayload(profile, {
      sourceSystemCode: "OPERA",
      reviewMode: "HOLD",
      atomicity: "PER_DOCUMENT",
      unmappedPolicy: "REJECT",
      suspenseAccountCode: "1999",
      fxRateType: "AVERAGE",
      journalSource: "POS"
    });
    expect(payload).toMatchObject({
      suspenseAccountCode: null,
      targetParams: { journalSource: "POS", other: 1 }
    });
  });
});
