import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  TAKEOFF_LAUNCH_VECTOR_PAGES,
  takeoffPlanWeights,
  type TakeoffLaunchOrder,
} from "@/lib/takeoff/launch-request";
import { TAKEOFF_ITEM_ANSWER_LIMITS } from "@/lib/takeoff/item-answer-limits";
import { planPosteBatches, POSTE_EXCHANGE_LIMITS, posteExchangeOutputMaxBytes } from "@/lib/takeoff/poste-exchange";
import { POSTE_WORKER_REASONS } from "@/lib/takeoff/poste-exchange-merge";
import type { Poste } from "@/lib/takeoff/poste-list";
import {
  boundPosteReadingRequest,
  POSTE_READING_BUDGET_MARGIN,
  POSTE_READING_LIMITS,
  POSTE_READING_MAX_FRAGMENTS,
  posteAnswersMaxBytes,
  posteReadingBoundsOfManifest,
  posteReadingRefusal,
  postesAskedBy,
  sizePosteReadingManifest,
} from "@/lib/takeoff/poste-reading-bounds";
import { orderSensitivePosteList } from "@/lib/takeoff/poste-reading.test-fixtures";
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

/** `count` items of the list, of this label. */
function postes(count: number, label = (index: number) => `Poste ${index}`): Poste[] {
  return Array.from({ length: count }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, label: label(index),
    expectedUnit: "u", measurementBasis: null, qualifiers: {}, sections: [], synonyms: [], referenceQuantity: null,
    origin: { kind: "manual", intentId: `i-${index}`, addedBy: "u", addedAt: "2026-11-22T08:00:00.000Z", addedInRevision: 1 } }));
}
const batchesOf = (items: readonly Poste[]) => planPosteBatches(items).map((batch) => batch.length);

const bound = (items: number, pages: number[], requestTokens = TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT) => boundPosteReadingRequest({
  batches: batchesOf(postes(items)), units: units(pages, requestTokens), requestBudgetTokens: requestTokens, chunking: CHUNKING,
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

  // Fix round, point 6: the batches are the reading's own, sized by the items' bytes (a long item is never cut).
  it("counts the batches the reading makes from its items, long items in more of them", () => {
    const long = postes(40, (index) => `${"Fourniture et pose de canalisation cuivre écroui ".repeat(80)} ${index}`);
    const bounds = boundPosteReadingRequest({ batches: batchesOf(long), units: units([12]), requestBudgetTokens: 400_000, chunking: CHUNKING,
      estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS });
    expect(bounds.items).toBe(40);
    expect(bounds.calls).toBe(batchesOf(long).length);
    expect(bounds.calls).toBeGreaterThan(1);
  });

  // Fix round, point 8: every paid call of a plan counts, the vector classifier's included. Budget task: in the budget
  // and the duration; the ceilings count the reading's calls, the classifier keeping its own (40 a plan, 25 a page).
  it("counts the vector classifier's calls of each plan in its budget, not against the ceiling of its reading", () => {
    const counted = boundPosteReadingRequest({ batches: batchesOf(postes(40)), units: units([12]).map((unit) => ({ ...unit, vectorCalls: 12 })),
      requestBudgetTokens: 400_000, chunking: CHUNKING, estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS });
    expect(counted).toMatchObject({ ok: true, readingCalls: 1, classifierCalls: 12, calls: 13 });
    const over = boundPosteReadingRequest({ batches: batchesOf(postes(40)), units: units([12]).map((unit) => ({ ...unit, vectorCalls: 40 })),
      requestBudgetTokens: 400_000, chunking: CHUNKING, estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS });
    expect(over).toMatchObject({ ok: false, readingCalls: 1, calls: 41 });
    expect(over.units[0].exceeded).toEqual(["budget"]);
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
    // 24 batches on 21 single-fragment plans: 504 calls, 24 a plan.
    const perRequest = bound(40 * 24, Array.from({ length: 21 }, () => 10), wide);
    expect(perRequest.units.every((unit) => unit.exceeded.length === 0)).toBe(true);
    expect(perRequest.exceeded).toEqual(["calls"]);
    expect(posteReadingRefusal(perRequest)?.pieces).toHaveLength(21);
  });

  it("names only the plan whose own share cannot start its calls", () => {
    // 80 items (2 batches): a 30-page plan (4 fragments, 8 calls) gets 375,000 tokens, a 2-page plan (2 calls) 25,000.
    const bounds = bound(80, [30, 2]);
    expect(bounds.units.map((unit) => [unit.calls, unit.exceeded])).toEqual([[8, []], [2, ["budget"]]]);
    expect(bounds).toMatchObject({ ok: false, exceeded: [], pieces: [{ id: "p2", name: "Plan 2" }] });
  });

  // Budget task: the sentence speaks of calls and of the time on the Mac, never of a token budget.
  it("states the reading's calls and its duration in French, and the ceilings once refused", () => {
    expect(describePosteReadingBounds(bound(40, [12]))).toBe("Lecture de 40 postes sur 1 plan : 1 appel de lecture, environ 2 min sur un Mac.");
    const classified = boundPosteReadingRequest({ batches: batchesOf(postes(120)), chunking: CHUNKING, requestBudgetTokens: 400_000,
      estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, units: units([20, 20]).map((unit) => ({ ...unit, vectorCalls: 40 })) });
    expect(describePosteReadingBounds(classified)).toBe(
      "Lecture de 120 postes sur 2 plans : 18 appels de lecture et 80 de classification vectorielle au plus, environ 47 min sur un Mac. "
      + "Au plus 480 appels de lecture par demande, 40 par plan et 154 pages par plan : réduisez les plans ou les pages à lire.");
    expect(describePosteReadingBounds(bound(40 * 24, Array.from({ length: 21 }, () => 10), 1_000_000_000))).toBe(
      "Lecture de 960 postes sur 21 plans : 504 appels de lecture, environ 12 h 36 sur un Mac. "
      + "Au plus 480 appels de lecture par demande, 40 par plan et 154 pages par plan : réduisez les plans ou les pages à lire.");
  });
});

// PR 3c fix round, point 1: the publication command stores at most 32 reasons and 500 observations per answer
// (TAKEOFF_ITEM_ANSWER_LIMITS); each fragment of a plan may give an item one reason of the model and 16 observations. A
// plan read in more fragments than an answer holds is refused before any paid call, never paid then refused whole.
describe("the fragments of one plan", () => {
  const onePage = { thresholdPages: 1, chunkSizePages: 1, overlapPages: 0 };
  const oneItem = (pages: number) => boundPosteReadingRequest({ batches: [1], chunking: onePage, requestBudgetTokens: 1_000_000,
    estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS,
    units: [{ key: "plan:p1", pieces: [{ id: "p1", name: "Plan 1" }], pages, budgetTokens: 1_000_000 }] });

  it("refuses before paying a plan read in more fragments than one answer holds, saying how many pages a plan may have", () => {
    // 33 one-page fragments, one item, a budget of 1,000,000 tokens: 33 calls are within the calls' ceilings and the budget.
    const over = oneItem(33);
    expect(over.units[0]).toMatchObject({ fragments: 33, readingCalls: 33, exceeded: ["fragments"] });
    expect(over).toMatchObject({ ok: false, maxPlanPages: POSTE_READING_MAX_FRAGMENTS });
    expect(posteReadingRefusal(over)?.pieces).toEqual([{ id: "p1", name: "Plan 1" }]);
    expect(describePosteReadingBounds(over)).toBe("Lecture de 1 poste sur 1 plan : 33 appels de lecture, environ 50 min sur un Mac. "
      + `Au plus 480 appels de lecture par demande, 40 par plan et ${POSTE_READING_MAX_FRAGMENTS} pages par plan : réduisez les plans ou les pages à lire.`);
    expect(oneItem(POSTE_READING_MAX_FRAGMENTS).ok).toBe(true);
  });

  it("keeps every answer of an admitted plan within what the command stores", () => {
    // The model's one reason per fragment and the worker's own (one per code); 16 observations per fragment and a vector
    // reading on each of the dossier's vector pages. The limits are the migration's own (read from its text below).
    expect(POSTE_READING_MAX_FRAGMENTS + POSTE_WORKER_REASONS.length).toBeLessThanOrEqual(COMMAND.reasons);
    expect(POSTE_READING_MAX_FRAGMENTS * POSTE_EXCHANGE_LIMITS.observationsPerAnswer + TAKEOFF_LAUNCH_VECTOR_PAGES)
      .toBeLessThanOrEqual(COMMAND.observations);
    // The findings outside the list of a plan's admitted calls stay within what one publication stores (PR 3c fix round,
    // point 7): the builder's cap at 2,000 is a guard an admitted reading never reaches.
    expect(POSTE_READING_LIMITS.callsPerUnit * POSTE_EXCHANGE_LIMITS.unlistedFindings).toBeLessThanOrEqual(COMMAND.findings);
    // With the tenant's default fragmenting, a plan of up to 154 pages (19 calls, its budget sized from them).
    expect(bound(40, [154], 2_000_000).ok).toBe(true);
    expect(bound(40, [155], 2_000_000)).toMatchObject({ ok: false, maxPlanPages: 154 });
    expect(bound(40, [155], 2_000_000).units[0].exceeded).toEqual(["fragments"]);
  });
});

/**
 * The command's limits as its migration writes them (PR 3c closing round, point 7): the latest migration that defines each
 * function, so that a replacement of the command (#470) is read too. A change of either side, or of the SQL's wording,
 * fails here.
 */
const COMMAND = (() => {
  const directory = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort().reverse();
  const definition = (name: string) => {
    const opening = new RegExp(`create (?:or replace )?function ${name.replace(".", "\\.")}\\(`);
    for (const file of files) {
      const sql = readFileSync(join(directory, file), "utf8");
      const start = sql.search(opening);
      if (start >= 0) return sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start) + 2));
    }
    throw new Error(`No migration defines ${name}.`);
  };
  const read = (sql: string, pattern: RegExp) => {
    const match = pattern.exec(sql);
    if (!match) throw new Error(`The command no longer writes ${pattern}.`);
    return Number(match[1]);
  };
  const answer = definition("private.takeoff_item_answer_well_formed");
  const value = definition("private.takeoff_item_answer_value_valid");
  const findings = definition("private.takeoff_item_answer_findings_valid");
  const refusal = definition("private.takeoff_item_answers_refusal");
  const command = definition("public.publish_takeoff_item_answers");
  return {
    reasons: read(answer, /jsonb_array_length\(coalesce\(p_answer -> 'reasons', '\[\]'::jsonb\)\) > (\d+)/),
    observations: read(answer, /jsonb_array_length\(coalesce\(p_answer -> 'observations', '\[\]'::jsonb\)\) > (\d+)/),
    observationQuantity: read(answer, /entry -> 'quantity', 0, ([\d.]+), false, true\)/),
    value: read(value, /p_value -> 'value', 0, ([\d.]+), false, true\)/),
    findings: read(findings, /jsonb_array_length\(p_findings\) > (\d+)/),
    itemQuantity: read(refusal, /i\.value -> 'quantity', 0, ([\d.]+), false, true\)/),
    answersBytes: read(command, /octet_length\(p_answers::text\) > (\d+)/),
  };
})();

describe("the command's limits", () => {
  it("are the ones its migration writes", () => {
    expect({ reasons: TAKEOFF_ITEM_ANSWER_LIMITS.reasons, observations: TAKEOFF_ITEM_ANSWER_LIMITS.observations,
      observationQuantity: TAKEOFF_ITEM_ANSWER_LIMITS.value, value: TAKEOFF_ITEM_ANSWER_LIMITS.value,
      findings: TAKEOFF_ITEM_ANSWER_LIMITS.findings, itemQuantity: TAKEOFF_ITEM_ANSWER_LIMITS.itemQuantity,
      answersBytes: TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes }).toEqual(COMMAND);
  });
});

// PR 3c closing round, point 1: the command refuses answers of more than 8 MiB as the database writes them back
// (octet_length(p_answers::text)). What a plan's reading can publish is bounded before any paid call from what the
// admission knows: its items, its fragments, its pages, and the schema's maxima per answer and per observation.
describe("the bytes of a plan's answers", () => {
  const onePlan = (items: number, pages: number) => boundPosteReadingRequest({ batches: batchesOf(postes(items)), chunking: CHUNKING,
    requestBudgetTokens: 1_000_000_000, estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS,
    units: [{ key: "plan:p1", pieces: [{ id: "p1", name: "Plan 1" }], pages, budgetTokens: 1_000_000_000 }] });

  it("refuses before paying a one-page reading of 1,600 items whose answers could pass what the command stores", () => {
    // 40 calls of 40 items: within the calls' ceilings, the budget and the bound of the calls' own answers.
    const over = onePlan(1_600, 1);
    expect(over.units[0]).toMatchObject({ fragments: 1, readingCalls: 40, exceeded: ["publication_bytes"] });
    expect(over.units[0].publicationBytes).toBeGreaterThan(TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes);
    expect(posteReadingRefusal(over)?.pieces).toEqual([{ id: "p1", name: "Plan 1" }]);
  });

  it("admits the reference dossier: each of its plans of 20 pages read against 300 items fits", () => {
    const reference = onePlan(300, 20);
    expect(reference.ok).toBe(true);
    expect(reference.units[0]).toMatchObject({ fragments: 3, exceeded: [] });
    expect(reference.units[0].publicationBytes).toBe(posteAnswersMaxBytes({ batches: batchesOf(postes(300)), fragments: 3, pages: 20,
      maxPage: 20 }));
    expect(reference.units[0].publicationBytes).toBeLessThan(TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes);
  });

  it("counts a plan's highest page in its answers' pages", () => {
    expect(posteAnswersMaxBytes({ batches: [40], fragments: 1, pages: 4, maxPage: 1_000 }))
      .toBeGreaterThan(posteAnswersMaxBytes({ batches: [40], fragments: 1, pages: 4, maxPage: 4 }));
  });
});

/** The classifier's own bound on a plan of so many vector pages, when it runs (vectors/worker-server.ts). */
const CLASSIFIER = (vectorPages: number) => vectorPages > 0 ? Math.min(40, 25 * vectorPages) : 0;

/** A list of `count` items as a DPGF gives them (about 330 bytes each once sent: 40 to a batch). */
const dpgfItems = (count: number) => postes(count, (index) => `Fourniture et pose de tube cuivre écroui DN ${12 + (index % 30)}, `
  + `y compris raccords, supports et calorifuge, réseau ${["EF", "ECS", "RECS"][index % 3]} niveau ${index % 6}`);

/** One analysis per plan as the seal builds it: `plans` plans of `pages` pages, a list of `items` items, the tenant's envelope. */
function planRequest(plans: number, pages: number, items: number) {
  const sources = Array.from({ length: plans }, (_, index) => takeoffPreparationSourceSchema.parse({
    document_id: `aaaaaaaa-0000-4000-8000-${String(0x300 + index).padStart(12, "0")}`, document_name: `Plan ${String(index + 1).padStart(2, "0")}`,
    kind: "plan", revision: "A", source_version: `v${index}`, pages: [], active: true, confirmed: true, page_count: pages,
    content_hash: (index % 10).toString().repeat(64) }));
  return splitTakeoffLaunchManifest(buildTakeoffLaunchManifest({ intent: "initial", sources, intakeDocumentByPlanFile: new Map(),
    omittedPlans: [], omittedReferences: [], preparationRevision: 1,
    budget: { tokens: TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT, cost_cents: 2_500 },
    order: { kind: "item_list", version: 2, list: { revision_id: "aaaaaaaa-0000-4000-8000-0000000000f1", revision: 3,
      content_sha256: "e".repeat(64), item_count: items } } }));
}
/** The request sized and bounded as its admission does it (a list is always bounded). */
function sized(plans: number, pages: number, items: number) {
  const result = sizePosteReadingManifest(planRequest(plans, pages, items), CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, dpgfItems(items),
    CLASSIFIER);
  return { manifest: result.manifest, bounds: result.bounds! };
}

/**
 * The ledger's start rule (reserve_takeoff_launch_call over takeoff_launch_job_balance, migration
 * 20261121231238_takeoff_plan_dispatcher.sql), played over a request: its plans one after the other on the Mac, each plan's
 * reading calls one at a time, then its classifier's four at a time. A call starts while its plan's share and the request
 * keep a positive balance after what was charged and what is still reserved; it reserves the largest call of its branch
 * charged so far, at least the estimate; once answered it is charged `cost`. Returns the calls of each plan that started.
 */
function ledgerStarts(units: ReadonlyArray<{ share: number; readingCalls: number; classifierCalls: number }>, envelope: number,
  cost: number, estimate = TAKEOFF_PAID_CALL_ESTIMATE_TOKENS) {
  let requestCharged = 0;
  const largest = { pdf: 0, vector_group: 0 };
  return units.map((unit) => {
    let charged = 0;
    let started = 0;
    const wave = (branch: "pdf" | "vector_group", size: number) => {
      const reserved: number[] = [];
      for (let index = 0; index < size; index += 1) {
        const held = reserved.reduce((sum, tokens) => sum + tokens, 0);
        if (unit.share - charged - held <= 0 || envelope - requestCharged - held <= 0) break;
        reserved.push(Math.max(estimate, largest[branch]));
      }
      started += reserved.length;
      charged += reserved.length * cost;
      requestCharged += reserved.length * cost;
      if (reserved.length) largest[branch] = Math.max(largest[branch], cost);
      return reserved.length === size;
    };
    for (let call = 0; call < unit.readingCalls; call += 1) if (!wave("pdf", 1)) return started;
    for (let left = unit.classifierCalls; left > 0; left -= 4) if (!wave("vector_group", Math.min(4, left))) return started;
    return started;
  });
}

// Budget task (owner, 2026-11-22): the budget of a request that reads against the list is sized from the calls it is
// admitted for; the ceilings of its calls are the guard.
describe("sizePosteReadingManifest", () => {
  it("admits the reference dossier and gives each plan the share its calls need, twice their reservations", () => {
    // 15 plans of 20 pages (3 fragments each), 300 items (8 batches), the vector classifier on: the dossier's 60 vector
    // pages go to the first 3 plans, 40 classifier calls each.
    const { manifest: admitted, bounds } = sized(15, 20, 300);
    expect(bounds).toMatchObject({ ok: true, items: 300, plans: 15, readingCalls: 360, classifierCalls: 120, calls: 480, minutes: 570 });
    expect(bounds.units.map((unit) => unit.calls)).toEqual([64, 64, 64, ...Array.from({ length: 12 }, () => 24)]);
    expect(POSTE_READING_BUDGET_MARGIN).toBe(2);
    expect(admitted.units.map((unit) => unit.budget.tokens)).toEqual(bounds.units.map((unit) => unit.calls * TAKEOFF_PAID_CALL_ESTIMATE_TOKENS * 2));
    // The envelope is the sum of the shares (the seal's rule), 28.8 million tokens for 14.4 million reserved at the estimate.
    expect(admitted.budget.tokens).toBe(28_800_000);
    expect(admitted.units.reduce((total, unit) => total + unit.budget.tokens, 0)).toBe(admitted.budget.tokens);
    expect(bounds.tokens).toBe(14_400_000);
    // By the ledger's own rule, every admitted call of every plan starts even when each call costs twice the estimate; at
    // the estimate alone (no margin), the third plan's classifier would be stopped short.
    const played = admitted.units.map((unit, index) => ({ share: unit.budget.tokens, readingCalls: bounds.units[index].readingCalls,
      classifierCalls: bounds.units[index].classifierCalls }));
    expect(ledgerStarts(played, admitted.budget.tokens, 2 * TAKEOFF_PAID_CALL_ESTIMATE_TOKENS)).toEqual(bounds.units.map((unit) => unit.calls));
    const unmargined = played.map((unit) => ({ ...unit, share: unit.share / 2 }));
    expect(ledgerStarts(unmargined, admitted.budget.tokens / 2, 2 * TAKEOFF_PAID_CALL_ESTIMATE_TOKENS))
      .not.toEqual(bounds.units.map((unit) => unit.calls));
    // Its cost envelope is the tenant's, split by pages as for the free extraction: the local reader's calls cost no cent.
    expect(admitted.budget.cost_cents).toBe(2_500);
    expect(admitted.units.map((unit) => unit.budget.cost_cents)).toEqual(planRequest(15, 20, 300).units.map((unit) => unit.budget.cost_cents));
    expect(describePosteReadingBounds(bounds)).toBe("Lecture de 300 postes sur 15 plans : 360 appels de lecture et 120 de "
      + "classification vectorielle au plus, environ 9 h 30 sur un Mac.");
  });

  it("admits a request up to the ceiling of its reading's calls, and refuses one plan more, in calls and duration", () => {
    // 30-page plans read in 4 fragments: 32 calls each for 300 items; 15 of them make 480, the request's ceiling.
    expect(sized(15, 30, 300).bounds).toMatchObject({ ok: true, readingCalls: 480 });
    const { bounds: over } = sized(16, 30, 300);
    expect(over).toMatchObject({ ok: false, readingCalls: 512, exceeded: ["calls"] });
    expect(over.units.every((unit) => unit.exceeded.length === 0)).toBe(true);
    expect(posteReadingRefusal(over)).toMatchObject({ reason: "PLAN_SET_TOO_LARGE" });
    expect(posteReadingRefusal(over)?.pieces).toHaveLength(16);
    expect(describePosteReadingBounds(over)).toBe("Lecture de 300 postes sur 16 plans : 512 appels de lecture et 80 de classification "
      + "vectorielle au plus, environ 13 h 08 sur un Mac. Au plus 480 appels de lecture par demande, 40 par plan et 154 pages par "
      + "plan : réduisez les plans ou les pages à lire.");
  });

  it("refuses, naming it, a plan whose reading passes its own ceiling", () => {
    // 560 items (14 batches) on a 20-page plan: 42 calls, and answers past what its publication stores (PR 3c closing round,
    // point 1); the 8-page plan beside it, 14 calls, within both.
    const request = planRequest(2, 20, 560);
    request.units[1].page_count = 8;
    request.plans[1].page_count = 8;
    const bounds = sizePosteReadingManifest(request, CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, dpgfItems(560), CLASSIFIER).bounds!;
    expect(bounds.units.map((unit) => [unit.readingCalls, unit.exceeded])).toEqual([[42, ["calls", "publication_bytes"]], [14, []]]);
    expect(posteReadingRefusal(bounds)?.pieces).toEqual([{ id: request.plans[0].plan_file_id, name: "Plan 01" }]);
  });

  it("leaves the free extraction's manifest as it sealed it", () => {
    const free = splitTakeoffLaunchManifest(manifest([{ count: 20 }, { count: 6 }], { kind: "free_extraction", version: 1, list: null }));
    const before = structuredClone(free);
    const result = sizePosteReadingManifest(free, CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, [], CLASSIFIER);
    // Compared with a copy taken before: a change made in place would show.
    expect(result).toEqual({ manifest: before, bounds: null });
    expect(free).toEqual(before);
  });

  // What a plan's publication carries and a request's answers can never refuse what the ceilings of their calls admit.
  it("keeps the bounds of the answers above what the ceilings of the calls admit", () => {
    const largestCall = posteExchangeOutputMaxBytes(40, 200);
    expect(POSTE_READING_LIMITS.callsPerUnit * largestCall).toBeLessThanOrEqual(POSTE_READING_LIMITS.unitAnswerBytes);
    expect(POSTE_READING_LIMITS.callsPerRequest * largestCall).toBeLessThanOrEqual(POSTE_READING_LIMITS.requestAnswerBytes);
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
  posteReadingBoundsOfManifest(sealed, CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS,
    postes(sealed.order.kind === "item_list" ? sealed.order.list.item_count : 0));

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

  it("refuses to bound a manifest with items other than the list it sealed", () => {
    expect(() => posteReadingBoundsOfManifest(manifest([{ count: 20 }]), CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, postes(119))).toThrow();
  });

  it("counts each plan's vector classifier calls from its share of the vector pages", () => {
    const sealed = splitTakeoffLaunchManifest(manifest([{ count: 12 }]));
    const bounds = posteReadingBoundsOfManifest(sealed, CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, postes(120), (pages) => pages)!;
    expect(bounds.calls).toBe(3 + sealed.units[0].vector_pages);
  });

  it("bounds a grouped analysis as one unit holding every plan", () => {
    const bounds = fromManifest(manifest([{ count: 6 }, { count: 6 }]))!;
    expect(bounds.units).toEqual([expect.objectContaining({ key: "grouped", fragments: 1, calls: 3 })]);
    expect(bounds).toMatchObject({ ok: true, plans: 2 });
  });
});

// Lot 4 PR 4b: a new measure names the items it asks by identifier; the admission, its preview and the worker read and
// size them in the sealed list's order (the batches split on count and bytes in that order), through one function.
describe("the items a sealed order asks", () => {
  const list = orderSensitivePosteList();
  const byIdentifier = [...list].map(({ id }) => id).sort();

  it("are the sealed list's items it names, in the list's order, whatever the order it names them in", () => {
    expect(postesAskedBy(list, byIdentifier)).toEqual(list);
    expect(postesAskedBy(list, [list[30].id, list[2].id.toUpperCase()])).toEqual([list[2], list[30]]);
    expect(postesAskedBy(list, null)).toEqual(list);
  });

  it("are none when an item it names is not in the list, or is named twice", () => {
    expect(postesAskedBy(list, [list[0].id, "cccccccc-0000-4000-8000-000000000009"])).toBeNull();
    expect(postesAskedBy(list, [list[0].id, list[0].id])).toBeNull();
  });

  it("are batched in the list's order: 80 items, long ones first in the list and alternating by identifier", () => {
    // Short and 3,000-character designations alternating by identifier; the long ones first in the list's order.
    const byId = postes(80, (index) => index % 2 ? "WC" : "A".repeat(3_000));
    const revision = [...byId.filter((_, index) => index % 2 === 0), ...byId.filter((_, index) => index % 2 !== 0)];
    const asked = postesAskedBy(revision, byId.map(({ id }) => id))!;
    expect(asked).toEqual(revision);
    expect(batchesOf(asked)).toEqual([21, 40, 19]);
    // What sizing them by identifier counted: one call fewer per fragment.
    expect(batchesOf(byId)).toEqual([40, 40]);
  });

  it("are bounded in the list's order: 4 batches, 44 calls on 11 fragments, past a plan's ceiling", () => {
    const asked = postesAskedBy(list, byIdentifier)!;
    expect(batchesOf(asked)).toHaveLength(4);
    // What sizing them by identifier would have counted: 3 batches, 33 calls, within the ceiling.
    expect(batchesOf([...list].sort((left, right) => left.id.localeCompare(right.id)))).toHaveLength(3);
    const sealed = splitTakeoffLaunchManifest(manifest([{ count: 90 }], { ...LIST,
      list: { ...LIST.list, item_count: list.length, asked_item_ids: byIdentifier } }));
    const bounds = posteReadingBoundsOfManifest(sealed, CHUNKING, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, asked)!;
    expect(bounds.units).toEqual([expect.objectContaining({ fragments: 11, batches: 4, readingCalls: 44,
      exceeded: expect.arrayContaining(["calls"]) })]);
    expect(bounds.ok).toBe(false);
  });
});

describe("the bounds' facts a refusal keeps", () => {
  it("stores numbers only, and reads them back into the same sentence", () => {
    const { bounds } = sized(16, 30, 300);
    const stored = posteReadingBoundsDetails(bounds);
    expect(stored).toEqual({ items: 300, plans: 16, reading_calls: 512, classifier_calls: 80, minutes: 788, max_request_calls: 480,
      max_plan_calls: 40, max_plan_pages: 154 });
    expect(describePosteReadingBounds(readPosteReadingBoundsFacts(JSON.parse(JSON.stringify(stored)))!))
      .toBe(describePosteReadingBounds(bounds));
  });

  it("ignores stored facts that are not whole numbers", () => {
    const stored = { items: 120, plans: 3, reading_calls: 27, classifier_calls: 0, minutes: 41, max_request_calls: 480, max_plan_calls: 40,
      max_plan_pages: 154 };
    expect(readPosteReadingBoundsFacts(stored)).not.toBeNull();
    expect(readPosteReadingBoundsFacts(undefined)).toBeNull();
    expect(readPosteReadingBoundsFacts({ ...stored, items: "120" })).toBeNull();
    expect(readPosteReadingBoundsFacts({ ...stored, minutes: 1.5 })).toBeNull();
    // The facts of a token budget, as a refusal kept them before: not this sentence's.
    expect(readPosteReadingBoundsFacts({ items: 120, plans: 3, calls: 27, tokens: 1, request_budget_tokens: 1 })).toBeNull();
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
