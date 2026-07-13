import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanSetFormModal } from "./PlanSetFormModal";

describe("PlanSetFormModal", () => {
  it("focuses the plan-set name and exposes mobile-sized actions", async () => {
    render(
      <PlanSetFormModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        loading={false}
        error={null}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Nom du jeu")).toHaveFocus());

    expect(screen.getByRole("button", { name: "Fermer" })).toHaveClass("h-11");
    expect(screen.getByRole("button", { name: "Annuler" })).toHaveClass("h-11");
    expect(screen.getByRole("button", { name: "Créer" })).toHaveClass("h-11");
    expect(screen.getByLabelText("Nom du jeu")).toHaveClass("form-input");
  });
});
