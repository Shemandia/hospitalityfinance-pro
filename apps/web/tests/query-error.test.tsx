import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryError } from "../components/query-error";

describe("QueryError", () => {
  it("renders default message when no message prop given", () => {
    render(<QueryError />);
    expect(screen.getByText("Failed to load data. Please try again.")).toBeInTheDocument();
  });

  it("renders custom message", () => {
    render(<QueryError message="Network error" />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("shows retry button when onRetry is provided", () => {
    const onRetry = vi.fn();
    render(<QueryError onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("does not show retry button when onRetry is not provided", () => {
    render(<QueryError />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<QueryError onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
