import { describe, expect, it } from "vitest";

import {
  buildAffaireRegisterReviewExport,
  buildAffaireRegisterBusinessLocation,
  buildAffaireRegisterDerivedMetadata,
  buildAffaireRegisterHubHref,
  canAffaireRegisterEntryClarifyWithClient,
  buildAffaireRegisterContinuationHypothesisText,
  canAffaireRegisterEntryContinueWithHypothesis,
  canAffaireRegisterEntryRequestRevalidation,
  deriveAffaireRegisterBusinessImpact,
  extractAffaireRegisterBusinessImpact,
  extractAffaireRegisterBusinessLocation,
  extractAffaireRegisterClientClarificationRequest,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterFollowUp,
  extractAffaireRegisterRevalidationRequest,
  extractAffaireRegisterSeverityDecision,
  isAffaireRegisterEntryRevalidationRequired,
  parseAffaireRegisterRevalidationSearchParam,
  resolveAffaireRegisterBusinessLocation,
} from "@/lib/affaires/register";

describe("affaire register continuation contract", () => {
  it("builds a reusable continuation hypothesis from a missing piece label", () => {
    expect(
      buildAffaireRegisterContinuationHypothesisText({
        entryText: "DPGF manquant",
      })
    ).toBe(
      "Continuation acceptee sans dpgf manquant. Hypothese documentaire a confirmer avant remise."
    );
  });

  it("exposes whether a register entry can still continue with hypothesis", () => {
    expect(
      canAffaireRegisterEntryContinueWithHypothesis({
        kind: "missing_piece",
        status: "open",
        continuationDecision: null,
      })
    ).toBe(true);

    expect(
      canAffaireRegisterEntryContinueWithHypothesis({
        kind: "missing_piece",
        status: "open",
        continuationDecision: {
          status: "accepted_with_hypothesis",
          hypothesisEntryId: "11111111-1111-4111-8111-111111111111",
          hypothesisText: "Hypothese",
          acceptedAt: "2026-03-13T09:00:00.000Z",
          acceptedByUserId: "22222222-2222-4222-8222-222222222222",
          comment: null,
        },
      })
    ).toBe(false);
  });

  it("extracts continuation decisions from entry metadata", () => {
    expect(
      extractAffaireRegisterContinuationDecision({
        continuationDecision: {
          status: "accepted_with_hypothesis",
          hypothesisEntryId: "11111111-1111-4111-8111-111111111111",
          hypothesisText: "Hypothese documentaire",
          acceptedAt: "2026-03-13T09:00:00.000Z",
          acceptedByUserId: "22222222-2222-4222-8222-222222222222",
          comment: "Decision tracee.",
        },
      })
    ).toMatchObject({
      status: "accepted_with_hypothesis",
      hypothesisText: "Hypothese documentaire",
      comment: "Decision tracee.",
    });
  });

  it("exposes whether an entry can still be moved to client clarification", () => {
    expect(
      canAffaireRegisterEntryClarifyWithClient({
        status: "open",
        clientClarificationRequest: null,
      })
    ).toBe(true);

    expect(
      canAffaireRegisterEntryClarifyWithClient({
        status: "clarify_with_client",
        clientClarificationRequest: {
          status: "clarify_with_client",
          requestedAt: "2026-03-13T10:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "open",
          comment: "Besoin d'une reponse client.",
        },
      })
    ).toBe(false);
  });

  it("extracts client clarification requests from entry metadata", () => {
    expect(
      extractAffaireRegisterClientClarificationRequest({
        clientClarificationRequest: {
          status: "clarify_with_client",
          requestedAt: "2026-03-13T10:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "open",
          comment: "Besoin d'une reponse client.",
        },
      })
    ).toMatchObject({
      status: "clarify_with_client",
      previousStatus: "open",
      comment: "Besoin d'une reponse client.",
    });
  });

  it("extracts revalidation requests from entry metadata", () => {
    expect(
      extractAffaireRegisterRevalidationRequest({
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-13T11:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "validated",
          cause: "addendum_received",
          triggerDocumentId: "33333333-3333-4333-8333-333333333333",
          triggerFileName: "additif-lot-c.pdf",
          impactedStages: ["document_review", "submission_readiness"],
          comment: "Verifier le lot C apres additif.",
        },
      })
    ).toMatchObject({
      status: "required",
      previousStatus: "validated",
      cause: "addendum_received",
      impactedStages: ["document_review", "submission_readiness"],
    });
  });

  it("exposes whether an entry can still request revalidation", () => {
    expect(
      canAffaireRegisterEntryRequestRevalidation({
        status: "validated",
        revalidationRequest: null,
      })
    ).toBe(true);

    expect(
      canAffaireRegisterEntryRequestRevalidation({
        status: "open",
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-13T11:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "validated",
          cause: "addendum_received",
          triggerDocumentId: null,
          triggerFileName: null,
          impactedStages: ["document_review"],
          comment: null,
        },
      })
    ).toBe(false);

    expect(
      canAffaireRegisterEntryRequestRevalidation({
        status: "open",
        revalidationRequest: null,
      })
    ).toBe(false);
  });

  it("recognizes blocking revalidation entries", () => {
    expect(
      isAffaireRegisterEntryRevalidationRequired({
        status: "clarify_with_client",
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-13T11:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "validated",
          cause: "late_critical_piece",
          triggerDocumentId: null,
          triggerFileName: null,
          impactedStages: ["submission_readiness"],
          comment: null,
        },
      })
    ).toBe(true);

    expect(
      isAffaireRegisterEntryRevalidationRequired({
        status: "validated",
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-13T11:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "validated",
          cause: "late_critical_piece",
          triggerDocumentId: null,
          triggerFileName: null,
          impactedStages: ["submission_readiness"],
          comment: null,
        },
      })
    ).toBe(false);
  });

  it("derives reusable business impacts for missing pieces and client clarifications", () => {
    expect(
      deriveAffaireRegisterBusinessImpact({
        kind: "missing_piece",
        code: "missing_dpgf",
        severity: "critical",
        status: "open",
        clientClarificationRequest: null,
        continuationDecision: null,
        revalidationRequest: null,
      })
    ).toEqual([
      "affects_hub_readiness",
      "blocks_submission",
      "affects_structure_generation",
    ]);

    expect(
      deriveAffaireRegisterBusinessImpact({
        kind: "assumption",
        code: null,
        severity: "warning",
        status: "clarify_with_client",
        clientClarificationRequest: {
          status: "clarify_with_client",
          requestedAt: "2026-03-13T10:00:00.000Z",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          previousStatus: "open",
          comment: "Besoin d'une reponse client.",
        },
        continuationDecision: null,
        revalidationRequest: null,
      })
    ).toEqual(["affects_hub_readiness", "requires_client_answer"]);
  });

  it("packages a structured business location without losing the legacy scope fields", () => {
    expect(
      buildAffaireRegisterBusinessLocation({
        scopeType: "line",
        scopeId: "11111111-1111-4111-8111-111111111111",
        scopeRef: "2.1",
        scopeLabel: "Tableau divisionnaire hall",
        versionId: "22222222-2222-4222-8222-222222222222",
        sourceDocumentId: "33333333-3333-4333-8333-333333333333",
        sourceFileName: "dpgf-hall.xlsx",
      })
    ).toEqual({
      scopeType: "line",
      scopeId: "11111111-1111-4111-8111-111111111111",
      scopeRef: "2.1",
      scopeLabel: "Tableau divisionnaire hall",
      versionId: "22222222-2222-4222-8222-222222222222",
      sourceDocumentId: "33333333-3333-4333-8333-333333333333",
      sourceFileName: "dpgf-hall.xlsx",
    });
  });

  it("extracts persisted business impact and structured location from metadata", () => {
    const metadata = {
      businessImpact: ["affects_hub_readiness", "blocks_submission"],
      structuredLocation: {
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: "plans.pdf",
      },
    };

    expect(extractAffaireRegisterBusinessImpact(metadata)).toEqual([
      "affects_hub_readiness",
      "blocks_submission",
    ]);
    expect(extractAffaireRegisterBusinessLocation(metadata)).toEqual({
      scopeType: "project",
      scopeId: null,
      scopeRef: null,
      scopeLabel: "Affaire test",
      versionId: null,
      sourceDocumentId: null,
      sourceFileName: "plans.pdf",
    });
  });

  it("extracts persisted severity decisions and follow-up data from metadata", () => {
    const metadata = {
      severityDecision: {
        mode: "manual",
        canonicalSeverity: "critical",
        overriddenSeverity: "warning",
        updatedAt: "2026-03-14T10:00:00.000Z",
        updatedByUserId: "11111111-1111-4111-8111-111111111111",
        comment: "Budget exploratoire.",
      },
      followUp: {
        ownerUserId: "22222222-2222-4222-8222-222222222222",
        ownerName: "Marie Curie",
        dueDate: "2026-03-20",
        updatedAt: "2026-03-14T10:05:00.000Z",
        updatedByUserId: "11111111-1111-4111-8111-111111111111",
        comment: "A relancer avant revue.",
      },
    };

    expect(extractAffaireRegisterSeverityDecision(metadata)).toEqual({
      mode: "manual",
      canonicalSeverity: "critical",
      overriddenSeverity: "warning",
      updatedAt: "2026-03-14T10:00:00.000Z",
      updatedByUserId: "11111111-1111-4111-8111-111111111111",
      comment: "Budget exploratoire.",
    });
    expect(extractAffaireRegisterFollowUp(metadata)).toEqual({
      ownerUserId: "22222222-2222-4222-8222-222222222222",
      ownerName: "Marie Curie",
      dueDate: "2026-03-20",
      updatedAt: "2026-03-14T10:05:00.000Z",
      updatedByUserId: "11111111-1111-4111-8111-111111111111",
      comment: "A relancer avant revue.",
    });
  });

  it("resolves business location from live row fields when persisted source references are stale", () => {
    expect(
      resolveAffaireRegisterBusinessLocation({
        metadata: {
          structuredLocation: {
            scopeType: "project",
            scopeId: null,
            scopeRef: null,
            scopeLabel: "Affaire test",
            versionId: null,
            sourceDocumentId: "33333333-3333-4333-8333-333333333333",
            sourceFileName: "plans.pdf",
          },
        },
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: "plans.pdf",
      })
    ).toEqual({
      scopeType: "project",
      scopeId: null,
      scopeRef: null,
      scopeLabel: "Affaire test",
      versionId: null,
      sourceDocumentId: null,
      sourceFileName: "plans.pdf",
    });
  });

  it("persists derived register metadata in a stable shape", () => {
    expect(
      buildAffaireRegisterDerivedMetadata({
        metadata: {
          existing: true,
        },
        kind: "missing_piece",
        code: "missing_plans",
        severity: "critical",
        status: "open",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: "plans.pdf",
        clientClarificationRequest: null,
        continuationDecision: null,
        revalidationRequest: null,
      })
    ).toEqual({
      existing: true,
      businessImpact: [
        "affects_hub_readiness",
        "blocks_submission",
        "affects_takeoff",
      ],
      structuredLocation: {
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: "plans.pdf",
      },
    });
  });

  it("parses and builds revalidation-focused register links", () => {
    expect(parseAffaireRegisterRevalidationSearchParam("required")).toBe(true);
    expect(parseAffaireRegisterRevalidationSearchParam("open")).toBe(false);

    expect(
      buildAffaireRegisterHubHref({
        projectId: "proj-42",
        severity: "critical",
        revalidationRequired: true,
      })
    ).toBe(
      "/dashboard/affaires/proj-42?registerSeverity=critical&registerRevalidation=required"
    );
  });

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
      ],
    });

    expect(exportResult.capabilities.explicitExclusions).toBe("not_supported");
    expect(exportResult.summary).toMatchObject({
      rowCount: 2,
      criticalCount: 1,
      blockingCount: 1,
      clarificationCount: 1,
      hypothesisCount: 1,
      missingPieceCount: 0,
    });
    expect(exportResult.groups.map((group) => group.key)).toEqual([
      "hypothesis",
      "clarification",
    ]);
    expect(exportResult.reviewNote).toContain("Exclusions explicites: non supportees");
    expect(exportResult.reviewNote).toContain("Hypotheses: 1 - Pieces manquantes: 0 - Clarifications: 1");
    expect(exportResult.csvContent).toContain("section;type;severite;statut");
    expect(exportResult.csvContent).toContain("'=Base tarifaire a confirmer");
    expect(exportResult.csvFilename).toBe("registre-revue-aff-42-hydro-express.csv");
  });
});
