import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  reclassifyAffaireDocument: vi.fn(),
  setAffaireDocumentAsPrimary: vi.fn(),
}));

import { IntakeCategoryCard } from "@/components/affaires/IntakeCategoryCard";

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
        documents={[
          {
            documentId: "doc-1",
            fileName: "plan-rdc.pdf",
            detectedCategory: "plans",
            confidence: 0.98,
            extractedMetadata: {
              projectName: "Residence Horizon",
              clientName: "Client A",
              deadlineAt: null,
              detectedLots: ["VRD"],
              detectedVariants: [],
            },
            issues: [],
          },
        ]}
        projectId="project-1"
        onReclassified={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Reclasser" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Plans/i }));

    expect(screen.getByRole("button", { name: "Reclasser" })).toBeInTheDocument();
    expect(screen.getByText("Residence Horizon")).toBeInTheDocument();
  });
});
