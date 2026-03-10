import { describe, expect, it } from "vitest";

import type { AffaireHubPlansSummaryData } from "@/components/affaires/PlansMetresCard";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { VersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";

import {
  applyCockpitSuggestionPreferences,
  computeCockpitSuggestions,
  type ComputeCockpitSuggestionsInput,
} from "./suggestions";

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

function makeIntakeWorkspace(
  overrides: Partial<AffaireIntakeWorkspace> = {},
): AffaireIntakeWorkspace {
  return {
    projectId: "proj-42",
    uploadId: "upload-1",
    documents: [
      {
        documentId: "doc-1",
        fileName: "plans.pdf",
        detectedCategory: "plans",
        confidence: 0.95,
        extractedMetadata: {
          projectName: null,
          clientName: null,
          deadlineAt: null,
          detectedLots: [],
          detectedVariants: [],
        },
        issues: [],
      },
    ],
    missingPieces: [],
    briefDraft: null,
    ...overrides,
  };
}

function makeVersionZeroSummary(
  overrides: Partial<VersionZeroDraftSummary> = {},
): VersionZeroDraftSummary {
  return {
    versionId: "version-1",
    projectId: "proj-42",
    hasConfirmedBrief: true,
    confirmedBriefId: "brief-1",
    isVersionEmpty: true,
    canGenerate: true,
    availableLots: [],
    activeDraft: null,
    ...overrides,
  };
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
    intakeWorkspace: null,
    versionZeroSummary: null,
    currentVersion: null,
    preferences: [],
    ...overrides,
  };
}

describe("computeCockpitSuggestions", () => {
  it("suggests adding files when the dossier is empty", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          uploadId: null,
          documents: [],
        }),
      }),
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        intent: "add_files",
        target: { kind: "open_surface", surfaceId: "intake-upload" },
      }),
    );
  });

  it("suggests reviewing intake documents needing confirmation", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          documents: [
            {
              documentId: "doc-1",
              fileName: "piece.pdf",
              detectedCategory: "annexes",
              confidence: 0.4,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Faible confiance"],
            },
          ],
        }),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "review_intake")).toEqual(
      expect.objectContaining({
        label: "Confirmer 1 piece a revoir",
        target: {
          kind: "navigate",
          href: "/dashboard/affaires/proj-42?intakeFilter=a_revoir#intake",
        },
      }),
    );
  });

  it("keeps intake suggestions hidden when the workspace failed to load", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        hasIntakeWorkspaceError: true,
        intakeWorkspace: null,
        approvalSummary: makeApprovalSummary(true),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "add_files")).toBeUndefined();
    expect(result.find((suggestion) => suggestion.intent === "review_intake")).toBeUndefined();
    expect(
      result.find((suggestion) => suggestion.intent === "add_missing_pieces"),
    ).toBeUndefined();
    expect(result.find((suggestion) => suggestion.intent === "confirm_brief")).toBeUndefined();
    expect(result.find((suggestion) => suggestion.intent === "prepare_validation")).toEqual(
      expect.objectContaining({
        target: { kind: "open_surface", surfaceId: "approval-submit" },
      }),
    );
  });

  it("suggests confirming the brief when it is pending confirmation", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          briefDraft: {
            status: "a_confirmer",
            summary: "Resume",
            projectObject: "Objet",
            scope: ["GO"],
            lots: ["GO"],
            receivedPieces: ["DPGF.pdf"],
            assumptions: ["Hypothese"],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "upload-1",
            lastGeneratedAt: null,
            confirmedAt: null,
          },
        }),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "confirm_brief")).toEqual(
      expect.objectContaining({
        target: { kind: "open_surface", surfaceId: "brief-confirm" },
        requiresConfirmation: true,
      }),
    );
  });

  it("suggests generating the estimate structure when V0 can be generated", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        currentVersion: { id: "version-1", status: "draft" },
        versionZeroSummary: makeVersionZeroSummary({ canGenerate: true }),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "generate_structure")).toEqual(
      expect.objectContaining({
        label: "Generer la structure du devis",
        target: {
          kind: "navigate",
          href: "/dashboard/estimates/version-1/edit?openVersionZero=1",
        },
      }),
    );
  });

  it("surfaces critical hypotheses before takeoff follow-up", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace(),
        registerSummary: makeRegisterSummary({
          openQuestionsCount: 4,
          criticalOpenCount: 2,
        }),
      }),
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        intent: "list_hypotheses",
        label: "Traiter 2 hypotheses critiques",
        target: {
          kind: "navigate",
          href: "/dashboard/affaires/proj-42?registerStatus=open&registerSeverity=critical#register",
        },
      }),
    );
  });

  it("keeps analyze plans and prepare validation on open surfaces", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        plansSummary: makePlansSummary({ latestJob: null }),
        approvalSummary: makeApprovalSummary(true),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "analyze_plans")).toEqual(
      expect.objectContaining({
        target: { kind: "open_surface", surfaceId: "launch-metre" },
      }),
    );
    expect(result.find((suggestion) => suggestion.intent === "prepare_validation")).toEqual(
      expect.objectContaining({
        target: { kind: "open_surface", surfaceId: "approval-submit" },
        requiresConfirmation: true,
      }),
    );
  });

  it("applies hidden and pinned preferences after computing suggestions", () => {
    const suggestions = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          uploadId: null,
          documents: [],
        }),
        approvalSummary: makeApprovalSummary(true),
      }),
    );

    const result = applyCockpitSuggestionPreferences({
      suggestions,
      preferences: [
        {
          actionId: "prepare-validation",
          isHidden: false,
          isPinned: true,
        },
        {
          actionId: "add-files",
          isHidden: true,
          isPinned: false,
        },
      ],
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        actionId: "prepare-validation",
        isPinned: true,
      }),
    );
    expect(
      result.find((suggestion) => suggestion.actionId === "add-files"),
    ).toEqual(expect.objectContaining({ isHidden: true }));
  });
});
