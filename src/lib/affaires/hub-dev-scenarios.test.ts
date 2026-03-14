import { describe, expect, it } from "vitest";

import { computeCockpitSuggestions } from "@/lib/cockpit/suggestions";

import {
  applyAffaireHubDevScenario,
  buildAffaireHubDevScenarioRegisterPage,
  parseAffaireHubDevScenario,
} from "./hub-dev-scenarios";

const baseSummary = {
  project: {
    id: "project-dev",
    name: "Affaire dev",
    reference: "DEV-001",
    clientName: "Client test",
  },
  currentVersion: {
    id: "version-dev",
    projectId: "project-dev",
    versionNumber: 1,
    status: "draft" as const,
    totalHtCents: 0,
    marginMultiplier: 1,
    marginPercent: 0,
    updatedAt: "2026-03-11T09:00:00.000Z",
  },
  acceptedVersion: null,
  versionsCount: 1,
  lineCount: 0,
};

describe("hub dev scenarios", () => {
  it("parses only allowed dev scenarios", () => {
    expect(parseAffaireHubDevScenario("review")).toBe("review");
    expect(parseAffaireHubDevScenario("plans-ready")).toBe("plans-ready");
    expect(parseAffaireHubDevScenario("dpgf-primary-plus-secondary-review-dpgf")).toBe(
      "dpgf-primary-plus-secondary-review-dpgf"
    );
    expect(parseAffaireHubDevScenario("multiple-dpgf-no-primary")).toBe(
      "multiple-dpgf-no-primary"
    );
    expect(parseAffaireHubDevScenario("crowded-review-missing")).toBe(
      "crowded-review-missing"
    );
    expect(parseAffaireHubDevScenario("accepted-with-hypothesis")).toBe(
      "accepted-with-hypothesis"
    );
    expect(parseAffaireHubDevScenario("clarify-client")).toBe("clarify-client");
    expect(parseAffaireHubDevScenario("revalidation-required")).toBe(
      "revalidation-required"
    );
    expect(parseAffaireHubDevScenario("unknown")).toBeNull();
    expect(parseAffaireHubDevScenario(undefined)).toBeNull();
  });

  it("builds a review scenario that surfaces review intake as next action", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "review",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(suggestions.some((suggestion) => suggestion.intent === "review_intake")).toBe(true);
    expect(overrides.intakeWorkspace.documents).toHaveLength(1);
    expect(overrides.intakeWorkspace.documents[0]?.detectedCategory).toBe("a_classer");
  });

  it("builds a synthetic register page for the accepted-with-hypothesis scenario", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "accepted-with-hypothesis",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const registerPage = buildAffaireHubDevScenarioRegisterPage({
      scenario: "accepted-with-hypothesis",
      versionId: overrides.summary.currentVersion?.id ?? null,
      summary: overrides.registerSummary,
    });

    expect(registerPage.summary).toEqual(overrides.registerSummary);
    expect(registerPage.items).toHaveLength(1);
    expect(registerPage.items[0]).toMatchObject({
      kind: "assumption",
      status: "open",
      continuationDecision: {
        status: "accepted_with_hypothesis",
      },
    });
    expect(registerPage.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "continued_with_hypothesis",
          entryId: registerPage.items[0]?.id,
        }),
      ]),
    );
  });

  it("filters the synthetic register page for a clarification scenario", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "clarify-client",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const filteredPage = buildAffaireHubDevScenarioRegisterPage({
      scenario: "clarify-client",
      versionId: overrides.summary.currentVersion?.id ?? null,
      summary: overrides.registerSummary,
      filters: {
        status: "clarify_with_client",
        kind: "assumption",
      },
    });

    expect(filteredPage.items).toHaveLength(1);
    expect(filteredPage.items[0]).toMatchObject({
      status: "clarify_with_client",
      clientClarificationRequest: {
        status: "clarify_with_client",
      },
    });
  });

  it("keeps only revalidation entries when the revalidation filter is active", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "revalidation-required",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const filteredPage = buildAffaireHubDevScenarioRegisterPage({
      scenario: "revalidation-required",
      versionId: overrides.summary.currentVersion?.id ?? null,
      summary: overrides.registerSummary,
      filters: {
        revalidationRequired: true,
      },
    });

    expect(filteredPage.items).toHaveLength(1);
    expect(filteredPage.items[0]).toMatchObject({
      revalidationRequest: {
        status: "required",
        impactedStages: ["document_review", "submission_readiness"],
      },
    });
  });

  it("builds a review-and-missing scenario with both an ambiguous document and missing pieces", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "review-and-missing",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.intakeWorkspace.documents[0]?.detectedCategory).toBe("a_classer");
    expect(overrides.summary.hubReadiness).toMatchObject({
      status: "not_ready",
      intake: {
        reviewDocumentsCount: 1,
        confirmedCriticalMissingPiecesCount: 2,
      },
    });
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_dpgf", severity: "critical" }),
        expect.objectContaining({ code: "missing_plans", severity: "critical" }),
        expect.objectContaining({ code: "missing_cctp", severity: "warning" }),
      ]),
    );
    expect(suggestions.some((suggestion) => suggestion.intent === "review_intake")).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.intent === "add_missing_pieces")).toBe(true);
  });

  it("builds a cctp-confirmed-review-dpgf-missing scenario", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "cctp-confirmed-review-dpgf-missing",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(2);
    expect(overrides.intakeWorkspace.documents.map((document) => document.detectedCategory)).toEqual(
      expect.arrayContaining(["cctp", "a_classer"]),
    );
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_dpgf", severity: "critical" }),
      ]),
    );
    expect(suggestions.some((suggestion) => suggestion.intent === "review_intake")).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.intent === "add_missing_pieces")).toBe(true);
  });

  it("builds a dpgf-confirmed-review-plans-missing scenario", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "dpgf-confirmed-review-plans-missing",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(2);
    expect(overrides.intakeWorkspace.documents.map((document) => document.detectedCategory)).toEqual(
      expect.arrayContaining(["dpgf", "a_classer"]),
    );
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_plans", severity: "critical" }),
      ]),
    );
    expect(suggestions.some((suggestion) => suggestion.intent === "review_intake")).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.intent === "add_missing_pieces")).toBe(true);
  });

  it("builds a mixed scenario with a DPGF principal, a DPGF complementary and a review document", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "dpgf-primary-plus-secondary-review-dpgf",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(3);
    expect(
      overrides.intakeWorkspace.documents.filter(
        (document) => document.detectedCategory === "dpgf" && document.documentPriority === "primary"
      )
    ).toHaveLength(1);
    expect(
      overrides.intakeWorkspace.documents.filter(
        (document) => document.detectedCategory === "dpgf" && document.documentPriority === "secondary"
      )
    ).toHaveLength(1);
    expect(
      overrides.intakeWorkspace.documents.some(
        (document) => document.detectedCategory === "a_classer"
      )
    ).toBe(true);
  });

  it("builds a scenario with multiple DPGF and no primary", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "multiple-dpgf-no-primary",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(2);
    expect(
      overrides.intakeWorkspace.documents.filter(
        (document) => document.detectedCategory === "dpgf" && document.documentPriority === "primary"
      )
    ).toHaveLength(0);
    expect(
      overrides.intakeWorkspace.documents.filter(
        (document) => document.detectedCategory === "dpgf" && document.documentPriority === "secondary"
      )
    ).toHaveLength(2);
  });

  it("builds a validated + multi review + missing scenario", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "validated-review-missing-multi",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(
      overrides.intakeWorkspace.documents.filter((document) => document.detectedCategory === "a_classer")
    ).toHaveLength(2);
    expect(
      overrides.intakeWorkspace.documents.some(
        (document) => document.detectedCategory === "dpgf" && document.documentPriority === "primary"
      )
    ).toBe(true);
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_plans", severity: "critical" }),
      ]),
    );
  });

  it("builds a crowded review scenario with hidden validated and review overflow", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "crowded-review-missing",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(
      overrides.intakeWorkspace.documents.filter((document) => document.detectedCategory !== "a_classer")
    ).toHaveLength(5);
    expect(
      overrides.intakeWorkspace.documents.filter((document) => document.detectedCategory === "a_classer")
    ).toHaveLength(3);
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_plans", severity: "critical" }),
      ]),
    );
  });

  it("builds a plans-confirmed-review-dpgf-missing scenario", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "plans-confirmed-review-dpgf-missing",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(2);
    expect(overrides.intakeWorkspace.documents.map((document) => document.detectedCategory)).toEqual(
      expect.arrayContaining(["plans", "a_classer"]),
    );
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_dpgf", severity: "critical" }),
      ]),
    );
    expect(suggestions.some((suggestion) => suggestion.intent === "review_intake")).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.intent === "add_missing_pieces")).toBe(true);
  });

  it("builds a dpgf-only scenario with plans missing", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "dpgf-only",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(1);
    expect(overrides.intakeWorkspace.documents[0]?.detectedCategory).toBe("dpgf");
    expect(overrides.intakeWorkspace.missingPieces.map((piece) => piece.code)).toContain(
      "missing_plans",
    );
  });

  it("builds a plans-only scenario with dpgf critical and cctp warning", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "plans-only",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(1);
    expect(overrides.intakeWorkspace.documents[0]?.detectedCategory).toBe("plans");
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_dpgf", severity: "critical" }),
        expect.objectContaining({ code: "missing_cctp", severity: "warning" }),
      ]),
    );
  });

  it("builds a cctp-only scenario with dpgf and plans critical", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "cctp-only",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(overrides.intakeWorkspace.documents).toHaveLength(1);
    expect(overrides.intakeWorkspace.documents[0]?.detectedCategory).toBe("cctp");
    expect(overrides.intakeWorkspace.missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_dpgf", severity: "critical" }),
        expect.objectContaining({ code: "missing_plans", severity: "critical" }),
      ]),
    );
  });

  it("builds a brief-confirmed scenario ready for structure generation", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "brief-confirmed",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.intakeWorkspace.briefDraft?.status).toBe("confirme");
    expect(overrides.summary.hubReadiness).toMatchObject({
      status: "ready_with_reservations",
      briefStatus: "confirme",
      allowsContinuation: true,
      register: {
        criticalOpenCount: 2,
      },
    });
    expect(overrides.versionZeroSummary?.canGenerate).toBe(true);
    expect(overrides.registerSummary).toEqual(
      expect.objectContaining({
        criticalOpenCount: 2,
        openMissingPieceCount: 2,
      }),
    );
    expect(
      suggestions.some((suggestion) => suggestion.intent === "generate_structure"),
    ).toBe(true);
  });

  it("builds an accepted-with-hypothesis scenario with degraded but continued hub readiness", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "accepted-with-hypothesis",
      projectId: "project-dev",
      summary: baseSummary,
    });

    expect(overrides.summary.hubReadiness).toMatchObject({
      status: "ready_with_reservations",
      allowsContinuation: true,
      register: {
        continuedWithHypothesisCount: 1,
      },
    });
    expect(overrides.registerSummary).toEqual(
      expect.objectContaining({
        continuedWithHypothesisCount: 1,
      }),
    );
  });

  it("builds a clarify-client scenario with a canonical clarification driver", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "clarify-client",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.summary.hubReadiness).toMatchObject({
      status: "ready_with_reservations",
      drivers: [expect.objectContaining({ code: "client_clarification" })],
    });
    expect(suggestions.find((suggestion) => suggestion.actionId === "list-clarifications")).toBeTruthy();
  });

  it("builds a revalidation-required scenario with a canonical revalidation driver", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "revalidation-required",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.summary.hubReadiness).toMatchObject({
      status: "ready_with_reservations",
      drivers: [expect.objectContaining({ code: "revalidation_required" })],
    });
    expect(suggestions.find((suggestion) => suggestion.actionId === "review-revalidation")).toBeTruthy();
  });

  it("builds a plans-ready scenario ready for takeoff launch", () => {
    const overrides = applyAffaireHubDevScenario({
      scenario: "plans-ready",
      projectId: "project-dev",
      summary: baseSummary,
    });

    const suggestions = computeCockpitSuggestions({
      projectId: "project-dev",
      takeoffEnabled: true,
      isReadOnlyReview: false,
      plansSummary: overrides.plansSummary,
      registerSummary: overrides.registerSummary,
      approvalSummary: overrides.approvalSummary,
      intakeWorkspace: overrides.intakeWorkspace,
      versionZeroSummary: overrides.versionZeroSummary,
      currentVersion: {
        id: overrides.summary.currentVersion!.id,
        status: overrides.summary.currentVersion!.status,
      },
      lineCount: overrides.summary.lineCount,
      preferences: [],
    });

    expect(overrides.plansSummary?.planSetCount).toBe(1);
    expect(overrides.plansSummary?.latestJob).toBeNull();
    expect(suggestions.some((suggestion) => suggestion.intent === "analyze_plans")).toBe(true);
  });
});
