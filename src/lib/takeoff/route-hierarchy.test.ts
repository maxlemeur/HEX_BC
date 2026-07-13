import { describe, expect, it } from "vitest";

import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";

describe("buildTakeoffRouteHierarchy", () => {
  it("marks affaire routes as the principal flow", () => {
    expect(buildTakeoffRouteHierarchy({ kind: "affaire_takeoff" })).toEqual({
      classification: "principal",
      badgeLabel: "Parcours recommandé",
      title: "Suivre les métrés de l’affaire",
      description:
        "Consultez les analyses en cours ou terminées et reprenez les éléments qui demandent votre attention.",
      provenanceLabel: "Étape : suivi des analyses",
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
      badgeLabel: "Ancien parcours",
      title: "Parcours conservé pour les dossiers existants",
      description:
        "Cette vue sert à reprendre un métré déjà rattaché à une version de devis. Pour un nouveau métré, partez des plans de l’affaire.",
      provenanceLabel: "Repère : historique d’une version de devis",
      targetHref: "/dashboard/affaires/project-1",
      targetLabel: "Revenir à l’affaire",
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
      provenanceLabel: "Repère : revue d’un métré existant",
      targetHref:
        "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-1&view=dpgf&dpgfView=exceptions_only",
    });
  });

  it("routes legacy job monitoring back to the affair activity center", () => {
    expect(
      buildTakeoffRouteHierarchy({
        kind: "estimate_job_legacy",
        projectId: "project-1",
        versionId: "version-1",
        jobId: "job-1",
      })
    ).toMatchObject({
      classification: "legacy",
      provenanceLabel: "Repère : suivi d’une analyse existante",
      targetHref: "/dashboard/affaires/project-1",
      targetLabel: "Revenir à l’affaire",
    });
  });

  it("preserves review query state when redirecting to the affair review flow", () => {
    expect(
      buildTakeoffRouteHierarchy({
        kind: "estimate_review_legacy",
        projectId: "project-1",
        versionId: "version-1",
        jobId: "job-1",
        searchParams: {
          versionId: "version-1",
          view: "compare",
          compareWith: "job-2",
          threshold: "0.9",
        },
      })
    ).toMatchObject({
      targetHref:
        "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-1&view=compare&compareWith=job-2&threshold=0.9",
    });
  });

  it("keeps the generic takeoff portal as an explicit legacy entrypoint", () => {
    expect(buildTakeoffRouteHierarchy({ kind: "dashboard_takeoff_legacy" })).toMatchObject({
      classification: "legacy",
      provenanceLabel: "Repère : entrée générale des métrés existants",
      targetHref: "/dashboard/affaires",
      targetLabel: "Choisir une affaire",
    });
  });
});
