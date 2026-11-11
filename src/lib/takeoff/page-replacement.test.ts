import { describe, expect, it } from "vitest";

import type { TakeoffPageIdentity } from "@/lib/takeoff/page-contributions";
import {
  designationTokens,
  jaccard,
  lengthFactor,
  mergeMatches,
  proposePagePairs,
  replacementQuantities,
  unitKey,
  type ReplacementCandidate,
  type ReplacementNewLine,
  type ReplacementSourceLine,
} from "@/lib/takeoff/page-replacement";

// TI-682 lot D, PR 2: the pairing the server proposes when a page is measured again, and the quantities a replacement
// gives. The database refuses what this proposal never offers (a pair of two units, a pair across two documents, a DPGF
// target paired): each refusal has its case below. Fictional designations and identifiers only.

const PLAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (document: Partial<TakeoffPageIdentity["document"]>, page: number | null = 1): TakeoffPageIdentity => ({
  document: { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf", ...document }, page,
});
const onA = at({ plan_file_id: PLAN_A });

const fresh = (n: number, designation: string, unit: string, quantity: number, extra: Partial<ReplacementNewLine> = {}): ReplacementNewLine =>
  ({ id: id(n), designation, unit, quantity, identity: onA, ...extra });
const source = (n: number, designation: string, unit: string, quantity: number, extra: Partial<ReplacementSourceLine> = {}): ReplacementSourceLine =>
  ({ id: id(n), job_id: id(9000), designation, unit, quantity, identity: onA, ...extra });
const line = (n: number, title: string, unitCode: string | null, sources: ReplacementSourceLine[], extra: Partial<ReplacementCandidate> = {}): ReplacementCandidate =>
  ({ id: id(n), title, unit_code: unitCode, description: unitCode, pricing_status: "priced", source_provider: "takeoff", sources, ...extra });

describe("proposePagePairs — which new line replaces which earlier line", () => {
  it("pairs by the earlier source line's designation, not the estimator's renamed title", () => {
    const pairs = proposePagePairs({
      newLines: [fresh(101, "EF cuivre DN 20", "ml", 15.2)],
      candidates: [line(201, "Réseau EF chiffré", "ml", [source(1, "EF cuivre DN 20", "ml", 12.4)])],
    });
    expect(pairs).toEqual([{ takeoff_item_id: id(101), estimate_item_id: id(201), source_item_id: id(1), reason: "same_designation" }]);
  });

  it("pairs a vector run by its network identity when the reading renamed it", () => {
    const network = { kind: "network", network: "EF", material: "cuivre", dn: "20" };
    const pairs = proposePagePairs({
      newLines: [fresh(101, "Eau froide R+1", "ml", 21, { rule_inputs: network })],
      candidates: [line(201, "EF DN 20", "ml", [source(1, "EF DN 20", "ml", 20, { rule_inputs: network })])],
    });
    expect(pairs.map((pair) => pair.reason)).toEqual(["same_network"]);
  });

  it("pairs a close designation (Jaccard ≥ 0.5) and leaves a distant one unpaired", () => {
    const pairs = proposePagePairs({
      newLines: [fresh(101, "WC suspendu PMR", "u", 2), fresh(102, "Lave-mains", "u", 1)],
      candidates: [line(201, "WC suspendu", "u", [source(1, "WC suspendu", "u", 2)])],
    });
    expect(pairs).toEqual([{ takeoff_item_id: id(101), estimate_item_id: id(201), source_item_id: id(1), reason: "similar_designation" }]);
  });

  it("never pairs two units: another unit is another quantity", () => {
    expect(proposePagePairs({
      newLines: [fresh(101, "EF cuivre DN 20", "u", 3)],
      candidates: [line(201, "EF cuivre DN 20", "ml", [source(1, "EF cuivre DN 20", "ml", 12)])],
    })).toEqual([]);
    // A unit the referential does not know is never paired either (the database compares unit codes).
    expect(proposePagePairs({
      newLines: [fresh(101, "EF cuivre DN 20", "métrage", 3)],
      candidates: [line(201, "EF cuivre DN 20", null, [source(1, "EF cuivre DN 20", "métrage", 12)], { description: "métrage" })],
    })).toEqual([]);
  });

  it("serves each earlier source once, and lets two new runs replace the two sources of one merged length", () => {
    const merged = line(201, "EF cuivre DN 20", "ml", [source(1, "EF cuivre DN 20", "ml", 10.2), source(2, "EF cuivre DN 20", "ml", 5.3)]);
    const pairs = proposePagePairs({ newLines: [fresh(101, "EF cuivre DN 20", "ml", 10), fresh(102, "EF cuivre DN 20", "ml", 5),
      fresh(103, "EF cuivre DN 20", "ml", 1)], candidates: [merged] });
    expect(pairs.map((pair) => [pair.takeoff_item_id, pair.source_item_id])).toEqual([[id(101), id(1)], [id(102), id(2)]]);
  });

  it("never pairs an ouvrage's component: its quantity is the ouvrage's", () => {
    expect(proposePagePairs({
      newLines: [fresh(101, "Collier", "u", 7)],
      candidates: [line(201, "Collier", "u", [source(1, "Collier", "u", 6)], { assembly: true })],
    })).toEqual([]);
  });

  it("never pairs a DPGF target: its own policy replaces it per takeoff", () => {
    expect(proposePagePairs({
      newLines: [fresh(101, "EF cuivre DN 22", "ml", 30)],
      candidates: [line(201, "EF cuivre DN 22", "ml", [source(1, "EF cuivre DN 22", "ml", 30)], { source_provider: "dpgf" })],
    })).toEqual([]);
  });

  it("pairs an engine 1/2 line, which names no source, by its title, once", () => {
    const pairs = proposePagePairs({
      newLines: [fresh(101, "WC suspendu", "u", 5), fresh(102, "WC suspendu", "u", 1)],
      candidates: [line(201, "WC suspendu", null, [], { description: "u" })],
    });
    expect(pairs).toEqual([{ takeoff_item_id: id(101), estimate_item_id: id(201), source_item_id: null, reason: "same_designation" }]);
  });

  it("never replaces across two documents", () => {
    // A new line of plan A, an earlier line of plan B of the same name (the row PR 1 groups by name).
    expect(proposePagePairs({
      newLines: [fresh(101, "WC suspendu", "u", 5)],
      candidates: [line(201, "WC suspendu", "u", [source(1, "WC suspendu", "u", 4, { identity: at({ plan_file_id: PLAN_B }) })])],
    })).toEqual([]);
    // A new line known only by its name, where two identified plans of that name meet: no pair at all.
    const nameOnly = at({});
    expect(proposePagePairs({
      newLines: [fresh(101, "WC suspendu", "u", 5, { identity: nameOnly })],
      candidates: [line(201, "WC suspendu", "u", [source(1, "WC suspendu", "u", 4)]),
        line(202, "Vanne", "u", [source(2, "Vanne", "u", 3, { identity: at({ plan_file_id: PLAN_B }) })])],
    })).toEqual([]);
    // Known only by its name, with one identified plan of that name on the page: it is that plan.
    expect(proposePagePairs({
      newLines: [fresh(101, "WC suspendu", "u", 5, { identity: nameOnly })],
      candidates: [line(201, "WC suspendu", "u", [source(1, "WC suspendu", "u", 4)])],
    }).map((pair) => pair.estimate_item_id)).toEqual([id(201)]);
  });

  it("keeps the pairs « Fusionner » imposes and pairs the other lines around them", () => {
    const pairs = proposePagePairs({
      newLines: [fresh(101, "WC suspendu", "u", 5), fresh(102, "WC suspendu", "u", 2)],
      candidates: [line(201, "WC suspendu", "u", [source(1, "WC suspendu", "u", 4)]), line(202, "WC suspendu", "u", [source(2, "WC suspendu", "u", 2)])],
      forced: [{ takeoff_item_id: id(101), estimate_item_id: id(202), source_item_id: id(2), reason: "merge" }],
    });
    expect(pairs.map((pair) => [pair.takeoff_item_id, pair.estimate_item_id, pair.reason]))
      .toEqual([[id(101), id(202), "merge"], [id(102), id(201), "same_designation"]]);
  });
});

describe("replacementQuantities — what a replacement gives an earlier line", () => {
  it("takes the replaced page's part out and the new measure in, rounded once for a length", () => {
    expect(replacementQuantities({ quantity: 16, factor: 1, sources: [{ id: id(1), quantity: 10.2 }, { id: id(2), quantity: 5.3 }],
      removedSourceIds: new Set([id(1)]), added: [{ quantity: 8.1 }] })).toEqual({ current: 16, measured: 16, changedByHand: false, next: 14 });
  });
  it("tells a quantity changed by hand", () => {
    expect(replacementQuantities({ quantity: 6, factor: null, sources: [{ id: id(1), quantity: 4 }],
      removedSourceIds: new Set([id(1)]), added: [{ quantity: 5 }] })).toMatchObject({ measured: 4, changedByHand: true, next: 5 });
  });
  it("replaces an engine 1/2 line whole, and asks: whether its quantity was changed by hand cannot be seen", () => {
    expect(replacementQuantities({ quantity: 4, factor: null, sources: [], removedSourceIds: new Set(),
      added: [{ quantity: 5 }] })).toEqual({ current: 4, measured: null, changedByHand: true, next: 5 });
  });
  it("takes a length applied before TI-681, its raw measure never rounded, for no change by hand", () => {
    expect(replacementQuantities({ quantity: 10.2, factor: 1, sources: [{ id: id(1), quantity: 10.2 }], removedSourceIds: new Set([id(1)]),
      added: [{ quantity: 8 }] })).toEqual({ current: 10.2, measured: 11, changedByHand: false, next: 8 });
  });
  it("rounds centimetres to the metre, as finalize_takeoff_lengths does", () => {
    expect(lengthFactor({ unit_code: "cm", description: null })).toBe(0.01);
    expect(replacementQuantities({ quantity: 200, factor: 0.01, sources: [{ id: id(1), quantity: 150 }],
      removedSourceIds: new Set([id(1)]), added: [{ quantity: 101 }] }).next).toBe(200);
  });
});

describe("the helpers the pairing rests on", () => {
  it("reads units as the database does", () => {
    expect([unitKey("ml"), unitKey("M²"), unitKey("u"), unitKey("forfait"), unitKey("PM"), unitKey("métrage")]).toEqual(["ml", "m2", "u", "fft", "status:for_memory", null]);
  });
  it("compares words without accents nor one-letter words", () => {
    expect([...designationTokens("Vanne d’arrêt DN 20 à sphère")]).toEqual(["vanne", "arret", "dn", "20", "sphere"]);
    expect(jaccard("WC suspendu PMR", "WC suspendu")).toBeCloseTo(2 / 3);
  });
  it("replays « Fusionner »: same title and unit at the same rank in the target section", () => {
    expect(mergeMatches([{ id: id(101), designation: "WC  suspendu", unit: "u" }, { id: id(102), designation: "wc suspendu", unit: "u" },
      { id: id(103), designation: "Vanne", unit: "ml" }],
    [{ id: id(201), title: "WC suspendu", unit_code: "u", pricing_status: "priced", position: 2 },
      { id: id(202), title: "Vanne", unit_code: "u", pricing_status: "priced", position: 1 }]))
      .toEqual(new Map([[id(101), id(201)]]));
  });
});
