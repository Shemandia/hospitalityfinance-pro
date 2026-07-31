import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WizardLayout, WizardStepContent } from "../components/wizard-layout";

const STEPS = [
  { id: 1, name: "Details" },
  { id: 2, name: "Configuration" },
  { id: 3, name: "Review" }
];

describe("WizardLayout", () => {
  it("renders all step labels", () => {
    render(
      <WizardLayout title="Setup" steps={STEPS} currentStep={1} completedSteps={[]}>
        <div>Step content</div>
      </WizardLayout>
    );

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders children content", () => {
    render(
      <WizardLayout title="Setup" steps={STEPS} currentStep={1} completedSteps={[]}>
        <div>My step content</div>
      </WizardLayout>
    );

    expect(screen.getByText("My step content")).toBeInTheDocument();
  });

  it("renders sidebar footer when provided", () => {
    render(
      <WizardLayout
        title="Setup"
        steps={STEPS}
        currentStep={1}
        completedSteps={[]}
        sidebarFooter={<div>Footer info</div>}
      >
        <div>Content</div>
      </WizardLayout>
    );

    expect(screen.getByText("Footer info")).toBeInTheDocument();
  });

  it("calls onStepClick when a clickable step is clicked", async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();

    render(
      <WizardLayout
        title="Setup"
        steps={STEPS}
        currentStep={2}
        completedSteps={[1]}
        onStepClick={onStepClick}
      >
        <div>Content</div>
      </WizardLayout>
    );

    // Step 1 is completed so should be clickable
    await user.click(screen.getByText("Details"));
    expect(onStepClick).toHaveBeenCalledWith(1);
  });
});

describe("WizardStepContent", () => {
  it("renders step number, title, and description", () => {
    render(
      <WizardStepContent
        stepNumber={2}
        totalSteps={3}
        title="Configuration"
        description="Set up your preferences."
      >
        <div>Form fields</div>
      </WizardStepContent>
    );

    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Set up your preferences.")).toBeInTheDocument();
    expect(screen.getByText("Form fields")).toBeInTheDocument();
  });

  it("renders Back button when onBack is provided", () => {
    render(
      <WizardStepContent
        stepNumber={2}
        totalSteps={3}
        title="Step 2"
        description="Desc"
        onBack={() => {}}
      >
        <div />
      </WizardStepContent>
    );

    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("does not render Back button when onBack is not provided", () => {
    render(
      <WizardStepContent stepNumber={1} totalSteps={3} title="Step 1" description="Desc">
        <div />
      </WizardStepContent>
    );

    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("renders Continue button with custom label", () => {
    render(
      <WizardStepContent
        stepNumber={3}
        totalSteps={3}
        title="Review"
        description="Desc"
        onNext={() => {}}
        nextLabel="Submit"
      >
        <div />
      </WizardStepContent>
    );

    expect(screen.getByText("Submit")).toBeInTheDocument();
  });

  it("disables Continue when isNextDisabled is true", () => {
    render(
      <WizardStepContent
        stepNumber={1}
        totalSteps={3}
        title="Step 1"
        description="Desc"
        onNext={() => {}}
        isNextDisabled={true}
      >
        <div />
      </WizardStepContent>
    );

    const button = screen.getByText("Continue");
    expect(button).toBeDisabled();
  });

  it("shows loading text when isLoading is true", () => {
    render(
      <WizardStepContent
        stepNumber={1}
        totalSteps={3}
        title="Step 1"
        description="Desc"
        onNext={() => {}}
        isLoading={true}
      >
        <div />
      </WizardStepContent>
    );

    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("calls onNext when Continue is clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();

    render(
      <WizardStepContent
        stepNumber={1}
        totalSteps={3}
        title="Step 1"
        description="Desc"
        onNext={onNext}
      >
        <div />
      </WizardStepContent>
    );

    await user.click(screen.getByText("Continue"));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("renders Save & Continue Later when showSave and onSave are provided", () => {
    render(
      <WizardStepContent
        stepNumber={1}
        totalSteps={3}
        title="Step 1"
        description="Desc"
        showSave={true}
        onSave={() => {}}
      >
        <div />
      </WizardStepContent>
    );

    expect(screen.getByText("Save & Continue Later")).toBeInTheDocument();
  });
});
