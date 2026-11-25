import { describe, expect, it } from "vitest";

import { describeTakeoffJobFailure, getTakeoffFailureReasonLabel, takeoffCompletionFailureReason } from "@/lib/takeoff/visible-status";

const CODES = ["AI_PROVIDER", "AI_RATE_LIMIT", "FORBIDDEN", "INTERNAL_ERROR", "TAKEOFF_WORKER_NOT_STARTED", "TAKEOFF_WORKER_OUTCOME_UNKNOWN",
  "TAKEOFF_FILE_TYPE_INVALID", "TAKEOFF_PDF_CORRUPTED", "TAKEOFF_PDF_NOT_INTERPRETABLE", "TAKEOFF_FILE_TOO_LARGE", "AI_SCHEMA",
  "TAKEOFF_LEVEL_C_INVALID_SCHEMA", "AI_TIMEOUT", "TAKEOFF_LEVEL_C_TIMEOUT", "AI_SAFETY", "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED", "SOME_FUTURE_CODE", null];
const INSTRUCTION = /Relancez|relancer|Réexportez|Importez|Restreignez|Vérifiez|Changez|Essayez|Préparez|Découpez|découpez/;

// Fix round 2, point 1: a failure says what happened, wherever it is shown (the affaire's overview, the notifications,
// the activity); only the resume decision says what to do, where it is known.
describe("failure texts", () => {
  it.each(CODES)("say what happened to %s, never what to do", (code) => {
    for (const text of [getTakeoffFailureReasonLabel({ errorCode: code }), takeoffCompletionFailureReason(code), describeTakeoffJobFailure(code)]) {
      if (text) expect(text).not.toMatch(INSTRUCTION);
    }
    const fallback = getTakeoffFailureReasonLabel({ errorCode: null, fallbackMessage: "Raw provider text" });
    expect(fallback).not.toMatch(INSTRUCTION);
  });

  it("keeps the facts the journeys read", () => {
    expect(getTakeoffFailureReasonLabel({ errorCode: "AI_PROVIDER" })).toBe("Le service d’analyse n’a pas pu terminer le métré.");
    expect(takeoffCompletionFailureReason("AI_SAFETY")).toBe("Document bloqué pendant l'analyse.");
    expect(getTakeoffFailureReasonLabel({ errorCode: "AI_TIMEOUT" })).toBe("Délai dépassé.");
  });

  it("shows only the fixed message for a plan whose provider answer was rejected", () => {
    const message = "La réponse de l’analyse n’est pas exploitable pour ce plan et le métré peut être relancé.";
    expect(getTakeoffFailureReasonLabel({ errorCode: "TAKEOFF_LEVEL_C_INVALID_SCHEMA", fallbackMessage: message })).toBe(message);
    expect(getTakeoffFailureReasonLabel({ errorCode: "TAKEOFF_LEVEL_C_INVALID_SCHEMA", fallbackMessage: "FICTIONAL_PLAN_MARKER" }))
      .toBe("Extraction incomplète sur ce document.");
  });
});
