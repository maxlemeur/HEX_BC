import { describe, expect, it } from "vitest";

import {
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT,
} from "@/lib/takeoff/constants";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import { splitTakeoffRequestBudget, takeoffPlanWeights } from "@/lib/takeoff/launch-request";
import { posteExchangeOutputMaxBytes } from "@/lib/takeoff/poste-exchange";
import {
  boundPosteReadingRequest,
  describePosteReadingBounds,
  POSTE_READING_LIMITS,
  posteReadingRefusal,
} from "@/lib/takeoff/poste-reading-bounds";

const CHUNKING = { thresholdPages: TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT, chunkSizePages: TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  overlapPages: TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT };

/** The units of a request as lot 3 seals them: one per plan, each its share of the request's envelope by its pages. */
function units(pages: number[], requestTokens = TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT) {
  const shares = splitTakeoffRequestBudget({ tokens: requestTokens, cost_cents: 0 },
    takeoffPlanWeights(pages.map((count) => ({ pages: [], page_count: count }))));
  return pages.map((count, index) => ({ key: `plan:p${index + 1}`, planId: `p${index + 1}`, name: `Plan ${index + 1}`, pages: count,
    budgetTokens: shares[index].tokens }));
}

const bound = (items: number, pages: number[], requestTokens = TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT) => boundPosteReadingRequest({
  items, units: units(pages, requestTokens), requestBudgetTokens: requestTokens, chunking: CHUNKING,
  estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS });

describe("boundPosteReadingRequest", () => {
  it("counts the calls of a request as the reading makes them: fragments of each plan times batches of items", () => {
    // 120 items in batches of 40; a 20-page plan is read in 3 fragments, a 12-page plan in one.
    const bounds = bound(120, [20, 12]);
    expect(bounds.units.map((unit) => [unit.fragments, unit.batches, unit.calls])).toEqual([[3, 3, 9], [1, 3, 3]]);
    expect(bounds.calls).toBe(12);
    expect(bounds.tokens).toBe(12 * TAKEOFF_PAID_CALL_ESTIMATE_TOKENS);
    expect(bounds.units[1].answerBytes).toBe(3 * posteExchangeOutputMaxBytes(40, 12));
  });

  it("admits a request whose calls' reservations fit its budget and each plan's share", () => {
    const bounds = bound(40, [12, 8, 6]);
    expect(bounds).toMatchObject({ ok: true, calls: 3, exceeded: [], pieces: [] });
    expect(posteReadingRefusal(bounds)).toBeNull();
  });

  it("asks to reduce the scope beyond the budget, naming the plans past their own share, and never samples", () => {
    // 3 plans of 20 pages, 120 items: 27 calls, 810,000 tokens reserved for 400,000.
    const bounds = bound(120, [20, 20, 20]);
    expect(bounds.ok).toBe(false);
    expect(bounds.calls).toBe(27);
    expect(bounds.exceeded).toEqual(["budget"]);
    expect(bounds.units.map((unit) => unit.exceeded)).toEqual([["budget"], ["budget"], ["budget"]]);
    expect(posteReadingRefusal(bounds)).toEqual({ reason: "PLAN_SET_TOO_LARGE",
      pieces: [{ id: "p1", name: "Plan 1" }, { id: "p2", name: "Plan 2" }, { id: "p3", name: "Plan 3" }] });
  });

  it("bounds the calls of one plan and of the request even with a large budget", () => {
    const wide = 1_000_000_000;
    const perPlan = bound(POSTE_READING_LIMITS.callsPerUnit * 40 + 1, [10], wide);
    expect(perPlan.units[0].exceeded).toContain("calls");
    const perRequest = bound(40 * 12, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], wide);
    expect(perRequest.units.every((unit) => unit.exceeded.length === 0)).toBe(true);
    expect(perRequest.exceeded).toEqual(["calls"]);
    expect(posteReadingRefusal(perRequest)?.pieces).toHaveLength(17);
  });

  it("states the effective limits in French", () => {
    const fr = (value: number) => value.toLocaleString("fr-FR");
    expect(describePosteReadingBounds(bound(120, [20, 20, 20]))).toBe(
      `Lecture de 120 postes sur 3 plans : 27 appels prévus, ${fr(810_000)} jetons réservés pour un budget de ${fr(400_000)}. `
      + "Réduisez les plans ou les pages à lire.");
    expect(describePosteReadingBounds(bound(40, [12]))).toBe(`Lecture de 40 postes sur 1 plan : 1 appel prévu, ${fr(30_000)} jetons `
      + `réservés pour un budget de ${fr(400_000)}.`);
  });

  it("measures the largest request the default budget admits", () => {
    // What the report gives: one plan of up to 15 pages with 520 items, or 13 single-fragment plans of 40 items.
    expect(bound(13 * 40, [15]).ok).toBe(true);
    expect(bound(13 * 40 + 1, [15]).ok).toBe(false);
    expect(bound(40, Array.from({ length: 13 }, () => 15)).ok).toBe(true);
    expect(bound(40, Array.from({ length: 14 }, () => 15)).ok).toBe(false);
  });
});
