import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AffaireWorkflowStepper } from "./AffaireWorkflowStepper";

describe("AffaireWorkflowStepper", () => {
  it("uses a compact six-column mobile layout with the current step written in full", () => {
    render(<AffaireWorkflowStepper />);

    expect(screen.getByText("Étape 1 sur 6")).toBeInTheDocument();
    expect(screen.getAllByText("Dossier")).toHaveLength(2);

    const firstStep = screen.getByRole("link", {
      name: "Étape 1 sur 6 : Dossier, en cours",
    });
    expect(firstStep).toHaveAttribute("href", "#intake");
    expect(firstStep).toHaveClass("min-h-11", "min-w-11");
    expect(firstStep.closest("ol")).toHaveClass("grid", "grid-cols-6");
  });
});
