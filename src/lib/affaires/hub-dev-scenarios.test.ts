import { describe, expect, it } from "vitest";

import { computeCockpitSuggestions } from "@/lib/cockpit/suggestions";

import {
  applyAffaireHubDevScenario,
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
    expect(overrides.versionZeroSummary?.canGenerate).toBe(true);
    expect(overrides.registerSummary).toEqual(
      expect.objectContaining({
        criticalOpenCount: 2,
        openMissingPieceCount: 4,
      }),
    );
    expect(
      suggestions.some((suggestion) => suggestion.intent === "generate_structure"),
    ).toBe(true);
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
