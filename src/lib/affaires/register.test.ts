import { describe, expect, it } from "vitest";

import {
  buildAffaireRegisterHubHref,
  canAffaireRegisterEntryClarifyWithClient,
  buildAffaireRegisterContinuationHypothesisText,
  canAffaireRegisterEntryContinueWithHypothesis,
  canAffaireRegisterEntryRequestRevalidation,
  extractAffaireRegisterClientClarificationRequest,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  isAffaireRegisterEntryRevalidationRequired,
  parseAffaireRegisterRevalidationSearchParam,
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
});
