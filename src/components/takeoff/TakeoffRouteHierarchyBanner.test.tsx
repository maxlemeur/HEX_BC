import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TakeoffRouteHierarchyBanner } from "@/components/takeoff/TakeoffRouteHierarchyBanner";

describe("TakeoffRouteHierarchyBanner", () => {
  it("keeps the recommended route help compact until the user opens it", async () => {
    const user = userEvent.setup();

    render(
      <TakeoffRouteHierarchyBanner
        descriptor={{
          classification: "principal",
          badgeLabel: "Parcours recommandé",
          title: "Suivre les métrés de l’affaire",
          description: "Consultez les analyses de cette affaire.",
          provenanceLabel: "Étape : suivi des analyses",
          targetHref: null,
          targetLabel: null,
        }}
      />
    );

    const summary = screen.getByText("Suivre les métrés de l’affaire").closest("summary");
    const details = summary?.closest("details");

    expect(
      screen.getByRole("complementary", { name: "Aide sur le parcours de métrés" })
    ).toBeInTheDocument();
    expect(summary).toBeInTheDocument();
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveProperty("tabIndex", 0);

    await user.click(summary!);

    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Consultez les analyses de cette affaire.")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Ouvrir le parcours depuis l’affaire" })
    ).not.toBeInTheDocument();
  });

  it("reveals the link back to the recommended route from an old route", async () => {
    const user = userEvent.setup();

    render(
      <TakeoffRouteHierarchyBanner
        descriptor={{
          classification: "legacy",
          badgeLabel: "Ancien parcours",
          title: "Parcours conservé pour les dossiers existants",
          description: "Cette vue sert à reprendre un métré existant.",
          provenanceLabel: "Repère : revue d’un métré existant",
          targetHref: "/dashboard/affaires/project-1/takeoff",
          targetLabel: "Ouvrir le parcours depuis l’affaire",
        }}
      />
    );

    const summary = screen
      .getByText("Parcours conservé pour les dossiers existants")
      .closest("summary");

    await user.click(summary!);

    expect(
      screen.getByRole("link", { name: "Ouvrir le parcours depuis l’affaire" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/takeoff");
  });
});
