import { describe, expect, it } from "vitest";

import { buildPdfChunks, ownedChunkPages } from "@/lib/takeoff/chunking";
import { TAKEOFF_ITEM_ANSWER_LIMITS } from "@/lib/takeoff/item-answer-limits";
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

function poste(id: string, label: string, expectedUnit: string | null = "u", qualifiers: Poste["qualifiers"] = {},
  measurementBasis: string | null = null): Poste {
  return { id, label, expectedUnit, measurementBasis, qualifiers, sections: [], synonyms: [], referenceQuantity: null,
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
  page, evidence: "symboles relevés sur la page", method: "symbol_count" as const, confidence: 0.9, quantity, unit, measurement_basis: null,
  counts_as: "distinct" as const, basis_as_requested: false });
type Reading = { page: number; quantity: number; unit?: string; countsAs?: "distinct" | "same_object"; evidence?: string;
  method?: "symbol_count" | "scaled_measure" | "annotation"; basis?: string | null; asRequested?: boolean };
const measured = (key: string, pages: number[], observations: Reading[]): PosteExchangeAnswer => ({
  post_id: key, outcome: "measured", searched_pages: pages, reason_code: null, reason_text: null,
  observations: observations.map((entry) => ({ ...observation(entry.page, entry.quantity, entry.unit ?? "u"), quantity: entry.quantity,
    unit: entry.unit ?? "u", counts_as: entry.countsAs ?? "distinct", evidence: entry.evidence ?? "symboles relevés sur la page",
    method: entry.method ?? "symbol_count", measurement_basis: entry.basis ?? null, basis_as_requested: entry.asRequested ?? false })),
});

/** The plan read as the worker reads it: the calls planned, each answered, validated, then mapped back to the plan. */
function read(script: Script, options: Options = {}): PosteFragmentReading[] {
  const fragments = buildPdfChunks(12, CHUNKING);
  const calls = planPosteExchangeCalls({ listRevision: 2, items: options.items ?? ITEMS, fragments, ownedPages: ownedChunkPages(fragments) });
  return calls.map((call) => {
    const local = { pages: call.manifest.page_scope.pages, owned: call.manifest.page_scope.owned_pages };
    const output = PosteExchangeOutputSchema.parse({
      schema_version: "v3", prompt_version: "takeoff-c-postes-v2", chunk_id: call.manifest.chunk_id,
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
    // The same reason of its three fragments, stored once with the first (PR 3c fix round, point 1).
    expect(answerOf(answers, BAIGNOIRE).reasons.map((reason) => [reason.code, reason.chunkId])).toEqual([["NO_INDICATION", "f1-b1"]]);
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
    expect(answerOf(answers, LAVABO).reasons).toContainEqual(expect.objectContaining({ code: "READINGS_DISAGREE",
      text: "Indice chiffré sur un chevauchement sans confirmation." }));
  });

  it("keeps the model's obstacle and explains why its own figures cannot give one quantity", () => {
    const items = [LAVABO, WC, BAIGNOIRE];
    const fragments = read((call, key, local) => {
      if (fragmentOf(call) !== 1) return notFound(key, local.pages);
      const observations = key === "P0001" ? [observation(1, 3), observation(2, 2, "ml")]
        : key === "P0002" ? [{ ...observation(2, 5, "ml"), method: "scaled_measure" as const }] : [];
      return { post_id: key, outcome: "uncertain", searched_pages: local.pages, reason_code: "AMBIGUOUS_INDICATION",
        reason_text: "Vérifier la légende du réseau.", observations };
    }, { items });
    const { answers } = mergePosteReadings({ items, planPages: PLAN_PAGES, fragments });

    expect(answers.map(({ candidate, quantity, reasons }) => [candidate, quantity, reasons.map(({ code }) => code)])).toEqual([
      [null, null, ["AMBIGUOUS_INDICATION", "UNIT_MISMATCH"]],
      [null, null, ["AMBIGUOUS_INDICATION", "BASIS_UNSTATED"]],
      [null, null, ["AMBIGUOUS_INDICATION"]],
    ]);
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
    const vector = (key: string, designation: string, quantity: number): PosteVectorReading => ({ key, page: 23, kind: "network", room: null,
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

  // PR 3c closing round, point 2: a vector reading whose quantity the command cannot store (a 1,000-point square at an
  // accepted calibration of 1:100,000 reads 1,244,521,604.94 m²) is never an observation: it stays the result's own, and
  // the answer it matches says so.
  it("never attaches a vector reading whose quantity the command cannot store", () => {
    const kitchen = poste("00000000-0000-4000-8000-000000000051", "Sol cuisine", "m2");
    const fragments = read((call, key, local) => notFound(key, local.pages), { items: [kitchen] });
    const reading = mergePosteReadings({ items: [kitchen], planPages: PLAN_PAGES, fragments, vectorReadings: [
      { key: "v-huge", page: 22, kind: "surface", room: "Cuisine", designation: "Surface « Cuisine »", quantity: 1_244_521_604.94, unit: "m2",
        confidence: 0.8, evidence: "Surface du local lue sur le plan." },
      { key: "v-tiny", page: 22, kind: "surface", room: "Cuisine", designation: "Surface « Cuisine »", quantity: 0.0004, unit: "m2",
        confidence: 0.8, evidence: "Surface du local lue sur le plan." }] });
    const answer = answerOf(reading.answers, kitchen);
    expect(answer.observations).toEqual([]);
    expect(answer.reasons.map((reason) => reason.code)).toEqual(["VECTOR_READINGS_UNATTACHED"]);
    expect(reading.unattachedVectorReadings).toEqual(["v-huge", "v-tiny"]);
  });

  // PR 3c fix round, point 1: an answer holds at most 500 observations (TAKEOFF_ITEM_ANSWER_LIMITS); the vector readings an
  // item matches beyond them stay the result's own, never dropped, and the answer says so.
  it("leaves unattached the vector readings an answer cannot hold, and says so", () => {
    const ef = poste("00000000-0000-4000-8000-000000000041", "Alimentation EF", "ml", { network: "EF", material: "cuivre", diameter: "DN 22" });
    const fragments = read((call, key, local) => fragmentOf(call) === 1
      ? measured(key, local.pages, [{ page: 3, quantity: 12.5, unit: "ml" }]) : notFound(key, local.pages), { items: [ef] });
    const vectorReadings = Array.from({ length: TAKEOFF_ITEM_ANSWER_LIMITS.observations }, (_, index): PosteVectorReading => ({
      key: `v-${index}`, page: 23, kind: "network", room: null, designation: "EF cuivre DN 22", quantity: 12.5, unit: "ml", confidence: 0.9,
      evidence: "axe" }));
    const reading = mergePosteReadings({ items: [ef], planPages: PLAN_PAGES, fragments, vectorReadings });
    const answer = answerOf(reading.answers, ef);
    expect(answer.observations).toHaveLength(TAKEOFF_ITEM_ANSWER_LIMITS.observations);
    expect(answer).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 12.5, unit: "ml" } });
    expect(answer.reasons.map((reason) => reason.code)).toEqual(["VECTOR_READINGS_UNATTACHED"]);
    expect(reading.unattachedVectorReadings).toEqual([`v-${TAKEOFF_ITEM_ANSWER_LIMITS.observations - 1}`]);
  });

  it("keeps a vector reading two items could claim as a candidate of each, never as anyone's measure", () => {
    const first = poste("00000000-0000-4000-8000-000000000009", "Alimentation EF", "ml", { network: "EF", material: "cuivre", diameter: "DN 22" });
    const second = poste("00000000-0000-4000-8000-00000000000a", "Alimentation EF cuisine", "ml",
      { network: "EF", material: "cuivre", diameter: "DN 22" });
    const fragments = read((call, key, local) => fragmentOf(call) === 1 && key === "P0001"
      ? measured(key, local.pages, [{ page: 1, quantity: 7, unit: "ml" }]) : notFound(key, local.pages), { items: [first, second] });
    const { answers } = mergePosteReadings({ items: [first, second], planPages: PLAN_PAGES, fragments, vectorReadings: [
      { key: "v-1", page: 21, kind: "network", room: null, designation: "EF cuivre DN 22", quantity: 30, unit: "ml", confidence: 0.9, evidence: "axe" }] });

    expect(answerOf(answers, first)).toMatchObject({ outcome: "measured", quantity: { value: 7, unit: "ml" } });
    expect(roles(answerOf(answers, first))).toEqual([[21, 7, "contribution", "model"], [21, 30, "candidate", "vector"]]);
    expect(answerOf(answers, second)).toMatchObject({ outcome: "uncertain", candidate: null });
    expect(answerOf(answers, second).reasons).toContainEqual(expect.objectContaining({ code: "VECTOR_ONLY",
      text: "Tracé vectoriel commun à plusieurs postes." }));
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

  // Fix round, point 1: two readings of one object on one page are never added.
  describe("readings of one object", () => {
    const sol = poste("00000000-0000-4000-8000-000000000011", "Revêtement de sol", "m2");
    const area = (page: number, quantity: number, extra: Partial<Reading> = {}): Reading => ({ page, quantity, unit: "m2",
      method: "annotation", evidence: "surface imprimée dans la cuisine", ...extra });
    const run = (readings: Reading[]) => answerOf(mergePosteReadings({ items: [sol], planPages: PLAN_PAGES,
      fragments: read((call, key, local) => fragmentOf(call) === 1 ? measured(key, local.pages, readings) : notFound(key, local.pages),
        { items: [sol] }) }).answers, sol);

    it("adds only distinct readings: a second reading of the same 12 m² is an alternative", () => {
      const answer = run([area(2, 12), area(2, 12, { countsAs: "same_object", evidence: "cote du local, même surface", method: "scaled_measure" })]);
      expect(answer).toMatchObject({ outcome: "measured", quantity: { value: 12, unit: "m2" } });
      expect(roles(answer)).toEqual([[22, 12, "contribution", "model"], [22, 12, "alternative", "model"]]);
    });

    it("keeps two readings it cannot tell apart as candidates, never a sum", () => {
      const answer = run([area(2, 12), area(2, 12)]);
      expect(answer).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 12, unit: "m2" } });
      expect(answer.reasons.map((reason) => reason.code)).toEqual(["DUPLICATE_READING"]);
      expect(roles(answer)).toEqual([[22, 12, "candidate", "model"], [22, 12, "candidate", "model"]]);
    });

    it("makes uncertain a reading of an object nobody observed, and two readings of one object that differ", () => {
      expect(run([area(2, 12, { countsAs: "same_object" })]).reasons.map((reason) => reason.code)).toEqual(["SAME_OBJECT_UNCLEAR"]);
      expect(run([area(2, 12), area(2, 14, { countsAs: "same_object", evidence: "contour" })])).toMatchObject({ outcome: "uncertain",
        candidate: { value: 12, unit: "m2" } });
    });
  });

  // Fix round, point 2: a sum never mixes the bases of a measure.
  it("adds only measures on the item's requested basis, and refuses an unstated basis of a scaled measure", () => {
    const net = poste("00000000-0000-4000-8000-000000000012", "Chape", "m2", {}, "surface nette");
    const free = poste("00000000-0000-4000-8000-000000000013", "Isolant", "m2");
    const pieces = poste("00000000-0000-4000-8000-000000000014", "Siphon de sol", "u", {}, "à l’unité posée");
    const items = [net, free, pieces];
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (key === "P0001" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 12, unit: "m2", asRequested: true }]);
      if (key === "P0001" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 14, unit: "m2", basis: "surface brute" }]);
      if (key === "P0002" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 10, unit: "m2", method: "scaled_measure" }]);
      if (key === "P0003" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 2 }]);
      return notFound(key, local.pages);
    }, { items });
    const { answers } = mergePosteReadings({ items, planPages: PLAN_PAGES, fragments });

    expect(answerOf(answers, net)).toMatchObject({ outcome: "uncertain", quantity: null });
    expect(answerOf(answers, net).reasons.map((reason) => reason.code)).toEqual(["BASIS_MISMATCH"]);
    expect(answerOf(answers, free).reasons.map((reason) => reason.code)).toEqual(["BASIS_UNSTATED"]);
    // A count does not depend on a basis.
    expect(answerOf(answers, pieces)).toMatchObject({ outcome: "measured", quantity: { value: 2, unit: "u" } });

    const mixed = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (key === "P0002" && fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 12, unit: "m2", basis: "nette" }]);
      if (key === "P0002" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 14, unit: "m2", basis: "brute" }]);
      return notFound(key, local.pages);
    }, { items });
    expect(answerOf(mergePosteReadings({ items, planPages: PLAN_PAGES, fragments: mixed }).answers, free).reasons
      .map((reason) => reason.code)).toEqual(["BASIS_MISMATCH"]);
  });

  // Fix round, point 3: whole pieces agree exactly; the tolerance is for lengths and surfaces.
  it("asks an overlap reading of whole pieces to agree exactly, and of a length within 1 %", () => {
    const pipe = poste("00000000-0000-4000-8000-000000000015", "Tube PER", "ml");
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (key === "P0001" && fragment === 1) return measured(key, local.pages, [{ page: 5, quantity: 101 }]);
      if (key === "P0001" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 100 }]);
      if (key === "P0002" && fragment === 1) return measured(key, local.pages, [{ page: 5, quantity: 100.5, unit: "ml" }]);
      if (key === "P0002" && fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 100, unit: "ml" }]);
      return notFound(key, local.pages);
    }, { items: [LAVABO, pipe] });
    const { answers } = mergePosteReadings({ items: [LAVABO, pipe], planPages: PLAN_PAGES, fragments });
    expect(answerOf(answers, LAVABO)).toMatchObject({ outcome: "uncertain", quantity: null });
    expect(answerOf(answers, LAVABO).reasons.map((reason) => reason.code)).toEqual(["READINGS_DISAGREE"]);
    expect(answerOf(answers, pipe)).toMatchObject({ outcome: "measured", quantity: { value: 100, unit: "ml" } });
  });

  // Fix round, point 4: an absence is never certified against a matching reading of the same plan.
  it("attaches the vector surface of a room to its item: a « not found » becomes an indication to check", () => {
    const kitchen = poste("00000000-0000-4000-8000-000000000016", "Surface cuisine", "m2");
    const fragments = read((_call, key, local) => notFound(key, local.pages), { items: [kitchen] });
    const reading = mergePosteReadings({ items: [kitchen], planPages: PLAN_PAGES, fragments, vectorReadings: [
      { key: "v-cuisine", page: 24, kind: "surface", room: "Cuisine", designation: "Surface « Cuisine »", quantity: 12, unit: "m2",
        confidence: 0.9, evidence: "Aire du polygone fermé (12 points)." },
      { key: "v-sejour", page: 24, kind: "surface", room: "Séjour", designation: "Surface « Séjour »", quantity: 30, unit: "m2",
        confidence: 0.9, evidence: "Aire du polygone fermé (9 points)." }] });
    expect(answerOf(reading.answers, kitchen)).toMatchObject({ outcome: "uncertain", candidate: { value: 12, unit: "m2" } });
    expect(answerOf(reading.answers, kitchen).reasons.map((reason) => reason.code)).toEqual(["VECTOR_ONLY"]);
    expect(roles(answerOf(reading.answers, kitchen))).toEqual([[24, 12, "candidate", "vector"]]);
    expect(reading.unattachedVectorReadings).toEqual(["v-sejour"]);
  });

  // Fix round, point 5: a total at the stored precision.
  it("adds measures at the stored precision", () => {
    const pipe = poste("00000000-0000-4000-8000-000000000017", "Tube PER", "ml");
    const fragments = read((call, key, local) => fragmentOf(call) === 3 ? notFound(key, local.pages)
      : measured(key, local.pages, [{ page: 1, quantity: fragmentOf(call) === 1 ? 0.1 : 0.2, unit: "ml" }]), { items: [pipe] });
    expect(answerOf(mergePosteReadings({ items: [pipe], planPages: PLAN_PAGES, fragments }).answers, pipe).quantity)
      .toEqual({ value: 0.3, unit: "ml" });
  });

  // Closing round, point 1: an uncertain answer's candidate sums the readings on the requested basis only, or none.
  it("never offers as a candidate a sum of readings the answer refused to add", () => {
    const net = poste("00000000-0000-4000-8000-000000000021", "Chape", "m2", {}, "surface nette");
    const free = poste("00000000-0000-4000-8000-000000000022", "Isolant", "m2");
    const items = [net, free];
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 12, unit: "m2", method: "annotation",
        evidence: "surface nette du séjour", basis: "surface nette", asRequested: true }]);
      if (fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 14, unit: "m2", method: "annotation",
        evidence: "surface brute du séjour", basis: "surface brute", asRequested: false }]);
      return notFound(key, local.pages);
    }, { items });
    const { answers } = mergePosteReadings({ items, planPages: PLAN_PAGES, fragments });

    // Net 12 and gross 14, honestly declared: never 26 m², only the reading on the requested basis.
    expect(answerOf(answers, net)).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 12, unit: "m2" } });
    expect(answerOf(answers, net).reasons.map((reason) => reason.code)).toEqual(["BASIS_MISMATCH"]);
    // An item that names no basis, read on two: no candidate at all.
    expect(answerOf(answers, free)).toMatchObject({ outcome: "uncertain", quantity: null, candidate: null });
    expect(answerOf(answers, free).reasons.map((reason) => reason.code)).toEqual(["BASIS_MISMATCH"]);
  });

  // Closing round, point 2: a stated basis that contradicts the declaration, and a scaled measure that states none.
  it("makes uncertain a measure whose stated basis is not the requested one, whatever it declares", () => {
    const items = ["0023", "0024", "0025", "0026"].map((suffix, index) => poste(`00000000-0000-4000-8000-00000000${suffix}`,
      `Chape ${index + 1}`, "m2", {}, "Surface nette"));
    const readings: Reading[] = [
      { page: 1, quantity: 14, unit: "m2", method: "annotation", basis: "surface brute", asRequested: true },
      { page: 1, quantity: 12, unit: "m2", method: "scaled_measure", basis: null, asRequested: true },
      { page: 1, quantity: 12, unit: "m2", method: "scaled_measure", basis: "surface  NETTE.", asRequested: true },
      { page: 1, quantity: 12, unit: "m2", method: "annotation", basis: null, asRequested: true },
    ];
    const fragments = read((call, key, local) => fragmentOf(call) === 1
      ? measured(key, local.pages, [readings[Number(key.slice(1)) - 1]]) : notFound(key, local.pages), { items });
    const { answers } = mergePosteReadings({ items, planPages: PLAN_PAGES, fragments });

    expect(answers.map((answer) => [answer.outcome, answer.reasons.map((reason) => reason.code)])).toEqual([
      ["uncertain", ["BASIS_MISMATCH"]], ["uncertain", ["BASIS_UNSTATED"]], ["measured", []], ["measured", []]]);
  });

  // Closing round, point 3: every unit other than a length or a surface agrees exactly.
  it("asks an overlap reading of a volume to agree exactly", () => {
    const concrete = poste("00000000-0000-4000-8000-000000000027", "Béton de propreté", "m3");
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (fragment === 1) return measured(key, local.pages, [{ page: 5, quantity: 101, unit: "m3", method: "annotation" }]);
      if (fragment === 2) return measured(key, local.pages, [{ page: 1, quantity: 100, unit: "m3", method: "annotation" }]);
      return notFound(key, local.pages);
    }, { items: [concrete] });
    const answer = answerOf(mergePosteReadings({ items: [concrete], planPages: PLAN_PAGES, fragments }).answers, concrete);
    expect(answer).toMatchObject({ outcome: "uncertain", quantity: null });
    expect(answer.reasons.map((reason) => reason.code)).toEqual(["READINGS_DISAGREE"]);
  });

  // Closing round, point 4: an overlap page's readings are compared as a whole with its owner's.
  it("keeps measured an overlap page whose context reads the same objects as its owner", () => {
    const sol = poste("00000000-0000-4000-8000-000000000028", "Revêtement de sol", "m2");
    const rooms = (page: number, second = 8): Reading[] => [
      { page, quantity: 12, unit: "m2", method: "annotation", evidence: "chambre 1, surface imprimée" },
      { page, quantity: second, unit: "m2", method: "annotation", evidence: "chambre 2, surface imprimée" }];
    const run = (second: number) => answerOf(mergePosteReadings({ items: [sol], planPages: PLAN_PAGES, fragments: read((call, key, local) => {
      const fragment = fragmentOf(call);
      // The plan's page 25: fragment 1's context page 5, fragment 2's own page 1.
      if (fragment === 1) return measured(key, local.pages, rooms(5, second));
      if (fragment === 2) return measured(key, local.pages, rooms(1));
      return notFound(key, local.pages);
    }, { items: [sol] }) }).answers, sol);

    expect(run(8)).toMatchObject({ outcome: "measured", quantity: { value: 20, unit: "m2" }, reasons: [] });
    expect(roles(run(8))).toEqual([[25, 12, "alternative", "model"], [25, 8, "alternative", "model"], [25, 12, "contribution", "model"],
      [25, 8, "contribution", "model"]]);
    expect(run(9)).toMatchObject({ outcome: "uncertain", quantity: null });
    expect(run(9).reasons.map((reason) => reason.code)).toEqual(["READINGS_DISAGREE"]);
  });

  // Closing round, point 5: a room's surface only keeps an absence from being certified; it never changes a measure.
  it("attaches a room's vector surface to a measured answer without changing its outcome or its quantity", () => {
    const tiles = poste("00000000-0000-4000-8000-000000000029", "Faïence murale cuisine", "m2");
    const fragments = read((call, key, local) => fragmentOf(call) === 1
      ? measured(key, local.pages, [{ page: 4, quantity: 28, unit: "m2", method: "annotation", evidence: "développé des murs" }])
      : notFound(key, local.pages), { items: [tiles] });
    const answer = answerOf(mergePosteReadings({ items: [tiles], planPages: PLAN_PAGES, fragments, vectorReadings: [
      { key: "v-cuisine", page: 24, kind: "surface", room: "Cuisine", designation: "Surface « Cuisine »", quantity: 12, unit: "m2",
        confidence: 0.9, evidence: "Aire du polygone fermé (12 points)." }] }).answers, tiles);

    expect(answer).toMatchObject({ outcome: "measured", quantity: { value: 28, unit: "m2" }, candidate: null, reasons: [] });
    expect(roles(answer)).toEqual([[24, 28, "contribution", "model"], [24, 12, "alternative", "vector"]]);
  });

  // Closing round, point 6: a whole number is checked on the value as read; its rounding never makes it one.
  it("checks a count's whole number on the value as read, before its rounding", () => {
    const fragments = read((call, key, local) => fragmentOf(call) === 1 && key === "P0001"
      ? measured(key, local.pages, [{ page: 1, quantity: 1.0004 }]) : notFound(key, local.pages));
    const lavabo = answerOf(mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments }).answers, LAVABO);
    expect(lavabo).toMatchObject({ outcome: "uncertain", quantity: null });
    expect(lavabo.reasons.map((reason) => reason.code)).toEqual(["NON_INTEGER_COUNT"]);
    // What publishes stays at the stored precision.
    expect(lavabo.observations[0].quantity).toBe(1);
  });

  // PR 3c fix round, point 1: a reason that repeats across fragments (same code, same text) is stored once, with the first
  // fragment that gave it; distinct ones are all kept.
  it("stores a reason the fragments repeat once, keeping the first fragment that gave it", () => {
    const fragments = read((call, key, local) => key === "P0002" && fragmentOf(call) === 3
      ? { ...notFound(key, local.pages), reason_text: "Aucun WC sur ces pages." } as PosteExchangeAnswer : notFound(key, local.pages));
    const { answers } = mergePosteReadings({ items: ITEMS, planPages: PLAN_PAGES, fragments });
    expect(answerOf(answers, LAVABO).reasons).toEqual([{ code: "NO_INDICATION", by: "model", text: "Aucun indice sur les pages lues.",
      chunkId: "f1-b1" }]);
    expect(answerOf(answers, WC).reasons.map((reason) => [reason.text, reason.chunkId])).toEqual([
      ["Aucun indice sur les pages lues.", "f1-b1"], ["Aucun WC sur ces pages.", "f3-b1"]]);
  });

  // PR 3c fix round, point 2: the command stores a total or a candidate value up to 999,999,999.999999; beyond it, no measure.
  it("never gives a total or a candidate value beyond what the command stores", () => {
    const pipe = poste("00000000-0000-4000-8000-000000000031", "Tube PER", "ml");
    const fragments = read((call, key, local) => {
      const fragment = fragmentOf(call);
      if (fragment === 1) return measured(key, local.pages, [{ page: 1, quantity: 500_000_000, unit: "ml", evidence: "tronçon nord" },
        { page: 2, quantity: 500_000_000, unit: "ml", evidence: "tronçon sud" }]);
      return notFound(key, local.pages);
    }, { items: [pipe] });
    const answer = answerOf(mergePosteReadings({ items: [pipe], planPages: PLAN_PAGES, fragments }).answers, pipe);
    expect(answer).toMatchObject({ outcome: "uncertain", quantity: null, candidate: null });
    expect(answer.reasons.map((reason) => reason.code)).toEqual(["QUANTITY_OUT_OF_RANGE"]);
    expect(answer.observations.map((entry) => entry.role)).toEqual(["candidate", "candidate"]);
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
