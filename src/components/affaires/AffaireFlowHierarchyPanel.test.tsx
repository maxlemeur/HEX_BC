import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AffaireFlowHierarchyPanel } from "./AffaireFlowHierarchyPanel";

afterEach(() => {
  cleanup();
});

describe("AffaireFlowHierarchyPanel", () => {
  it("keeps principal, adjacent and legacy visible from the affair shell", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-1"
        currentVersion={{
          id: "version-1",
          projectId: "project-1",
          versionNumber: 3,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-1",
          projectId: "project-1",
          hasConfirmedBrief: true,
          confirmedBriefId: "brief-1",
          isVersionEmpty: false,
          canGenerate: true,
          availableLots: [],
          activeDraft: null,
        }}
        takeoffEnabled
        plansSummary={{
          planSetCount: 2,
          planFileCount: 4,
          totalSizeBytes: 2048,
          hasLegacyFallback: true,
          defaultPlanSetId: "set-1",
          defaultPlanSetName: "Plans confirmes",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 4,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: null,
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(screen.getByText("Flux principal")).toBeInTheDocument();
    expect(screen.getByText("Aides adjacentes")).toBeInTheDocument();
    expect(screen.getAllByText("Fallback legacy").length).toBeGreaterThan(0);
    expect(screen.getByText("Aucun renvoi par defaut vers le legacy")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dossier, plans, analyse metres, revue/apply et sortie restent alignes ici."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ouvrir les plans" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/plans");
    expect(
      screen.getByRole("link", { name: "Ouvrir le centre metres" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/takeoff");
    expect(screen.getByRole("link", { name: "Ouvrir V0 IA" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-1/edit?openVersionZero=1"
    );
    expect(
      screen.getByRole("link", { name: "Ouvrir le fallback legacy" })
    ).toHaveAttribute("href", "/dashboard/estimates/version-1/takeoff");
  });

  it("hides the legacy CTA when no real legacy fallback exists", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-2"
        currentVersion={{
          id: "version-2",
          projectId: "project-2",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={{
          planSetCount: 1,
          planFileCount: 2,
          totalSizeBytes: 1024,
          hasLegacyFallback: false,
          defaultPlanSetId: "set-2",
          defaultPlanSetName: "Plans affaire",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 2,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: null,
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(screen.getAllByText("Fallback legacy").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Aucun contexte estimate-first actif n'est detecte sur cette affaire, donc aucun fallback legacy n'est propose comme reprise."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Ouvrir le fallback legacy" })
    ).not.toBeInTheDocument();
  });
});
