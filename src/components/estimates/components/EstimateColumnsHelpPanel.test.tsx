import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EstimateColumnsHelpPanel } from "@/components/estimates/components/EstimateColumnsHelpPanel";

describe("EstimateColumnsHelpPanel", () => {
  it("regroups column definitions and the sale formula in one panel", () => {
    render(<EstimateColumnsHelpPanel />);

    const trigger = screen.getByRole("button", { name: "Aide colonnes" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("heading", { name: "Aide des colonnes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vente" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "PU = (PR FO × K FO + h MO × K MO × prix horaire MO) × coefficient de marge. Si le taux horaire du rôle vaut 0 €/h, la MO contribue 0 € au PU.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "(100 € × 1,20 + 1 h × 1,10 × 50 €) × 1,10 = 192,50 €",
      ),
    ).toBeInTheDocument();
  });
});
