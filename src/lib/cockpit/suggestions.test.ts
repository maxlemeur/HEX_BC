import { describe, it, expect } from "vitest";

import type { AffaireHubPlansSummaryData } from "@/components/affaires/PlansMetresCard";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

import {
  computeCockpitSuggestions,
  type ComputeCockpitSuggestionsInput,
} from "./suggestions";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makePlansSummary(
  overrides: Partial<AffaireHubPlansSummaryData> = {},
): AffaireHubPlansSummaryData {
  return {
    planSetCount: 2,
    planFileCount: 5,
    totalSizeBytes: 1024,
    defaultPlanSetId: "ps-1",
    latestJob: {
      jobId: "job-1",
      status: "completed",
      label: "Analyse #1",
      reviewVersionId: "rv-1",
    },
    coveragePercent: 85,
    exceptionCount: 3,
    openQuestionsCount: 1,
    failureReasonLabel: null,
    ...overrides,
  };
}

function makeRegisterSummary(
  overrides: Partial<AffaireRegisterSummary> = {},
): AffaireRegisterSummary {
  return {
    openQuestionsCount: 4,
    criticalOpenCount: 1,
    nonCriticalOpenCount: 3,
    clarifyWithClientCount: 0,
    openAssumptionCount: 2,
    openMissingPieceCount: 2,
    ...overrides,
  };
}

function makeApprovalSummary(
  canPrepareRequest = true,
): EstimateApprovalSummary {
  return {
    permissions: {
      canPrepareRequest,
      canRequest: false,
      canDecide: false,
    },
  } as EstimateApprovalSummary;
}

function makeInput(
  overrides: Partial<ComputeCockpitSuggestionsInput> = {},
): ComputeCockpitSuggestionsInput {
  return {
    projectId: "proj-42",
    takeoffEnabled: true,
    isReadOnlyReview: false,
    plansSummary: null,
    registerSummary: null,
    approvalSummary: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("computeCockpitSuggestions", () => {
  it("returns empty array when no conditions match", () => {
    const result = computeCockpitSuggestions(makeInput());
    expect(result).toEqual([]);
  });

  // -- analyze_plans --------------------------------------------------

  describe("analyze_plans", () => {
    it("appears when takeoffEnabled + planSetCount > 0 + not readOnly", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          takeoffEnabled: true,
          isReadOnlyReview: false,
          plansSummary: makePlansSummary({ planSetCount: 1, latestJob: null }),
        }),
      );
      const s = result.find((s) => s.intent === "analyze_plans");
      expect(s).toBeDefined();
      expect(s!.actionId).toBe("analyze-plans");
      expect(s!.target).toEqual({
        kind: "open_dialog",
        dialogId: "launch-metre",
      });
    });

    it("is absent when isReadOnlyReview is true", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          takeoffEnabled: true,
          isReadOnlyReview: true,
          plansSummary: makePlansSummary(),
        }),
      );
      expect(result.find((s) => s.intent === "analyze_plans")).toBeUndefined();
    });

    it("is absent when takeoffEnabled is false", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          takeoffEnabled: false,
          plansSummary: makePlansSummary(),
        }),
      );
      expect(result.find((s) => s.intent === "analyze_plans")).toBeUndefined();
    });

    it("is absent when an analysis is already running", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            latestJob: {
              jobId: "j-1",
              status: "provider_pending",
              label: "En attente provider",
              reviewVersionId: "rv-1",
            },
          }),
        }),
      );

      expect(result.find((s) => s.intent === "analyze_plans")).toBeUndefined();
    });

    it("is absent when the latest job requires review", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            latestJob: {
              jobId: "j-1",
              status: "review_required",
              label: "Revue requise",
              reviewVersionId: "rv-1",
            },
          }),
        }),
      );

      expect(result.find((s) => s.intent === "analyze_plans")).toBeUndefined();
    });
  });

  // -- view_exceptions ------------------------------------------------

  describe("view_exceptions", () => {
    it("appears with correct deep-link URL when exceptionCount > 0 and latestJob completed", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            exceptionCount: 5,
            latestJob: {
              jobId: "j-99",
              status: "completed",
              label: "Job",
              reviewVersionId: "rv-99",
            },
          }),
        }),
      );
      const s = result.find((s) => s.intent === "view_exceptions");
      expect(s).toBeDefined();
      expect(s!.label).toBe("Voir les 5 exceptions");
      expect(s!.target).toEqual({
        kind: "navigate",
        href: "/dashboard/affaires/proj-42/takeoff/j-99/review?versionId=rv-99&view=dpgf&dpgfView=exceptions_only",
      });
    });

    it("appears when latestJob status is review_required", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            exceptionCount: 1,
            latestJob: {
              jobId: "j-1",
              status: "review_required",
              label: "Job",
              reviewVersionId: "rv-1",
            },
          }),
        }),
      );
      const s = result.find((s) => s.intent === "view_exceptions");
      expect(s).toBeDefined();
      expect(s!.label).toBe("Voir les 1 exception");
    });

    it("is absent when no latestJob", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            exceptionCount: 3,
            latestJob: null,
          }),
        }),
      );
      expect(
        result.find((s) => s.intent === "view_exceptions"),
      ).toBeUndefined();
    });

    it("is absent when latestJob status is queued", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            exceptionCount: 3,
            latestJob: {
              jobId: "j-1",
              status: "queued",
              label: "Job",
              reviewVersionId: "rv-1",
            },
          }),
        }),
      );
      expect(
        result.find((s) => s.intent === "view_exceptions"),
      ).toBeUndefined();
    });

    it("is absent when latestJob status is action_required", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          plansSummary: makePlansSummary({
            exceptionCount: 3,
            latestJob: {
              jobId: "j-1",
              status: "action_required",
              label: "Job",
              reviewVersionId: "rv-1",
            },
          }),
        }),
      );
      expect(
        result.find((s) => s.intent === "view_exceptions"),
      ).toBeUndefined();
    });
  });

  // -- list_hypotheses ------------------------------------------------

  describe("list_hypotheses", () => {
    it("appears with correct count interpolation", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          registerSummary: makeRegisterSummary({ openQuestionsCount: 7 }),
        }),
      );
      const s = result.find((s) => s.intent === "list_hypotheses");
      expect(s).toBeDefined();
      expect(s!.label).toBe("7 hypotheses ouvertes");
      expect(s!.preview).toBe(
        "7 points du registre necessitent une decision.",
      );
      expect(s!.target).toEqual({
        kind: "navigate",
        href: "/dashboard/affaires/proj-42?registerStatus=open",
      });
    });

    it("uses singular form for count of 1", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          registerSummary: makeRegisterSummary({ openQuestionsCount: 1 }),
        }),
      );
      const s = result.find((s) => s.intent === "list_hypotheses");
      expect(s).toBeDefined();
      expect(s!.label).toBe("1 hypothese ouverte");
      expect(s!.preview).toBe(
        "1 point du registre necessitent une decision.",
      );
    });

    it("is absent when openQuestionsCount is 0", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          registerSummary: makeRegisterSummary({ openQuestionsCount: 0 }),
        }),
      );
      expect(
        result.find((s) => s.intent === "list_hypotheses"),
      ).toBeUndefined();
    });
  });

  // -- prepare_validation ---------------------------------------------

  describe("prepare_validation", () => {
    it("appears when canPrepareRequest is true", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          approvalSummary: makeApprovalSummary(true),
        }),
      );
      const s = result.find((s) => s.intent === "prepare_validation");
      expect(s).toBeDefined();
      expect(s!.actionId).toBe("prepare-validation");
      expect(s!.target).toEqual({
        kind: "open_dialog",
        dialogId: "approval-submit",
      });
    });

    it("has requiresConfirmation: true", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          approvalSummary: makeApprovalSummary(true),
        }),
      );
      const s = result.find((s) => s.intent === "prepare_validation");
      expect(s!.requiresConfirmation).toBe(true);
    });

    it("is absent when canPrepareRequest is false", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          approvalSummary: makeApprovalSummary(false),
        }),
      );
      expect(
        result.find((s) => s.intent === "prepare_validation"),
      ).toBeUndefined();
    });
  });

  // -- Ordering -------------------------------------------------------

  describe("ordering", () => {
    it("returns suggestions in order once the latest job requires review", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          takeoffEnabled: true,
          isReadOnlyReview: false,
          plansSummary: makePlansSummary({
            planSetCount: 2,
            exceptionCount: 3,
            latestJob: {
              jobId: "j-1",
              status: "completed",
              label: "Job",
              reviewVersionId: "rv-1",
            },
          }),
          registerSummary: makeRegisterSummary({ openQuestionsCount: 2 }),
          approvalSummary: makeApprovalSummary(true),
        }),
      );
      expect(result).toHaveLength(3);
      expect(result[0].intent).toBe("view_exceptions");
      expect(result[1].intent).toBe("list_hypotheses");
      expect(result[2].intent).toBe("prepare_validation");
    });

    it("surfaces analyze_plans only when there is no latest job to follow up", () => {
      const result = computeCockpitSuggestions(
        makeInput({
          takeoffEnabled: true,
          isReadOnlyReview: false,
          plansSummary: makePlansSummary({
            planSetCount: 1,
            exceptionCount: 0,
            latestJob: null,
          }),
          registerSummary: makeRegisterSummary({ openQuestionsCount: 1 }),
          approvalSummary: makeApprovalSummary(true),
        }),
      );
      const intents = result.map((s) => s.intent);
      expect(intents).toContain("analyze_plans");
      expect(intents).toContain("list_hypotheses");
      expect(intents).toContain("prepare_validation");
      expect(intents).not.toContain("view_exceptions");
      expect(result).toHaveLength(3);
    });
  });
});
