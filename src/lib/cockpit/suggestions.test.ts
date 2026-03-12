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
  it("does not suggest adding files when the dossier is empty (dropzone handles that)", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          uploadId: null,
          documents: [],
        }),
      }),
    );

    expect(result.find((s) => s.intent === "add_files")).toBeUndefined();
  });

  it("suggests adding files when documents already exist", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace(),
      }),
    );

    expect(result.find((s) => s.intent === "add_files")).toEqual(
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
              classificationStatus: "ambiguous",
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

  it("does not derive a review action when the persisted status is already classified", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          documents: [
            {
              documentId: "doc-1",
              fileName: "piece.pdf",
              detectedCategory: "annexes",
              classificationStatus: "classified",
              confidence: 0.4,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Faible confiance initiale"],
            },
          ],
        }),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "review_intake")).toBeUndefined();
  });

  it("surfaces failed classifications in the intake review suggestion", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          documents: [
            {
              documentId: "doc-1",
              fileName: "piece.pdf",
              detectedCategory: "plans",
              classificationStatus: "failed",
              confidence: 0.95,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["OCR indisponible"],
            },
          ],
        }),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "review_intake")).toEqual(
      expect.objectContaining({
        label: "Confirmer 1 piece a revoir",
      }),
    );
  });

  it("softens missing-piece wording when review can still lift a critical missing", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace({
          documents: [
            {
              documentId: "doc-1",
              fileName: "bordereau.xlsx",
              detectedCategory: "dpgf",
              classificationStatus: "ambiguous",
              confidence: 0.41,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Categorie a confirmer"],
            },
            {
              documentId: "doc-2",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              classificationStatus: "classified",
              confidence: 0.96,
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
          missingPieces: [
            { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
            { code: "missing_cctp", label: "CCTP non detecte", severity: "warning" },
          ],
          readiness: {
            reviewDocumentsCount: 1,
            missingPiecesCount: 2,
            criticalMissingPiecesCount: 1,
            provisionalMissingPiecesCount: 1,
            provisionalCriticalMissingPiecesCount: 1,
            confirmedMissingPiecesCount: 1,
            confirmedCriticalMissingPiecesCount: 0,
            reviewCouldLiftCriticalMissing: true,
            reviewBeforeMissing: true,
            dominantAction: "review",
            hubReadinessImpact: "critical",
          },
        }),
      }),
    );

    expect(result.find((suggestion) => suggestion.intent === "review_intake")).toEqual(
      expect.objectContaining({
        label: "Confirmer 1 piece a revoir",
      }),
    );
    expect(result.find((suggestion) => suggestion.intent === "add_missing_pieces")).toEqual(
      expect.objectContaining({
        label: "Ajouter 2 pieces manquantes",
        preview: "1 piece reste vraiment manquante; 1 sera a reconfirmer apres review.",
      }),
    );
  });

  it("keeps intake suggestions hidden when the workspace failed to load", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        hasIntakeWorkspaceError: true,
        intakeWorkspace: null,
        approvalSummary: makeApprovalSummary(true),
        lineCount: 5,
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

    expect(result.find((s) => s.intent === "list_hypotheses")).toEqual(
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

  it("surfaces client clarifications before generic open hypotheses", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace(),
        registerSummary: makeRegisterSummary({
          openQuestionsCount: 4,
          criticalOpenCount: 1,
          clarifyWithClientCount: 2,
          criticalClarifyWithClientCount: 1,
        }),
      }),
    );

    expect(result.find((s) => s.actionId === "list-clarifications")).toEqual(
      expect.objectContaining({
        intent: "list_hypotheses",
        label: "Traiter 2 clarifications client",
        preview: "Des clarifications critiques restent a porter vers le client avant envoi.",
        target: {
          kind: "navigate",
          href: "/dashboard/affaires/proj-42?registerStatus=clarify_with_client#register",
        },
      }),
    );
  });

  it("keeps analyze plans and prepare validation on open surfaces", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        plansSummary: makePlansSummary({ latestJob: null }),
        approvalSummary: makeApprovalSummary(true),
        lineCount: 10,
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

  it("does not suggest prepare-validation when lineCount is 0", () => {
    const result = computeCockpitSuggestions(
      makeInput({
        approvalSummary: makeApprovalSummary(true),
        lineCount: 0,
      }),
    );

    expect(result.find((s) => s.intent === "prepare_validation")).toBeUndefined();
  });

  it("applies hidden and pinned preferences after computing suggestions", () => {
    const suggestions = computeCockpitSuggestions(
      makeInput({
        intakeWorkspace: makeIntakeWorkspace(),
        approvalSummary: makeApprovalSummary(true),
        lineCount: 5,
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
