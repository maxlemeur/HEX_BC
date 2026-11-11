import { describe, expect, it } from "vitest";

import type { EstimateSendGatingResult } from "@/lib/estimates/gating";
import { ESTIMATE_STATUS_VALUES, type EstimateStatus } from "@/lib/estimates/status";
import {
  assertEstimateForceSendAllowed,
  assertEstimateStatusTransition,
  resolveEstimateSendOverride,
  resolveStatusEventType,
} from "@/lib/estimates/version-lifecycle-plan";

const transitions: Array<[EstimateStatus, EstimateStatus]> = [
  ["draft", "sent"],
  ["sent", "accepted"],
  ["sent", "archived"],
  ["accepted", "archived"],
];

function gating(blocked: boolean): EstimateSendGatingResult {
  return {
    canSend: !blocked,
    blockingFlags: blocked ? [{
      key: "critical_open_questions",
      severity: "blocking",
      count: 1,
      item_ids: [],
      label: "Question ouverte",
      description: "Clarification requise",
    }] : [],
    warningFlags: [],
    stalePriceDays: 90,
    checkedAt: "2026-10-28T12:00:00.000Z",
  };
}

describe("manual estimate lifecycle decisions", () => {
  it.each(transitions)("allows %s -> %s with a journal event", (from, to) => {
    expect(() => assertEstimateStatusTransition(from, to)).not.toThrow();
    expect(resolveStatusEventType(to)).toBe(to);
  });

  const unsupported = ESTIMATE_STATUS_VALUES.flatMap((from) =>
    ESTIMATE_STATUS_VALUES.filter((to) =>
      !transitions.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to)
    ).map((to) => [from, to] as const)
  );

  it.each(unsupported)("rejects %s -> %s outside the manual lifecycle", (from, to) => {
    expect(() => assertEstimateStatusTransition(from, to)).toThrow(
      `Transition de statut invalide: ${from} -> ${to}.`
    );
  });

  it("does not journal draft or the email outbox's sending state as a manual status event", () => {
    expect(resolveStatusEventType("draft")).toBeNull();
    expect(resolveStatusEventType("sending")).toBeNull();
  });

  it("requires admin rights for a requested override even when gating is clear", () => {
    expect(() => assertEstimateForceSendAllowed(true, false)).toThrowError(
      expect.objectContaining({ status: 403, code: "FORCE_SEND_FORBIDDEN" })
    );
    expect(() => assertEstimateForceSendAllowed(true, true)).not.toThrow();
    expect(() => assertEstimateForceSendAllowed(undefined, false)).not.toThrow();
  });

  it("retains the complete gating evidence when an unforced send is blocked", () => {
    const result = gating(true);
    expect(() => resolveEstimateSendOverride(result, undefined)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: "ESTIMATE_GATING_BLOCKED",
        details: { gating: result },
      })
    );
  });

  it("records only the blockers actually bypassed by an allowed override", () => {
    expect(resolveEstimateSendOverride(gating(true), true)).toEqual({
      forcedByAdmin: true,
      forcedBlockingFlags: ["critical_open_questions"],
    });
    expect(resolveEstimateSendOverride(gating(false), true)).toEqual({
      forcedByAdmin: false,
      forcedBlockingFlags: [],
    });
  });

  // TI-682 (D25): a « Non chiffrée » line is classified, never forced past the gate, not even by an administrator.
  it("refuses an admin override while a « Non chiffrée » line is still to classify", () => {
    const blocked = gating(true);
    const result: EstimateSendGatingResult = {
      ...blocked,
      blockingFlags: [...blocked.blockingFlags, {
        key: "not_priced_unclassified",
        severity: "blocking",
        count: 1,
        item_ids: ["line-1"],
        label: "Lignes non chiffrées à classer",
        description: "À classer",
      }],
    };
    expect(() => resolveEstimateSendOverride(result, true)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        details: { gating: result, not_forceable: ["not_priced_unclassified"] },
      })
    );
  });
  // TI-682, lot C (D25): an excluded necessary service says why before it leaves; no administrator sends it without.
  it("refuses an admin override while an excluded line has no internal reason", () => {
    const blocked = gating(true);
    const result: EstimateSendGatingResult = {
      ...blocked,
      blockingFlags: [...blocked.blockingFlags, {
        key: "excluded_without_reason",
        severity: "blocking",
        count: 1,
        item_ids: ["line-1"],
        label: "Motif interne d'exclusion à saisir",
        description: "À justifier",
      }],
    };
    expect(() => resolveEstimateSendOverride(result, true)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        details: { gating: result, not_forceable: ["excluded_without_reason"] },
        message: expect.stringContaining("motif interne"),
      })
    );
  });
  // TI-682, lot C, PR 4 (D10, D28): a reserve with empty limits is a text to write, never an anomaly to accept.
  it("refuses to force a send whose reserved lines have no limits text, by name", () => {
    const blocked = gating(true);
    const result: EstimateSendGatingResult = {
      ...blocked,
      blockingFlags: [{
        key: "offer_limits_required",
        severity: "blocking",
        count: 1,
        item_ids: ["line-1"],
        label: "Précisions et limites de prestation à rédiger",
        description: "À rédiger",
      }],
    };
    expect(() => resolveEstimateSendOverride(result, true)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        details: { gating: result, not_forceable: ["offer_limits_required"] },
        message: expect.stringContaining("« Précisions et limites de prestation » est vide"),
      })
    );
    expect(() => resolveEstimateSendOverride(result, false)).toThrowError(
      expect.objectContaining({ code: "ESTIMATE_GATING_BLOCKED" }));
  });
});
