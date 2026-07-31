import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock Next.js navigation hooks
vi.mock("next/navigation", () => ({
  usePathname: () => "/t/demo/dashboard"
}));

vi.mock("../hooks/use-tenant-router", () => ({
  useTenantSlugSafe: () => "demo"
}));

// Mock next/link to render a plain anchor
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

import { SidebarNav } from "../components/sidebar-nav";

describe("SidebarNav", () => {
  it("renders all navigation group headers", () => {
    render(<SidebarNav />);

    expect(screen.getByText("Dashboards")).toBeInTheDocument();
    expect(screen.getByText("General Ledger")).toBeInTheDocument();
    expect(screen.getByText("Payables & Receivables")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("renders dashboard items when Dashboards group is expanded", () => {
    render(<SidebarNav />);

    // Dashboards is open by default + current path is /t/demo/dashboard
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("General Manager")).toBeInTheDocument();
    expect(screen.getByText("Financial Controller")).toBeInTheDocument();
  });

  it("prefixes links with tenant slug", () => {
    render(<SidebarNav />);

    const overview = screen.getByText("Overview").closest("a");
    expect(overview).toHaveAttribute("href", "/t/demo/dashboard");
  });

  it("toggles group visibility on click", async () => {
    const user = userEvent.setup();
    render(<SidebarNav />);

    // GL group - click to expand
    const glHeader = screen.getByText("General Ledger");
    await user.click(glHeader);

    expect(screen.getByText("Chart of Accounts")).toBeInTheDocument();
    expect(screen.getByText("General Journal")).toBeInTheDocument();
    expect(screen.getByText("Trial Balance")).toBeInTheDocument();
    expect(screen.getByText("Recurring Journals")).toBeInTheDocument();
  });

  it("highlights the active nav item", () => {
    render(<SidebarNav />);

    // /t/demo/dashboard is the current path, so Overview should have the active class
    const overviewLink = screen.getByText("Overview").closest("a");
    expect(overviewLink?.className).toContain("bg-emerald-600");
  });

  it("renders all expected Admin section items when expanded", async () => {
    const user = userEvent.setup();
    render(<SidebarNav />);

    await user.click(screen.getByText("Admin"));

    expect(screen.getByText("My Profile")).toBeInTheDocument();
    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("Periods")).toBeInTheDocument();
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
  });
});
