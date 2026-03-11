import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TakeoffRouteHierarchyBanner } from "@/components/takeoff/TakeoffRouteHierarchyBanner";

describe("TakeoffRouteHierarchyBanner", () => {
  it("renders a principal flow descriptor without fallback CTA", () => {
    render(
      <TakeoffRouteHierarchyBanner
        descriptor={{
          classification: "principal",
          badgeLabel: "Flux principal",
          title: "Parcours affaire prioritaire",
          description: "Le parcours affaire reste la voie par defaut.",
          provenanceLabel: "Provenance du chemin : affaire-first / centre metres",
          targetHref: null,
          targetLabel: null,
        }}
      />
    );

    expect(screen.getByText("Flux principal")).toBeInTheDocument();
    expect(screen.getByText("Parcours affaire prioritaire")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Revenir au flux principal" })
    ).not.toBeInTheDocument();
  });

  it("renders a legacy descriptor with an explicit fallback link", () => {
    render(
      <TakeoffRouteHierarchyBanner
        descriptor={{
          classification: "legacy",
          badgeLabel: "Legacy",
          title: "Fallback estimate-first explicite",
          description: "Le flux principal reste l'affaire.",
          provenanceLabel: "Provenance du chemin : legacy estimate-first / revue",
          targetHref: "/dashboard/affaires/project-1/takeoff",
          targetLabel: "Revenir au flux principal",
        }}
      />
    );

    expect(screen.getByText("Legacy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revenir au flux principal" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff"
    );
  });
});
