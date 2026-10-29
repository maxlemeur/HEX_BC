import { describe, expect, it } from "vitest";

import { buildAffaireRegisterReviewExport } from "@/lib/affaires/register";

describe("affaire register continuation contract", () => {
  it("builds a reusable review export with grouped reserves and safe csv", () => {
    const exportResult = buildAffaireRegisterReviewExport({
      generatedAt: "2026-03-14T11:00:00.000Z",
      projectId: "proj-42",
      projectLabel: "Hydro Express",
      projectReference: "AFF-42",
      clientName: "Client test",
      versionId: "22222222-2222-4222-8222-222222222222",
      entries: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "assumption",
          code: null,
          text: "=Base tarifaire a confirmer",
          severity: "warning",
          status: "open",
          originKind: "manual",
          scopeType: "project",
          scopeId: null,
          scopeRef: null,
          scopeLabel: "Affaire test",
          versionId: null,
          sourceDocumentId: null,
          sourceFileName: "note-client.pdf",
          createdBy: null,
          createdByName: null,
          updatedBy: null,
          updatedByName: null,
          createdAt: "2026-03-14T09:00:00.000Z",
          updatedAt: "2026-03-14T09:00:00.000Z",
          businessImpact: ["affects_hub_readiness"],
          location: undefined,
          severityDecision: null,
          followUp: {
            ownerUserId: null,
            ownerName: "Marie Curie",
            dueDate: "2026-03-20",
            updatedAt: "2026-03-14T09:00:00.000Z",
            updatedByUserId: null,
            comment: "Verifier avant revue.",
          },
          clientClarificationRequest: null,
          continuationDecision: null,
          revalidationRequest: null,
          history: [],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "missing_piece",
          code: "missing_dpgf",
          text: "DPGF manquant",
          severity: "critical",
          status: "clarify_with_client",
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
          createdAt: "2026-03-14T09:00:00.000Z",
          updatedAt: "2026-03-14T09:00:00.000Z",
          businessImpact: [
            "affects_hub_readiness",
            "blocks_submission",
            "requires_client_answer",
          ],
          location: undefined,
          severityDecision: null,
          followUp: null,
          clientClarificationRequest: {
            status: "clarify_with_client",
            requestedAt: "2026-03-14T09:30:00.000Z",
            requestedByUserId: null,
            previousStatus: "open",
            comment: "Demander le dernier additif client.",
          },
          continuationDecision: null,
          revalidationRequest: null,
          history: [],
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "missing_piece",
          code: null,
          text: "Variante volontairement exclue du perimetre",
          severity: "warning",
          status: "rejected",
          originKind: "manual",
          scopeType: "project",
          scopeId: null,
          scopeRef: null,
          scopeLabel: "Affaire test",
          versionId: null,
          sourceDocumentId: null,
          sourceFileName: "memo-exclusions.pdf",
          createdBy: null,
          createdByName: null,
          updatedBy: null,
          updatedByName: null,
          createdAt: "2026-03-14T09:45:00.000Z",
          updatedAt: "2026-03-14T09:45:00.000Z",
          businessImpact: ["affects_hub_readiness"],
          location: undefined,
          severityDecision: null,
          followUp: null,
          clientClarificationRequest: null,
          continuationDecision: null,
          revalidationRequest: null,
          history: [],
        },
      ],
    });

    expect(exportResult.capabilities.explicitExclusions).toBe("supported");
    expect(exportResult.summary).toMatchObject({
      rowCount: 3,
      criticalCount: 1,
      blockingCount: 1,
      clarificationCount: 1,
      hypothesisCount: 1,
      exclusionCount: 1,
      missingPieceCount: 0,
    });
    expect(exportResult.groups.map((group) => group.key)).toEqual([
      "hypothesis",
      "exclusion",
      "clarification",
    ]);
    expect(exportResult.reviewNote).toContain("Points exportés : 3");
    expect(exportResult.reviewNote).toContain(
      "Hypothèses: 1 - Pièces manquantes: 0 - Clarifications: 1 - Revalidations: 0 - Exclusions: 1"
    );
    expect(exportResult.reviewNote).toContain(
      "- Exclusion / Affaire test: Variante volontairement exclue du perimetre - source memo-exclusions.pdf"
    );
    expect(exportResult.csvContent).toContain("section;type;severite;statut");
    expect(exportResult.csvContent).toContain("'=Base tarifaire a confirmer");
    expect(exportResult.csvContent).toContain(
      "Exclusions;Pièce manquante;Attention;Rejetée;Variante volontairement exclue du perimetre"
    );
    expect(exportResult.csvFilename).toBe("registre-revue-aff-42-hydro-express.csv");
  });
});
