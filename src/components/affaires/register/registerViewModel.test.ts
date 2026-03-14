import { describe, expect, it } from "vitest";

import { buildDerivedSummary } from "./registerViewModel";

describe("buildDerivedSummary", () => {
  it("keeps revalidation entries out of generic open totals", () => {
    const summary = buildDerivedSummary([
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "missing_piece",
        code: "missing_dpgf",
        text: "DPGF manquant",
        severity: "critical",
        status: "open",
        originKind: "system",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: null,
        createdBy: null,
        createdByName: null,
        updatedBy: null,
        updatedByName: null,
        createdAt: "2026-03-14T08:00:00.000Z",
        updatedAt: "2026-03-14T08:00:00.000Z",
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-14T08:00:00.000Z",
          requestedByUserId: null,
          previousStatus: "validated",
          cause: "addendum_received",
          triggerDocumentId: null,
          triggerFileName: null,
          impactedStages: ["submission_readiness"],
          comment: null,
        },
        history: [],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "assumption",
        code: null,
        text: "Phasage a confirmer",
        severity: "warning",
        status: "open",
        originKind: "manual",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: null,
        createdBy: null,
        createdByName: null,
        updatedBy: null,
        updatedByName: null,
        createdAt: "2026-03-14T08:05:00.000Z",
        updatedAt: "2026-03-14T08:05:00.000Z",
        history: [],
      },
    ]);

    expect(summary.openQuestionsCount).toBe(1);
    expect(summary.criticalOpenCount).toBe(0);
    expect(summary.nonCriticalOpenCount).toBe(1);
    expect(summary.openAssumptionCount).toBe(1);
    expect(summary.openMissingPieceCount).toBe(0);
    expect(summary.revalidationRequiredCount).toBe(1);
    expect(summary.criticalRevalidationRequiredCount).toBe(1);
  });
});
