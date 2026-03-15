import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AffaireCreatedOnboardingBanner } from "./AffaireCreatedOnboardingBanner";

describe("AffaireCreatedOnboardingBanner", () => {
  it("keeps manual continuation visible alongside upload and import", () => {
    render(
      <AffaireCreatedOnboardingBanner
        manualEstimateHref="/dashboard/estimates/version-1/edit?entry=manual"
        onDismiss={vi.fn()}
        onScrollToIntake={vi.fn()}
        onOpenImportFlow={vi.fn()}
      />,
    );

    expect(screen.getByText("Deposez votre dossier")).toBeInTheDocument();
    expect(screen.getByText("Continuer en manuel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir le devis" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-1/edit?entry=manual",
    );
    expect(screen.getByText("Ou importer un DPGF")).toBeInTheDocument();
  });
});
