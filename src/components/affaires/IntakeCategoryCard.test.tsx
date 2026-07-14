import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  reclassifyAffaireDocument: vi.fn(),
  setAffaireDocumentAsPrimary: vi.fn(),
}));

import { IntakeCategoryCard } from "@/components/affaires/IntakeCategoryCard";

const PLAN_DOCUMENT = {
  documentId: "doc-1",
  fileName: "plan-rdc.pdf",
  detectedCategory: "plans" as const,
  confidence: 0.98,
  extractedMetadata: {
    projectName: "Residence Horizon",
    clientName: "Client A",
    deadlineAt: null,
    detectedLots: ["VRD"],
    detectedVariants: [],
  },
  issues: [],
};

describe("IntakeCategoryCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the full document card when the category is expanded", async () => {
    const user = userEvent.setup();

    render(
      <IntakeCategoryCard
        category="plans"
        documents={[PLAN_DOCUMENT]}
        projectId="project-1"
        onReclassified={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Reclasser" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Plans/i }));

    expect(screen.getByRole("button", { name: "Reclasser" })).toBeInTheDocument();
    expect(screen.getByText("Residence Horizon")).toBeInTheDocument();
  });

  it("expands when a document becomes focused and stays open afterward", () => {
    const baseProps = {
      category: "plans" as const,
      documents: [PLAN_DOCUMENT],
      projectId: "project-1",
      onReclassified: vi.fn(),
    };
    const { rerender } = render(<IntakeCategoryCard {...baseProps} />);

    expect(screen.queryByRole("button", { name: "Reclasser" })).not.toBeInTheDocument();

    rerender(<IntakeCategoryCard {...baseProps} focusDocumentId="doc-1" />);
    expect(screen.getByRole("button", { name: "Reclasser" })).toBeInTheDocument();

    rerender(<IntakeCategoryCard {...baseProps} focusDocumentId={null} />);
    expect(screen.getByRole("button", { name: "Reclasser" })).toBeInTheDocument();
  });
});
