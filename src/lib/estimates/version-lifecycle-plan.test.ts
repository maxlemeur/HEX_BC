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
});
