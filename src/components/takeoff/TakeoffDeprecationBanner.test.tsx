import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";

describe("TakeoffDeprecationBanner", () => {
  it("makes legacy fallback and primary affaire flow explicit", () => {
    render(<TakeoffDeprecationBanner targetHref="/dashboard/affaires/project-1" />);

    expect(screen.getByText("Legacy estimate-first")).toBeInTheDocument();
    expect(screen.getByText("Flux principal: affaire")).toBeInTheDocument();
    expect(
      screen.getByText(/Cette vue reste un fallback legacy/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ouvrir le flux principal affaire" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1");
    expect(
      screen.getByText("Provenance du chemin : legacy estimate-first")
    ).toBeInTheDocument();
  });

  it("surfaces route provenance when a route-level descriptor is provided", () => {
    render(
      <TakeoffDeprecationBanner
        descriptor={{
          description: "Le flux principal reste l'affaire pour ce dossier.",
          provenanceLabel: "Provenance du chemin : legacy estimate-first / revue",
          targetHref: "/dashboard/affaires/project-1/takeoff",
          targetLabel: "Revenir au flux principal",
        }}
      />
    );

    expect(
      screen.getByText("Provenance du chemin : legacy estimate-first / revue")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revenir au flux principal" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff"
    );
  });
});
