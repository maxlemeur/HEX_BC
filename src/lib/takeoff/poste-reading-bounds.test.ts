import { describe, expect, it } from "vitest";

import {
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT,
} from "@/lib/takeoff/constants";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import {
  buildTakeoffLaunchManifest,
  describeTakeoffLaunchReason,
  splitTakeoffLaunchManifest,
  splitTakeoffRequestBudget,
  takeoffPlanWeights,
  type TakeoffLaunchOrder,
} from "@/lib/takeoff/launch-request";
import { posteExchangeOutputMaxBytes } from "@/lib/takeoff/poste-exchange";
import {
  boundPosteReadingRequest,
  POSTE_READING_LIMITS,
  posteReadingBoundsOfManifest,
  posteReadingRefusal,
} from "@/lib/takeoff/poste-reading-bounds";
import { describePosteReadingBounds, posteReadingBoundsDetails, readPosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";
import { takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";

const CHUNKING = { thresholdPages: TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT, chunkSizePages: TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  overlapPages: TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT };

/** The units of a request as lot 3 seals them: one per plan, each its share of the request's envelope by its pages. */
function units(pages: number[], requestTokens = TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT) {
  const shares = splitTakeoffRequestBudget({ tokens: requestTokens, cost_cents: 0 },
    takeoffPlanWeights(pages.map((count) => ({ pages: [], page_count: count }))));
  return pages.map((count, index) => ({ key: `plan:p${index + 1}`, pieces: [{ id: `p${index + 1}`, name: `Plan ${index + 1}` }],
    pages: count, budgetTokens: shares[index].tokens }));
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

  it("admits a request whose every call can start: its plan's share and the request still positive before it", () => {
    const bounds = bound(40, [12, 8, 6]);
    expect(bounds).toMatchObject({ ok: true, calls: 3, exceeded: [], pieces: [] });
    expect(posteReadingRefusal(bounds)).toBeNull();
  });

  it("asks to reduce the scope beyond the budget, naming the plans past their own share, and never samples", () => {
    // 3 plans of 20 pages, 120 items: 27 calls of 30,000 tokens for 400,000; each plan's ninth call finds its share spent.
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

  it("names only the plan whose own share cannot start its calls", () => {
    // 80 items (2 batches): a 30-page plan (4 fragments, 8 calls) gets 375,000 tokens, a 2-page plan (2 calls) 25,000.
    const bounds = bound(80, [30, 2]);
    expect(bounds.units.map((unit) => [unit.calls, unit.exceeded])).toEqual([[8, []], [2, ["budget"]]]);
    expect(bounds).toMatchObject({ ok: false, exceeded: [], pieces: [{ id: "p2", name: "Plan 2" }] });
  });

  it("states the effective limits in French", () => {
    const fr = (value: number) => value.toLocaleString("fr-FR");
    expect(describePosteReadingBounds(bound(120, [20, 20, 20]))).toBe(
      `Lecture de 120 postes sur 3 plans : 27 appels prévus, environ ${fr(810_000)} jetons pour un budget de ${fr(400_000)}. `
      + "Réduisez les plans ou les pages à lire.");
    expect(describePosteReadingBounds(bound(40, [12]))).toBe(`Lecture de 40 postes sur 1 plan : 1 appel prévu, environ ${fr(30_000)} `
      + `jetons pour un budget de ${fr(400_000)}.`);
  });

  it("measures the largest request the default budget admits", () => {
    // What the report gives: 14 calls (the 14th starts with 10,000 tokens left): one plan of up to 15 pages with 560 items,
    // or 14 single-fragment plans of 40 items.
    expect(bound(14 * 40, [15]).ok).toBe(true);
    expect(bound(14 * 40 + 1, [15]).ok).toBe(false);
    expect(bound(40, Array.from({ length: 14 }, () => 15)).ok).toBe(true);
    expect(bound(40, Array.from({ length: 15 }, () => 15)).ok).toBe(false);
  });
});

const LIST: TakeoffLaunchOrder = { kind: "item_list", version: 2, list: { revision_id: "aaaaaaaa-0000-4000-8000-0000000000f1",
  revision: 3, content_sha256: "e".repeat(64), item_count: 120 } };

/** A request's manifest as the seal builds it: plans of these page counts (retained pages for those given). */
function manifest(plans: Array<{ pages?: number[]; count: number | null }>, order: TakeoffLaunchOrder = LIST) {
  const sources = plans.map((plan, index) => takeoffPreparationSourceSchema.parse({
    document_id: `aaaaaaaa-0000-4000-8000-00000000010${index}`, document_name: `Plan ${index + 1}`, kind: "plan", revision: "A",
    source_version: `v${index}`, pages: plan.pages ?? [], active: true, confirmed: true, page_count: plan.count,
    content_hash: String(index).repeat(64) }));
  return buildTakeoffLaunchManifest({ intent: "initial", sources, intakeDocumentByPlanFile: new Map(), omittedPlans: [],
    omittedReferences: [], preparationRevision: 1, budget: { tokens: TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT, cost_cents: 2_500 }, order });
}
const fromManifest = (sealed: Parameters<typeof posteReadingBoundsOfManifest>[0]) =>
  posteReadingBoundsOfManifest(sealed, CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS);

describe("posteReadingBoundsOfManifest", () => {
  it("bounds only a request that seals a list of items", () => {
    expect(fromManifest(manifest([{ count: 20 }], { kind: "free_extraction", version: 1, list: null }))).toBeNull();
    expect(fromManifest(manifest([{ count: 20 }]))).toMatchObject({ ok: true, items: 120, calls: 9 });
  });

  it("bounds each plan of one analysis per plan with its own share, its retained pages first", () => {
    // 80 items: a 30-page plan and a plan of 2 pages retained out of 40, which weighs 2 and gets 25,000 tokens.
    const sealed = splitTakeoffLaunchManifest({ ...manifest([{ count: 30 }, { pages: [4, 5], count: 40 }]),
      order: { ...LIST, list: { ...LIST.list, item_count: 80 } } });
    const bounds = fromManifest(sealed)!;
    expect(sealed.units.map((unit) => unit.budget.tokens)).toEqual([375_000, 25_000]);
    expect(bounds.units.map((unit) => [unit.key, unit.fragments, unit.calls, unit.exceeded])).toEqual([
      [sealed.units[0].key, 4, 8, []], [sealed.units[1].key, 1, 2, ["budget"]]]);
    expect(bounds).toMatchObject({ ok: false, plans: 2, calls: 10, exceeded: [], pieces: [{ id: sealed.plans[1].plan_file_id,
      name: "Plan 2" }] });
  });

  it("bounds a grouped analysis as one unit holding every plan", () => {
    const bounds = fromManifest(manifest([{ count: 6 }, { count: 6 }]))!;
    expect(bounds.units).toEqual([expect.objectContaining({ key: "grouped", fragments: 1, calls: 3 })]);
    expect(bounds).toMatchObject({ ok: true, plans: 2 });
  });
});

describe("the bounds' facts a refusal keeps", () => {
  it("stores numbers only, and reads them back into the same sentence", () => {
    const bounds = bound(120, [20, 20, 20]);
    const stored = posteReadingBoundsDetails(bounds);
    expect(stored).toEqual({ items: 120, plans: 3, calls: 27, tokens: 810_000, request_budget_tokens: 400_000 });
    expect(describePosteReadingBounds(readPosteReadingBoundsFacts(JSON.parse(JSON.stringify(stored)))!))
      .toBe(describePosteReadingBounds(bounds));
  });

  it("ignores stored facts that are not whole numbers", () => {
    expect(readPosteReadingBoundsFacts(undefined)).toBeNull();
    expect(readPosteReadingBoundsFacts({ items: "120", plans: 3, calls: 27, tokens: 1, request_budget_tokens: 1 })).toBeNull();
    expect(readPosteReadingBoundsFacts({ items: 1.5, plans: 3, calls: 27, tokens: 1, request_budget_tokens: 1 })).toBeNull();
  });

  it("tells the member the plans to restrict and the effective limits", () => {
    const bounds = bound(120, [20, 20, 20]);
    expect(describeTakeoffLaunchReason("PLAN_SET_TOO_LARGE", bounds.pieces, bounds)).toBe(
      "Métré non démarré — les plans « Plan 1 », « Plan 2 », « Plan 3 » dépassent les limites d’une lecture contre la liste des "
      + `postes. ${describePosteReadingBounds(bounds)}`);
    // Without facts, as before.
    expect(describeTakeoffLaunchReason("PLAN_SET_TOO_LARGE", bounds.pieces)).toMatch(/limites d’une analyse\. Restreignez-les/);
  });
});
