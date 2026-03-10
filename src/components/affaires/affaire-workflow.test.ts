import { describe, expect, it } from "vitest";

import {
  buildAffaireWorkflowSteps,
  shouldRenderPlansSection,
} from "@/components/affaires/affaire-workflow";

describe("buildAffaireWorkflowSteps", () => {
  it("keeps validation current when changes are requested and blocks later steps", () => {
    const steps = buildAffaireWorkflowSteps({
      hasDocs: true,
      briefConfirmed: true,
      hasDpgf: true,
      hasLines: true,
      approvalStatus: "changes_requested",
      isSent: true,
    });

    expect(steps.map((step) => [step.key, step.status])).toEqual([
      ["dossier", "done"],
      ["brief", "done"],
      ["dpgf", "done"],
      ["devis", "done"],
      ["validation", "current"],
      ["envoi", "upcoming"],
    ]);
  });

  it("marks validation done when approval is not required", () => {
    const steps = buildAffaireWorkflowSteps({
      hasDocs: true,
      briefConfirmed: true,
      hasDpgf: true,
      hasLines: true,
      approvalStatus: "not_required",
      isSent: true,
    });

    expect(steps.map((step) => [step.key, step.status])).toEqual([
      ["dossier", "done"],
      ["brief", "done"],
      ["dpgf", "done"],
      ["devis", "done"],
      ["validation", "done"],
      ["envoi", "done"],
    ]);
  });
});

describe("shouldRenderPlansSection", () => {
  it("keeps the plans section mounted when loading the summary failed", () => {
    expect(
      shouldRenderPlansSection({
        takeoffEnabled: true,
        planSetCount: null,
        plansErrorMessage: "Impossible de charger le resume des plans.",
      })
    ).toBe(true);
  });
});
