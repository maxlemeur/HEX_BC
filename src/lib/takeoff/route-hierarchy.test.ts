import { describe, expect, it } from "vitest";

import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";

describe("buildTakeoffRouteHierarchy", () => {
  it("marks affaire routes as the principal flow", () => {
    expect(buildTakeoffRouteHierarchy({ kind: "affaire_takeoff" })).toEqual({
      classification: "principal",
      badgeLabel: "Flux principal",
      title: "Parcours affaire prioritaire",
      description:
        "Vous etes dans le flux principal affaire-first. Les aides adjacentes restent secondaires, et le legacy estimate-first n'est qu'un fallback volontaire.",
      provenanceLabel: "Provenance du chemin : affaire-first / centre metres",
      targetHref: null,
      targetLabel: null,
    });
  });

  it("marks estimate-first routes as legacy and links back to the principal flow", () => {
    expect(
      buildTakeoffRouteHierarchy({
        kind: "estimate_takeoff_legacy",
        projectId: "project-1",
      })
    ).toEqual({
      classification: "legacy",
      badgeLabel: "Legacy",
      title: "Fallback estimate-first explicite",
      description:
        "Vous etes dans une surface legacy estimate-first. Le flux principal reste l'affaire ; utilisez ce chemin seulement si vous reprenez un contexte existant ou un cas de fallback.",
      provenanceLabel: "Provenance du chemin : legacy estimate-first / historique takeoff",
      targetHref: "/dashboard/affaires/project-1/takeoff",
      targetLabel: "Revenir au flux principal",
    });
  });

  it("keeps review routes traceable when they come from legacy estimate-first flows", () => {
    expect(
      buildTakeoffRouteHierarchy({
        kind: "estimate_review_legacy",
        projectId: "project-1",
        versionId: "version-1",
        jobId: "job-1",
      })
    ).toMatchObject({
      classification: "legacy",
      provenanceLabel: "Provenance du chemin : legacy estimate-first / revue",
      targetHref:
        "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-1&view=dpgf&dpgfView=exceptions_only",
    });
  });

  it("keeps the generic takeoff portal as an explicit legacy entrypoint", () => {
    expect(buildTakeoffRouteHierarchy({ kind: "dashboard_takeoff_legacy" })).toMatchObject({
      classification: "legacy",
      provenanceLabel: "Provenance du chemin : legacy estimate-first / portail takeoff",
      targetHref: "/dashboard/affaires",
    });
  });
});
