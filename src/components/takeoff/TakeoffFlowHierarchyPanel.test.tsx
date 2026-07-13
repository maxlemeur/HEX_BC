import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TakeoffFlowHierarchyPanel } from "@/components/takeoff/TakeoffFlowHierarchyPanel";

describe("TakeoffFlowHierarchyPanel", () => {
  it("keeps the route explanation folded and exposes it as native help", async () => {
    const user = userEvent.setup();

    render(
      <TakeoffFlowHierarchyPanel currentKind="principal" legacyPlanSetCount={1} />
    );

    const summary = screen.getByText("Comment s’organise un métré ?").closest("summary");
    const details = summary?.closest("details");

    expect(
      screen.getByRole("complementary", {
        name: "Aide sur l’organisation des métrés",
      })
    ).toBeInTheDocument();
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveProperty("tabIndex", 0);
    expect(screen.getByText("1 ancien jeu de plans disponible")).toBeInTheDocument();

    await user.click(summary!);

    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Parcours recommandé" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Suivi et reprise" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Anciens jeux de plans" })).toBeVisible();
    expect(screen.getByText("Page actuelle")).toBeVisible();
    expect(screen.getByText("Dossiers existants")).toBeVisible();
    expect(screen.queryByText(/legacy|fallback|affaire-first/i)).not.toBeInTheDocument();
  });
});
