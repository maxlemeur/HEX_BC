import { describe, expect, it } from "vitest";

import { buildPdfChunks, ownedChunkPages } from "@/lib/takeoff/chunking";
import {
  planPosteExchangeCalls,
  PosteExchangeOutputSchema,
  PosteExchangeRefusal,
  validatePosteExchangeOutput,
  type PosteExchangeAnswer,
  type PosteExchangeCall,
} from "@/lib/takeoff/poste-exchange";
import {
  mergePosteReadings,
  remapPosteFragmentReading,
  type PosteFragmentReading,
  type PostePlanAnswer,
  type PosteVectorReading,
} from "@/lib/takeoff/poste-exchange-merge";
import type { Poste } from "@/lib/takeoff/poste-list";

function poste(id: string, label: string, expectedUnit: string | null = "u", qualifiers: Poste["qualifiers"] = {}): Poste {
  return { id, label, expectedUnit, measurementBasis: null, qualifiers, sections: [], synonyms: [], referenceQuantity: null,
    origin: { kind: "manual", intentId: `intent-${id}`, addedBy: "u-1", addedAt: "2026-11-22T08:00:00.000Z", addedInRevision: 1 } };
}

const LAVABO = poste("00000000-0000-4000-8000-000000000001", "Lavabo");
const WC = poste("00000000-0000-4000-8000-000000000002", "WC suspendu");
const BAIGNOIRE = poste("00000000-0000-4000-8000-000000000003", "Baignoire");
const ITEMS = [LAVABO, WC, BAIGNOIRE];

// A plan of 12 retained pages, original pages 21 to 32: fragments 1–6, 5–10 and 9–12 of its PDF; each owns 1–4, 5–8, 9–12.
const CHUNKING = { thresholdPages: 5, chunkSizePages: 6, overlapPages: 2 };
const PLAN_PAGES = Array.from({ length: 12 }, (_, index) => 21 + index);
const originalPageOf = (pdfPage: number) => 20 + pdfPage;

type Script = (call: PosteExchangeCall, key: string, local: { pages: number[]; owned: number[] }) => PosteExchangeAnswer;
type Options = { items?: Poste[]; unreadable?: (call: PosteExchangeCall) => number[] };

const notFound = (key: string, pages: number[]): PosteExchangeAnswer => ({ post_id: key, outcome: "not_found",
  searched_pages: pages, reason_code: "NO_INDICATION", reason_text: "Aucun indice sur les pages lues.", observations: [] });
const observation = (page: number, quantity: number | null, unit: string | null = "u") => ({
  page, evidence: "symboles relevés sur la page", method: "symbol_count" as const, confidence: 0.9, quantity, unit, measurement_basis: null });
const measured = (key: string, pages: number[], observations: Array<{ page: number; quantity: number; unit?: string }>): PosteExchangeAnswer => ({
  post_id: key, outcome: "measured", searched_pages: pages, reason_code: null, reason_text: null,
  observations: observations.map((entry) => ({ ...observation(entry.page, entry.quantity, entry.unit ?? "u"), quantity: entry.quantity,
    unit: entry.unit ?? "u" })),
});

/** The plan read as the worker reads it: the calls planned, each answered, validated, then mapped back to the plan. */
function read(script: Script, options: Options = {}): PosteFragmentReading[] {
  const fragments = buildPdfChunks(12, CHUNKING);
  const calls = planPosteExchangeCalls({ listRevision: 2, items: options.items ?? ITEMS, fragments, ownedPages: ownedChunkPages(fragments) });
  return calls.map((call) => {
    const local = { pages: call.manifest.page_scope.pages, owned: call.manifest.page_scope.owned_pages };
    const output = PosteExchangeOutputSchema.parse({
      schema_version: "v2", prompt_version: "takeoff-c-postes-v1", chunk_id: call.manifest.chunk_id,
      responses: call.manifest.requested_posts.map((entry) => script(call, entry.post_id, local)),
      unreadable_pages: options.unreadable?.(call) ?? [], unlisted_findings: [], warnings: [],
    });
    validatePosteExchangeOutput(call, output);
    return remapPosteFragmentReading(call, output, originalPageOf);
  });
}

const fragmentOf = (call: PosteExchangeCall) => Number(call.manifest.chunk_id.slice(1, call.manifest.chunk_id.indexOf("-")));
const answerOf = (answers: readonly PostePlanAnswer[], item: Poste) => answers.find((answer) => answer.itemId === item.id)!;
const roles = (answer: PostePlanAnswer) => answer.observations.map((entry) => [entry.page, entry.quantity, entry.role, entry.source]);

describe("remapPosteFragmentReading", () => {
  it("maps the opaque keys to the items and the fragment's pages to the plan's original pages", () => {
    const [second] = read((call, key, local) => fragmentOf(call) === 2 && key === "P0001"
      ? measured(key, local.pages, [{ page: 2, quantity: 2 }]) : notFound(key, local.pages)).slice(1, 2);

    expect(second.chunkId).toBe("f2-b1");
    // Its PDF pages 5 to 10 are the plan's pages 25 to 30; it owns 25 to 28.
    expect(second.ownedPages).toEqual([25, 26, 27, 28]);
    expect(second.contextPages).toEqual([29, 30]);
    expect(second.answers.map((answer) => answer.itemId)).toEqual(ITEMS.map((item) => item.id));
    expect(second.answers[0].observations[0].page).toBe(26);
    expect(second.answers[2].searchedPages).toEqual([25, 26, 27, 28, 29, 30]);
  });
});

describe("mergePosteReadings", () => {
  it("adds the readings of a plan's fragments, counting an overlap page once, and keeps an item without any quantity", () => {
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      // Lavabo: 3 on the plan's page 22 (fragment 1), 2 on page 26 (fragment 2).
      if (key === "P0001" && fragment === 1) return measured(key, local.pages, [{ page: 2, quantity: 3 }]);
      if (key === "P0001" && fragment === 2) return measured(key, local.pages, [{ page: 2, quantity: 2 }]);
      // WC: one on page 25, seen by fragment 1 (its context) and by fragment 2 (its owner).
      if (key === "P0002" && fragment === 1) return measured(key, local.pages, [{ page: 5, quantity: 1 }]);
      if (key === "P0002" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 1 }]);
      return notFound(key, local.pages);
    });
    const { answers } = mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments });

    expect(answers.map((answer) => answer.itemId)).toEqual(ITEMS.map((item) => item.id));
    expect(answerOf(answers, LAVABO)).toMatchObject({ outcome: "measured", quantity: { value: 5, unit: "u" }, candidate: null,
      searchedPages: PLAN_PAGES, unreadablePages: [] });
    expect(roles(answerOf(answers, LAVABO))).toEqual([[22, 3, "contribution", "model"], [26, 2, "contribution", "model"]]);
    // The overlap page counts once: fragment 1's reading of page 25 is an alternative that agrees.
    expect(answerOf(answers, WC)).toMatchObject({ outcome: "measured", quantity: { value: 1, unit: "u" } });
    expect(roles(answerOf(answers, WC))).toEqual([[25, 1, "alternative", "model"], [25, 1, "contribution", "model"]]);
    // Not found on the whole plan: a SQL NULL quantity, never 0, every page searched, no observation.
    expect(answerOf(answers, BAIGNOIRE)).toMatchObject({ outcome: "not_found", quantity: null, candidate: null,
      searchedPages: PLAN_PAGES, observations: [] });
    expect(answerOf(answers, BAIGNOIRE).reasons.map((reason) => reason.code)).toEqual(["NO_INDICATION", "NO_INDICATION", "NO_INDICATION"]);
  });

  it("keeps a disagreement on an overlap page and makes the answer uncertain", () => {
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (key === "P0002" && fragment === 1) return measured(key, local.pages, [{ page: 5, quantity: 2 }]);
      if (key === "P0002" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 1 }]);
      // Lavabo: fragment 1 sees one on page 26, which fragment 2 owns and finds nothing on.
      if (key === "P0001" && fragment === 1) return measured(key, local.pages, [{ page: 6, quantity: 1 }]);
      return notFound(key, local.pages);
    });
    const { answers } = mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments });

    expect(answerOf(answers, WC)).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 1, unit: "u" } });
    // An uncertain answer counts nothing: the owner's reading is a candidate, the other reading an alternative.
    expect(roles(answerOf(answers, WC))).toEqual([[25, 2, "alternative", "model"], [25, 1, "candidate", "model"]]);
    expect(answerOf(answers, WC).reasons).toContainEqual({ code: "READINGS_DISAGREE", by: "worker", text: null, chunkId: "f1-b1" });
    expect(answerOf(answers, LAVABO)).toMatchObject({ outcome: "uncertain", quantity: null, candidate: null });
    expect(answerOf(answers, LAVABO).reasons.map((reason) => reason.code)).toContain("READINGS_DISAGREE");
  });

  it("lets one uncertain fragment make the plan's answer uncertain, its indications kept as candidates", () => {
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (key === "P0001" && fragment === 1) return measured(key, local.pages, [{ page: 2, quantity: 3 }]);
      if (key === "P0001" && fragment === 3) return { post_id: key, outcome: "uncertain", searched_pages: local.pages,
        reason_code: "AMBIGUOUS_INDICATION", reason_text: "Symbole proche d’un lave-mains.", observations: [observation(2, null, null)] };
      return notFound(key, local.pages);
    });
    const lavabo = answerOf(mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments }).answers, LAVABO);

    expect(lavabo).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 3, unit: "u" } });
    expect(roles(lavabo)).toEqual([[22, 3, "candidate", "model"], [30, null, "candidate", "model"]]);
    expect(lavabo.reasons).toContainEqual({ code: "AMBIGUOUS_INDICATION", by: "model", text: "Symbole proche d’un lave-mains.",
      chunkId: "f3-b1" });
  });

  it("never certifies an absence or a total on a page its owner could not read", () => {
    const fragments = read((call, key, local) => {
      const unreadable = fragmentOf(call) === 2 ? [3] : [];
      const searched = local.pages.filter((value) => !unreadable.includes(value));
      if (key === "P0001" && fragmentOf(call) === 1) return measured(key, searched, [{ page: 2, quantity: 3 }]);
      return notFound(key, searched);
    }, { unreadable: (call) => fragmentOf(call) === 2 ? [3] : fragmentOf(call) === 1 ? [5] : [] });
    const { answers } = mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments });

    // Page 27 (fragment 2's page 3) is unreadable; page 25, unreadable for fragment 1 only as context, was read by its owner.
    expect(answerOf(answers, BAIGNOIRE)).toMatchObject({ outcome: "uncertain", unreadablePages: [27], quantity: null, candidate: null });
    expect(answerOf(answers, BAIGNOIRE).reasons).toContainEqual({ code: "PAGES_UNREADABLE", by: "worker", text: null, chunkId: null });
    expect(answerOf(answers, LAVABO)).toMatchObject({ outcome: "uncertain", candidate: { value: 3, unit: "u" } });
    expect(answerOf(answers, LAVABO).searchedPages).toEqual(PLAN_PAGES.filter((value) => value !== 27));
  });

  it("checks the unit and the integer count of a measure against the item", () => {
    const pipe = poste("00000000-0000-4000-8000-000000000004", "Tube PER", "ml");
    const loose = poste("00000000-0000-4000-8000-000000000005", "Siphon", null);
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (key === "P0001" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 2, unit: "ml" }]);
      if (key === "P0002" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 2.5 }]);
      if (key === "P0003" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 4.2, unit: "m" }]);
      if (key === "P0003" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 1.3, unit: "ml" }]);
      if (key === "P0004" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 1, unit: "u" }]);
      if (key === "P0004" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 1, unit: "ens" }]);
      return notFound(key, local.pages);
    }, { items: [LAVABO, WC, pipe, loose] });
    const { answers } = mergePosteReadings({ items: [LAVABO, WC, pipe, loose], planPages: PLAN_PAGES, fragments });

    expect(answerOf(answers, LAVABO)).toMatchObject({ outcome: "uncertain", quantity: null });
    expect(answerOf(answers, LAVABO).reasons.map((reason) => reason.code)).toEqual(["UNIT_MISMATCH"]);
    expect(answerOf(answers, WC).reasons.map((reason) => reason.code)).toEqual(["NON_INTEGER_COUNT"]);
    // « m » and « ml » are one unit of length.
    expect(answerOf(answers, pipe)).toMatchObject({ outcome: "measured", quantity: { value: 5.5, unit: "ml" } });
    // An item whose unit is to be specified takes the unit read, but one unit only.
    expect(answerOf(answers, loose)).toMatchObject({ outcome: "uncertain", candidate: null });
    expect(answerOf(answers, loose).reasons.map((reason) => reason.code)).toEqual(["UNIT_MISMATCH"]);
  });

  it("attaches the vector reading of a network to its item without ever adding it to the model's measure", () => {
    const ef = poste("00000000-0000-4000-8000-000000000006", "Distribution eau froide", "ml",
      { network: "EF", material: "cuivre", diameter: "DN 22" });
    const efDisagrees = poste("00000000-0000-4000-8000-000000000007", "Bouclage", "ml", { network: "RECS", material: "cuivre", diameter: "DN 16" });
    const ecsVectorOnly = poste("00000000-0000-4000-8000-000000000008", "Distribution ECS", "ml", { network: "ECS", material: "cuivre", diameter: "DN 18" });
    const items = [ef, efDisagrees, ecsVectorOnly];
    const fragments = read((call, key, local) => {
      if (fragmentOf(call) !== 1) return notFound(key, local.pages);
      if (key === "P0001") return measured(key, local.pages, [{ page: 3, quantity: 12.5, unit: "ml" }]);
      if (key === "P0002") return measured(key, local.pages, [{ page: 3, quantity: 4, unit: "ml" }]);
      return notFound(key, local.pages);
    }, { items });
    const vector = (key: string, designation: string, quantity: number): PosteVectorReading => ({ key, page: 23, kind: "network",
      designation, quantity, unit: "ml", confidence: 0.9, evidence: "Lecture vectorielle : 4 tronçons d’axe." });
    const vectorReadings = [vector("v-ef", "EF cuivre DN 22", 12.52), vector("v-recs", "RECS cuivre DN 16", 9),
      vector("v-ecs", "ECS cuivre DN 18", 20), vector("v-gaz", "GAZ cuivre DN 22", 3)];
    const reading = mergePosteReadings({ items, planPages: PLAN_PAGES, fragments, vectorReadings });

    expect(answerOf(reading.answers, ef)).toMatchObject({ outcome: "measured", quantity: { value: 12.5, unit: "ml" } });
    expect(roles(answerOf(reading.answers, ef))).toEqual([[23, 12.5, "contribution", "model"], [23, 12.52, "alternative", "vector"]]);
    expect(answerOf(reading.answers, efDisagrees)).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 4, unit: "ml" } });
    expect(answerOf(reading.answers, efDisagrees).reasons.map((reason) => reason.code)).toEqual(["READINGS_DISAGREE"]);
    // The model found nothing, the vectors did: an indication to check, never a measure on its own.
    expect(answerOf(reading.answers, ecsVectorOnly)).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 20, unit: "ml" } });
    expect(answerOf(reading.answers, ecsVectorOnly).reasons.map((reason) => reason.code)).toContain("VECTOR_ONLY");
    expect(reading.unattachedVectorReadings).toEqual(["v-gaz"]);
  });

  it("keeps a vector reading two items could claim as a candidate of each, never as anyone's measure", () => {
    const first = poste("00000000-0000-4000-8000-000000000009", "Alimentation EF", "ml", { network: "EF", material: "cuivre", diameter: "DN 22" });
    const second = poste("00000000-0000-4000-8000-00000000000a", "Alimentation EF cuisine", "ml",
      { network: "EF", material: "cuivre", diameter: "DN 22" });
    const fragments = read((call, key, local) => fragmentOf(call) === 1 && key === "P0001"
      ? measured(key, local.pages, [{ page: 1, quantity: 7, unit: "ml" }]) : notFound(key, local.pages), { items: [first, second] });
    const { answers } = mergePosteReadings({ items: [first, second], planPages: PLAN_PAGES, fragments, vectorReadings: [
      { key: "v-1", page: 21, kind: "network", designation: "EF cuivre DN 22", quantity: 30, unit: "ml", confidence: 0.9, evidence: "axe" }] });

    expect(answerOf(answers, first)).toMatchObject({ outcome: "measured", quantity: { value: 7, unit: "ml" } });
    expect(roles(answerOf(answers, first))).toEqual([[21, 7, "contribution", "model"], [21, 30, "candidate", "vector"]]);
    expect(answerOf(answers, second)).toMatchObject({ outcome: "uncertain", candidate: null });
    expect(roles(answerOf(answers, second))).toEqual([[21, 30, "candidate", "vector"]]);
  });

  // Only a measured answer has contributions, and its quantity is their sum: what the publication command checks.
  it("gives contributions to measured answers only, their sum its quantity", () => {
    const fragments = read((call, key, local) => {
      if (key === "P0001") return measured(key, local.pages, [{ page: local.owned[0], quantity: 2 }]);
      if (key === "P0002" && fragmentOf(call) === 1) return measured(key, local.pages, [{ page: 1, quantity: 1 }]);
      if (key === "P0002" && fragmentOf(call) === 2) return { post_id: key, outcome: "uncertain", searched_pages: local.pages,
        reason_code: "ESTIMATE", reason_text: "Comptage estimé.", observations: [observation(1, 4)] };
      return notFound(key, local.pages);
    });
    for (const answer of mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments }).answers) {
      const contributions = answer.observations.filter((entry) => entry.role === "contribution");
      if (answer.outcome === "measured") {
        expect(contributions.length).toBeGreaterThan(0);
        expect(answer.quantity?.value).toBe(contributions.reduce((sum, entry) => sum + entry.quantity!, 0));
      } else {
        expect(contributions).toEqual([]);
        expect(answer.quantity).toBeNull();
      }
    }
  });

  it("keeps every observation read and traces each to its call", () => {
    const fragments = read((call, key, local) => key === "P0003" ? notFound(key, local.pages)
      : measured(key, local.pages, local.owned.map((page) => ({ page, quantity: 1 }))));
    const { answers } = mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments });
    const read_ = fragments.flatMap((fragment) => fragment.answers.flatMap((answer) => answer.observations.map((entry) =>
      `${fragment.chunkId}:${answer.itemId}:${entry.page}`)));
    const kept = answers.flatMap((answer) => answer.observations.map((entry) => `${entry.chunkId}:${answer.itemId}:${entry.page}`));

    expect(kept.sort()).toEqual(read_.sort());
    expect(answerOf(answers, LAVABO).quantity).toEqual({ value: 12, unit: "u" });
  });

  it("refuses a plan whose merged readings miss an item, leave a page unread or cite a page outside the plan", () => {
    const complete = read((_call, key, local) => notFound(key, local.pages));
    const refusal = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        if (error instanceof PosteExchangeRefusal) return { code: error.code, chunkId: error.details.chunkId };
        throw error;
      }
      return null;
    };

    expect(refusal(() => mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments: complete }))).toBeNull();
    const missing = complete.map((fragment, index) => index === 1 ? { ...fragment, answers: fragment.answers.slice(0, 2) } : fragment);
    expect(refusal(() => mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments: missing })))
      .toEqual({ code: "MISSING_ANSWER", chunkId: "plan" });
    expect(refusal(() => mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments: complete.slice(0, 2) })))
      .toEqual({ code: "UNPROCESSED_PAGES", chunkId: "plan" });
    expect(refusal(() => mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES.slice(1), fragments: complete })))
      .toEqual({ code: "PAGE_OUTSIDE_SLICE", chunkId: "plan" });
  });
});
