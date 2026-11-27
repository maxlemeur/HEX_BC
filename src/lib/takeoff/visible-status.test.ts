import { describe, expect, it } from "vitest";

import {
  describeTakeoffJobFailure, getTakeoffFailureReasonLabel, isTakeoffKeyStopMessage, takeoffCompletionFailureReason, TAKEOFF_KEY_STOP_MESSAGES,
} from "@/lib/takeoff/visible-status";

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

  it("shows why a request paid by a key stopped, as its worker recorded it, and no other stored text", () => {
    const stops = Object.values(TAKEOFF_KEY_STOP_MESSAGES);
    expect(new Set(stops).size).toBe(3);
    for (const message of stops) {
      expect(getTakeoffFailureReasonLabel({ errorCode: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", fallbackMessage: message })).toBe(message);
      // What to do follows what happened.
      expect(message).toMatch(/Les résultats déjà enregistrés sont conservés\. Pour lire ce qui manque, lancez une nouvelle demande\.$/u);
      // The same text under another code is not shown.
      expect(getTakeoffFailureReasonLabel({ errorCode: "AI_PROVIDER", fallbackMessage: message })).toBe("Le service d’analyse n’a pas pu terminer le métré.");
    }
    // A plan's request stopped by its budget keeps its fact: the plan's ledger records another text.
    expect(getTakeoffFailureReasonLabel({ errorCode: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", fallbackMessage: "FICTIONAL_PLAN_MARKER" }))
      .toBe("Le budget de cette analyse était épuisé : ce plan n’a pas été lu en entier.");
  });

  // Follow-up of #684's review: where a screen reads a plan's code alone and knows a key paid it, the plan does not say
  // « budget épuisé » for a stop at the confirmed calls or at a call over its bound; it names no limit.
  it("tells a plan stopped at a limit of a key's request without naming the limit, where only its code is read", () => {
    const neutral = "Une limite de cette demande payée avec la clé API OpenAI est atteinte : le motif est indiqué sur ce plan dans le suivi du métré.";
    expect(describeTakeoffJobFailure("TAKEOFF_REQUEST_BUDGET_EXHAUSTED", { paidWithKey: true })).toBe(neutral);
    expect(describeTakeoffJobFailure("TAKEOFF_REQUEST_BUDGET_EXHAUSTED"))
      .toBe("Le budget de cette analyse était épuisé : ce plan n’a pas été lu en entier.");
    expect(describeTakeoffJobFailure("AI_TIMEOUT", { paidWithKey: true })).toBe("Délai dépassé.");
  });

  it("recognises the three stops of a key's request as written, and no other text", () => {
    for (const message of Object.values(TAKEOFF_KEY_STOP_MESSAGES)) expect(isTakeoffKeyStopMessage(message)).toBe(true);
    for (const other of [null, undefined, "", "FICTIONAL_PLAN_MARKER", `${TAKEOFF_KEY_STOP_MESSAGES.dollarCeiling} `,
      "Le budget de cette analyse était épuisé : ce plan n’a pas été lu en entier."]) {
      expect(isTakeoffKeyStopMessage(other)).toBe(false);
    }
  });
});
