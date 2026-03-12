import { describe, expect, it } from "vitest";

import {
  buildAffaireRegisterContinuationHypothesisText,
  canAffaireRegisterEntryContinueWithHypothesis,
  extractAffaireRegisterContinuationDecision,
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
});
