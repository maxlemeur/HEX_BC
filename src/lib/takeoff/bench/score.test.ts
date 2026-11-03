import { describe, expect, it } from "vitest";

import { BENCH_TOLERANCES, buildScoreScopes, scoreScopes, withinTolerance, type ScopeScore } from "@/lib/takeoff/bench/score";
import { ManifestDocumentSchema, TruthFileSchema, type ManifestDocument } from "@/lib/takeoff/bench/schemas";
import type { TakeoffItem } from "@/lib/takeoff/types";

// Ways the per-key score of the takeoff bench (TI-660) could misreport a plan
// reading, written before the code. Every document, label and quantity is fictional:
// - a tolerance is applied with the wrong formula or unit: counts not exact, a
//   length outside ±10 % or a surface outside max(2 %, 0.5 m²) let through;
// - two sections of one key are not added, or are reported as a double count;
// - a key not observable on the plan is reported missed, or the item that reads
//   it a false positive; an ambiguous line or an unscored unit enters the score;
// - the items of a truth that covers two documents are not added; two truth
//   files that cover one plan (two devis) are scored apart instead of added;
// - counts are split by network although they are scored by zone x organ x DN;
//   the lot C atelier and chantier lines of a key are not added;
// - a missing attribute (material) is taken as a wildcard;
// - a cause is wrong or out of priority: plan_cause after the « nous » causes,
//   a wrong network or DN not recognised (one difference only), two
//   differences taken as a wrong DN, a double count not seen (two identical
//   items on two pages, or a Z2 key read on the Z1 plan), several sections taken
//   as a double count, a deviation without rule not « indéterminé » with its sign;
// - a missed key without plan_cause is not counted as not reviewed;
// - an unreadable item is not a false positive « indéterminé »;
// - a zone is guessed: an item outside the page ranges, or a document with no zone
//   under a truth with zones, is attributed instead of reported;
// - repeated rooms (« #2 ») are scored apart while the items cannot tell them apart;
// - a scope with a document that did not run is scored.
// Found in review, written before their fix:
// - a key without a series of its own (a count, an insulation) takes an item
//   printed with the next DN up or down as its own (DN 20 for DN 15, through a
//   multilayer 20 whose nominal is 15), so a wrong DN is counted right;
// - a key that adds an observable line and a line the plan cannot give is
//   scored against the observable share while every item it reads is added;
// - causes are counted in two units: keys and keyed false-positive groups once,
//   unreadable items one by one under the label of out-of-tolerance keys;
// - a truth without zone or level over documents that have one matches nothing.
// Found in the second review, written before their fix:
// - the high-confidence error rate checks copies of the items against the
//   originals: an out-of-tolerance or invented item is no error, an item of an
//   out-of-score key stays counted; candidates add keys, groups and single items;
// - a count or a network key the truth prices in an unscored unit, or keeps off
//   the plan in another unit (a WC « ens », an insulation in m2), protects no
//   item: the item that reads it in u or ml is « nous:invente »;
// - a scored key read in another unit is « nous:invente » instead of a unit gap;
// - one wrong network, DN or unit is counted twice, on the missed key and on
//   its false-positive group;
// - a reviewed plan cause on the missed key is « plan » on the key side and
//   « nous » on the side of the item it pairs with;
// - a main-scope item is a double count because of a key of the reserve.
// Found by the first real run, written before their fix:
// - a key whose item was extracted but could not be read (a room the reader
//   could not attach, a pipe without network) is « nous:manque », while the
//   item is counted again as « indetermine:illisible »: the miss of the reader
//   is blamed on the model;
// - an unreadable item stands for any missed key: one with another area,
//   another DN, or another kind (a locker count for a missed WC), or for
//   several missed keys at once;
// - one false-positive group pairs with two missed keys, so a single wrong
//   network is counted as two deviations.
// Found in the third review, written before their fix:
// - an insulation surface read without its network is « nous:manque » on the
//   m2 key and a separate unreadable group, two causes for one reader miss,
//   where the same item in ml is one « indetermine:illisible » deviation;
// - a room surface whose evidence names a nearby network is a missed room and
//   an invented network item, two « nous » causes for a right reading.
// Found in the fourth review, written before their fix:
// - a room surface whose room is not read, and whose evidence names the
//   calorifuge material or a network nearby, is an unpaired insulation or an
//   invented network item, and its missed room « nous:manque », instead of
//   one « indetermine:illisible » deviation paired with that room.
// Confounded networks (score v3, TI-662), written before the tests:
// - a devis pricing EU and EV together (EUV) sees the EU and EV items the plan
//   labels apart as a missed key and two invented items, instead of one key
//   adding them; supply and return items (CHW-S, CHW-R) are not added on their
//   CHW key;
// - an EU item is rolled up into EUV although the scope prices EU apart: the EU
//   key is missed and the EUV key over-counted;
// - a RECS item (a return loop, priced apart) is taken for ECS;
// - an unreadable item hesitating between CHW-S and CHW-R is never the missed
//   CHW key (its networks are not rolled up), so the reader's miss is blamed
//   on the model (« nous:manque »).

type Json = Record<string, unknown>;

function manifestDocument(id: string, overrides: Json = {}): ManifestDocument {
  const [lot, kind] = id.split("-");
  return ManifestDocumentSchema.parse({
    id, lot, kind, drive_id: `fixture-${id}`, original_title: `Fictional ${id}`, project: null, file_type: "pdf",
    file_size: 100, modified_time: "2026-01-06T10:00:00.000Z", raw_status: "binary", raw_path: `raw/${id}.pdf`,
    sha256: "0".repeat(64), structure_check: { status: "passed", method: "fixture", detail: null }, pages: 1,
    format: "A0", scale: "1/50", index: "A", vector: true, ocg_count: 0, level: "R+1", zone: "Z1", role: "truth",
    duplicate_of: null, notes: null, ...overrides,
  });
}

let row = 0;
function line(overrides: Json = {}): Json {
  row += 1;
  return {
    kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", organ: null, room: null,
    unit: "ml", quantity: 10, observable_on_plan: true,
    source: { document: "a-devis-01", sheet: "Lot", row, row_basis: "workbook", text: "Fictional row" },
    ...overrides,
  };
}

function truth(file: string, documents: string[], lines: Json[], overrides: Json = {}) {
  return {
    file,
    truth: TruthFileSchema.parse({
      schema_version: 1, lot: "a", scope: documents.length === 1 ? "document" : "level", documents,
      source_document: "a-devis-01", rules: "Fictional rule.", lines, ...overrides,
    }),
  };
}

function item(designation: string, quantity: number, unit = "ml", page = 1, extra: Partial<TakeoffItem> = {}): TakeoffItem {
  return { designation, quantity, unit, source_page: page, confidence: 0.9, evidence: "Fictional evidence", ...extra };
}

const Z1 = manifestDocument("a-plan-01");
const Z2 = manifestDocument("a-plan-02", { zone: "Z2" });

function score(truthFiles: ReturnType<typeof truth>[], items: Record<string, TakeoffItem[]>, documents = [Z1, Z2]) {
  return scoreScopes(buildScoreScopes(truthFiles, documents), new Map(Object.entries(items)));
}

function only(scopes: ScopeScore[]) {
  expect(scopes).toHaveLength(1);
  return scopes[0];
}

function causeLabels(scope: ScopeScore) {
  return {
    keys: scope.keys.filter((key) => key.cause !== null).map((key) => `${key.key.network ?? key.key.organ ?? key.key.room} ${key.key.dn}: ${key.cause?.label}`).sort(),
    falsePositives: scope.false_positives.map((group) => `${group.key?.network ?? group.reason} ${group.key?.dn ?? ""}: ${group.cause.label}`).sort(),
  };
}

describe("takeoff bench tolerances", () => {
  it("are exact for counts, ±10 % for lengths and max(2 %, 0.5 m²) for surfaces", () => {
    expect(BENCH_TOLERANCES).toEqual({ u: { absolute: 0, relative: 0 }, ml: { absolute: 0, relative: 0.1 }, m2: { absolute: 0.5, relative: 0.02 } });
    expect([withinTolerance("u", 3, 3), withinTolerance("u", 3, 4), withinTolerance("u", 3, 2)]).toEqual([true, false, false]);
    expect([withinTolerance("ml", 10, 11), withinTolerance("ml", 10, 9), withinTolerance("ml", 10, 11.01), withinTolerance("ml", 10, 8.99)])
      .toEqual([true, true, false, false]);
    expect([withinTolerance("m2", 10, 10.5), withinTolerance("m2", 10, 10.51), withinTolerance("m2", 100, 102), withinTolerance("m2", 100, 102.1)])
      .toEqual([true, false, true, false]);
  });
});

describe("takeoff bench per-key score", () => {
  it("adds the sections of one key without calling them a double count", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line({ quantity: 12.5 })])], {
      "a-plan-01": [item("EF cuivre DN 22", 6, "ml", 1), item("EF cuivre DN 22 suite", 6.5, "ml", 2)],
    }, [Z1]));
    expect(scope.keys).toMatchObject([{ status: "ok", expected: 12.5, actual: 12.5, items: 2, cause: null }]);
    expect(scope.false_positives).toEqual([]);
  });

  it("keeps a non-observable key, an ambiguous line and an unscored unit out of the score, with their reason", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "EV", material: "pvc", dn: "DN 100", quantity: 6, observable_on_plan: false, plan_cause: "vertical" }),
      line({ network: "EP", material: "pvc", dn: "DN 100", quantity: null, ambiguous: true, ambiguity_reason: "Fictional reason." }),
      line({ kind: "count", network: "EF", material: null, dn: null, organ: "compteur", unit: "ens", quantity: 1 }),
    ])], { "a-plan-01": [item("EV PVC DN 100", 6), item("EP PVC DN 100", 3), item("Compteur EF", 1, "ens")] }, [Z1]));
    expect(scope.keys.map((key) => [key.status, key.reason, key.plan_causes])).toEqual([
      ["out_of_score", "unit", []],
      ["out_of_score", "ambiguous", []],
      ["out_of_score", "not_observable", ["vertical"]],
    ]);
    expect(scope.false_positives).toEqual([]);
    expect(scope.counts).toMatchObject({ keys_scored: 0, keys_missed: 0, out_of_score_items: 3, false_positive_groups: 0 });
  });

  it("adds the items of the documents a truth covers, and the lines of truth files covering one plan", () => {
    const halfA = manifestDocument("a-plan-01", { zone: null });
    const halfB = manifestDocument("a-plan-02", { zone: null });
    const level = only(score([truth("truth/a-r1.json", ["a-plan-01", "a-plan-02"], [line({ zone: null, quantity: 20 })])], {
      "a-plan-01": [item("EF cuivre DN 22", 8)], "a-plan-02": [item("EF cuivre DN 22", 12)],
    }, [halfA, halfB]));
    expect(level.keys).toMatchObject([{ status: "ok", expected: 20, actual: 20 }]);

    const twoDevis = only(score([
      truth("truth/a-plan-01.json", ["a-plan-01"], [line({ quantity: 10 })]),
      truth("truth/a-plan-01-other.json", ["a-plan-01"], [line({ quantity: 5 })], { scope: "level" }),
    ], { "a-plan-01": [item("EF cuivre DN 22", 15)] }, [Z1]));
    expect(twoDevis.truth_files).toEqual(["truth/a-plan-01-other.json", "truth/a-plan-01.json"]);
    expect(twoDevis.keys).toMatchObject([{ status: "ok", expected: 15, actual: 15, lines: 2 }]);
  });

  it("scores counts by zone x organ x DN across networks, and adds the lot C phases of a key", () => {
    const counts = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ kind: "count", network: "EF", material: null, dn: "DN 20", organ: "vanne", unit: "u", quantity: 2 }),
      line({ kind: "count", network: "ECS", material: null, dn: "DN 20", organ: "vanne", unit: "u", quantity: 3 }),
    ])], { "a-plan-01": [item("Vanne EF DN 20", 2, "u"), item("Vanne ECS DN 20", 3, "u")] }, [Z1]));
    expect(counts.keys).toMatchObject([{ key: { kind: "count", organ: "vanne", network: null }, status: "ok", expected: 5, actual: 5 }]);

    const modulePlan = manifestDocument("c-plan-01", { zone: null });
    const phases = only(score([truth("truth/c-plan-01.json", ["c-plan-01"], [
      line({ zone: null, network: "CHW-S", material: "inox-316l", dn: "DN 22", quantity: 4, devis_quantity: 4, module_scope: "commun", phase: "atelier" }),
      line({ zone: null, network: "CHW-S", material: "inox-316l", dn: "DN 22", quantity: 3, devis_quantity: 3, module_scope: "commun", phase: "chantier" }),
    ], { lot: "c", modules_on_plan: 2, source_document: "c-devis-01" })], { "c-plan-01": [item("CHW-S inox 316L 22x1,2", 7)] }, [modulePlan]));
    expect(phases.keys).toMatchObject([{ status: "ok", expected: 7, actual: 7, lines: 2 }]);
  });

  it("takes no missing attribute as a wildcard", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], { "a-plan-01": [item("EF DN 22", 10)] }, [Z1]));
    expect(causeLabels(scope)).toEqual({ keys: ["EF DN 22: nous:manque"], falsePositives: ["EF DN 22: nous:invente"] });
  });

  it("gives plan_cause first, then a wrong network or DN with one difference, then missed and invented", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "EF", material: "cuivre", dn: "DN 22" }),
      line({ network: "EF", material: "multicouche", dn: "DN 20", quantity: 4 }),
      line({ network: "ECS", material: "acier-noir", dn: "DN 50", quantity: 5 }),
      line({ network: "EP", material: "pvc", dn: "DN 100", quantity: 3, plan_cause: "not_drawn" }),
      line({ network: "EU", material: "pvc", dn: "DN 100", quantity: 7, plan_cause: "no_separation" }),
    ])], {
      "a-plan-01": [
        item("EF cuivre DN 28", 10), item("ECS multicouche DN 20", 4), item("RECS PER DN 32", 5),
        item("EU PVC DN 100", 7, "ml", 1), item("EU PVC DN 100", 7, "ml", 2),
      ],
    }, [Z1]));
    expect(causeLabels(scope)).toEqual({
      keys: [
        "ECS DN 50: nous:manque",
        "EF DN 20: nous:mauvais_reseau",
        "EF DN 22: nous:mauvais_dn",
        "EP DN 100: plan:not_drawn",
        "EU DN 100: plan:no_separation",
      ],
      falsePositives: ["ECS DN 20: nous:mauvais_reseau", "EF DN 28: nous:mauvais_dn", "RECS DN 32: nous:invente"],
    });
    // A reviewed miss carries a plan_cause; the other misses are counted as not reviewed.
    expect(scope.counts.not_reviewed).toBe(3);
  });

  it("calls a sum above tolerance a double count only with two identical items on two pages", () => {
    const duplicated = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], {
      "a-plan-01": [item("EF cuivre DN 22", 10, "ml", 1), item("EF cuivre DN 22", 10, "ml", 2)],
    }, [Z1]));
    expect(duplicated.keys).toMatchObject([{ status: "out_of_tolerance", actual: 20, cause: { label: "nous:compte_deux_fois" } }]);

    const sections = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], {
      "a-plan-01": [item("EF cuivre DN 22", 10, "ml", 1), item("EF cuivre DN 22", 8, "ml", 2)],
    }, [Z1]));
    expect(sections.keys).toMatchObject([{ cause: { label: "indetermine", sign: "+", relative_deviation: 0.8 } }]);

    const below = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], { "a-plan-01": [item("EF cuivre DN 22", 5)] }, [Z1]));
    expect(below.keys).toMatchObject([{ cause: { label: "indetermine", sign: "-", relative_deviation: -0.5 } }]);
  });

  it("calls a Z1 item whose key exists only in Z2 a double count, and an unreadable item « indéterminé »", () => {
    const scopes = score([
      truth("truth/a-plan-01.json", ["a-plan-01"], [line()]),
      truth("truth/a-plan-02.json", ["a-plan-02"], [line({ zone: "Z2", network: "ECS", dn: "DN 18", quantity: 4 })]),
    ], {
      "a-plan-01": [item("EF cuivre DN 22", 10), item("ECS cuivre DN 18", 4), item("EP PVC DN 100", 2), item("Tube cuivre DN 22", 3)],
      "a-plan-02": [item("ECS cuivre DN 18", 4)],
    });
    const z1 = scopes.find((scope) => scope.documents.includes("a-plan-01")) as ScopeScore;
    expect(causeLabels(z1).falsePositives).toEqual([
      "ECS DN 18: nous:compte_deux_fois", "EP DN 100: nous:invente", "network_missing : indetermine:illisible",
    ]);
    expect(z1.counts).toMatchObject({ items: 4, attached: 3, unreadable: 1, attachment_rate: 0.75 });
  });

  it("reads zones from page ranges and never guesses a zone the manifest does not give", () => {
    const sheet = manifestDocument("a-plan-01", {
      zone: null, pages: 3, page_ranges: [{ from: 1, to: 1, level: null, zone: "Z1" }, { from: 2, to: 2, level: null, zone: "Z2" }],
    });
    const ranged = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line({ quantity: 5 }), line({ zone: "Z2", quantity: 6 })])], {
      "a-plan-01": [item("EF cuivre DN 22", 5, "ml", 1), item("EF cuivre DN 22", 6, "ml", 2), item("EF cuivre DN 22", 7, "ml", 3)],
    }, [sheet]));
    expect(ranged.keys.map((key) => [key.key.zone, key.status])).toEqual([["Z1", "ok"], ["Z2", "ok"]]);
    expect(ranged.false_positives).toMatchObject([{ reason: "zone_unresolved", items: 1, cause: { label: "indetermine:illisible" } }]);

    const noZone = manifestDocument("a-plan-01", { zone: null });
    const unattributed = score([truth("truth/a-plan-01.json", ["a-plan-01"], [line({ quantity: 5 }), line({ zone: "Z2", quantity: 6 })])], {
      "a-plan-01": [item("EF cuivre DN 22", 11)],
    }, [noZone]);
    expect(only(unattributed).warnings.join(" ")).toMatch(/a-plan-01.*Z1, Z2/);
    expect(only(unattributed).false_positives).toMatchObject([{ reason: "zone_unresolved" }]);
  });

  it("adds the areas of rooms repeated on a level, which the items cannot tell apart", () => {
    const plan = manifestDocument("d-plan-01", { zone: null, level: "RDC", scale: "1/100" });
    const scope = only(score([truth("truth/d-plan-01.json", ["d-plan-01"], [
      line({ kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, room: "Sellerie", unit: "m2", quantity: 12,
        source: { document: "d-plan-01", sheet: null, row: null, page: 1, text: "Fictional" } }),
      line({ kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, room: "Sellerie #2", unit: "m2", quantity: 10,
        source: { document: "d-plan-01", sheet: null, row: null, page: 1, text: "Fictional" } }),
    ], { lot: "d", source_document: "d-plan-01" })], { "d-plan-01": [item("Sellerie", 12, "m²"), item("Sellerie", 10.4, "m²", 1)] }, [plan]));
    expect(scope.keys).toMatchObject([{ key: { kind: "surface", room: "Sellerie" }, status: "ok", expected: 22, actual: 22.4 }]);
  });

  it.each([
    ["a count DN 15 read DN 20", line({ kind: "count", network: "EF", material: null, dn: "DN 15", organ: "vanne", unit: "u", quantity: 4 }),
      item("Vanne EF DN 20", 4, "u")],
    ["a count DN 25 read DN 32", line({ kind: "count", network: "EF", material: null, dn: "DN 25", organ: "vanne", unit: "u", quantity: 4 }),
      item("Vanne EF DN 32", 4, "u")],
    ["an insulation surface DN 15 read DN 20", line({ material: "calorifuge", dn: "DN 15", unit: "m2", quantity: 3 }),
      item("Calorifuge EF DN 20", 3, "m²")],
    ["an insulation length DN 40 read DN 50", line({ network: "ECS", material: "calorifuge", dn: "DN 40", quantity: 12 }),
      item("Calorifuge ECS DN 50", 12)],
  ])("never takes the neighbouring DN of a key without series as its own: %s", (_case, truthLine, read) => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [truthLine])], { "a-plan-01": [read] }, [Z1]));
    expect(scope.keys).toMatchObject([{ status: "missed", cause: { label: "nous:mauvais_dn" } }]);
    expect(scope.false_positives).toMatchObject([{ items: 1, cause: { label: "nous:mauvais_dn" } }]);
  });

  it("still takes the outer diameter or the inch size of the same pipe for the DN of a key without series", () => {
    const counts = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ kind: "count", network: "EF", material: null, dn: "DN 20", organ: "vanne", unit: "u", quantity: 3 }),
    ])], { "a-plan-01": [item("Vanne EF DN 22", 1, "u"), item("Vanne ECS Ø22", 1, "u"), item("Vanne EF 3/4\"", 1, "u")] }, [Z1]));
    expect(counts.keys).toMatchObject([{ status: "ok", expected: 3, actual: 3, items: 3 }]);
    expect(counts.false_positives).toEqual([]);

    const insulation = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ material: "calorifuge", dn: "DN 22", quantity: 10 }), line({ material: "calorifuge", dn: "DN 76.1", quantity: 4 }),
    ])], { "a-plan-01": [item("Calorifuge EF DN 22", 10), item("Calorifuge EF DN 76", 4)] }, [Z1]));
    expect(insulation.keys.map((key) => [key.key.dn, key.status])).toEqual([["DN 22", "ok"], ["DN 76.1", "ok"]]);
    expect(insulation.false_positives).toEqual([]);
  });

  it("keeps out of score a key that adds an observable line and a line the plan cannot give", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ kind: "count", network: "EF", material: null, dn: "DN 20", organ: "vanne", unit: "u", quantity: 3 }),
      line({ kind: "count", network: "ECS", material: null, dn: "DN 20", organ: "vanne", unit: "u", quantity: 2,
        observable_on_plan: false, plan_cause: "install_only" }),
    ])], { "a-plan-01": [item("Vanne EF DN 20", 3, "u"), item("Vanne ECS DN 20", 2, "u")] }, [Z1]));
    expect(scope.keys).toMatchObject([{ status: "out_of_score", reason: "partly_observable", plan_causes: ["install_only"], cause: null }]);
    expect(scope.false_positives).toEqual([]);
    expect(scope.counts).toMatchObject({ keys_scored: 0, keys_out_of_score: 1, out_of_score_items: 2, causes: {} });
  });

  it("counts causes once per key or false-positive group, unreadable items as one group per reason", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], {
      "a-plan-01": [
        item("EF cuivre DN 22", 5),
        item("Tube cuivre DN 22", 1, "ml", 1), item("Tube cuivre DN 22", 2, "ml", 2), item("Tube cuivre DN 28", 3, "ml", 3),
        item("EP PVC DN 100", 2, "ml", 1), item("EP PVC DN 100", 3, "ml", 2),
        item("EV PVC DN 100", 2, "ml", 1), item("EV PVC DN 100", 3, "ml", 2),
      ],
    }, [Z1]));
    expect(scope.counts.causes).toEqual({ indetermine: 1, "indetermine:illisible": 1, "nous:invente": 2 });
    expect(scope.counts).toMatchObject({ false_positive_groups: 3, false_positive_items: 7, unreadable: 3 });
    expect(scope.false_positives.filter((group) => group.key === null)).toMatchObject([
      { reason: "network_missing", items: 3, cause: { label: "indetermine:illisible", origin: "indetermine" } },
    ]);
  });

  it("adds the items of documents with a zone or a level under a truth that has none", () => {
    const byLevel = only(score([truth("truth/a-r1.json", ["a-plan-01", "a-plan-02"], [line({ zone: null, quantity: 20 })])], {
      "a-plan-01": [item("EF cuivre DN 22", 8)], "a-plan-02": [item("EF cuivre DN 22", 12)],
    }));
    expect(byLevel.keys).toMatchObject([{ key: { zone: null, level: "R+1" }, status: "ok", expected: 20, actual: 20, items: 2 }]);
    expect([byLevel.false_positives, byLevel.warnings]).toEqual([[], []]);

    const whole = only(score([truth("truth/a-lot.json", ["a-plan-01", "a-plan-02"], [line({ zone: null, level: null, quantity: 20 })],
      { scope: "lot" })], { "a-plan-01": [item("EF cuivre DN 22", 8)], "a-plan-02": [item("EF cuivre DN 22", 12)] }));
    expect(whole.keys).toMatchObject([{ key: { zone: null, level: null }, status: "ok", actual: 20 }]);
    expect(whole.false_positives).toEqual([]);
  });

  it("counts the high-confidence errors on the items themselves, and candidates in one unit", () => {
    const sure = { confidence: 0.95 };
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line(),
      line({ network: "EV", material: "pvc", dn: "DN 100", quantity: 6, observable_on_plan: false, plan_cause: "vertical" }),
    ])], {
      "a-plan-01": [
        item("EF cuivre DN 22", 20, "ml", 1, sure), // out of tolerance
        item("EU PVC DN 100", 3, "ml", 1, sure), // invented
        item("EV PVC DN 100", 6, "ml", 1, sure), // its key is out of score
        item("Tube DN 22", 2, "ml", 1, sure), // unreadable
        item("Tube DN 28", 1, "ml", 2, { confidence: 0.5 }), // unreadable for the same reason
      ],
    }, [Z1]));
    // One matched key, one invented group, one group of unreadable items.
    expect(scope.indicative).toMatchObject({ high_confidence_items: 3, high_confidence_errors: 3, matched_keys: 1, candidates: 3 });
  });

  it("keeps out of score an item whose key the truth prices in another unit and leaves out of score", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ kind: "count", network: null, material: null, dn: null, organ: "wc", unit: "ens", quantity: 4,
        observable_on_plan: false, plan_cause: "install_only" }),
      line({ material: "calorifuge", dn: "DN 22", unit: "m2", quantity: 3, observable_on_plan: false, plan_cause: "not_drawn" }),
    ])], { "a-plan-01": [item("WC suspendu", 4, "u"), item("Calorifuge EF DN 22", 10)] }, [Z1]));
    expect(scope.false_positives).toEqual([]);
    expect(scope.out_of_score_items.map((entry) => entry.reason)).toEqual(["key_out_of_score", "key_out_of_score"]);
    expect(scope.counts).toMatchObject({ items: 2, attached: 2, false_positive_items: 0, causes: {} });
  });

  it("calls a scored key read in another unit a unit gap, counted once with its missed key", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line({ material: "calorifuge", dn: "DN 22", quantity: 10 })])],
      { "a-plan-01": [item("Calorifuge EF DN 22", 3, "m²")] }, [Z1]));
    expect(causeLabels(scope)).toEqual({ keys: ["EF DN 22: indetermine:unite"], falsePositives: ["EF DN 22: indetermine:unite"] });
    expect(scope.counts.causes).toEqual({ "indetermine:unite": 1 });
  });

  it("counts a wrong network or DN once, on the missed key, its false-positive group paired with that key", () => {
    const network = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], { "a-plan-01": [item("ECS cuivre DN 22", 10)] }, [Z1]));
    expect(network.counts.causes).toEqual({ "nous:mauvais_reseau": 1 });
    expect(network.false_positives).toMatchObject([
      { cause: { label: "nous:mauvais_reseau" }, paired_with: { network: "EF", material: "cuivre", dn: "DN 22" } },
    ]);
    const dn = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], { "a-plan-01": [item("EF cuivre", 10)] }, [Z1]));
    expect(dn.counts.causes).toEqual({ "nous:mauvais_dn": 1 });
    const invented = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()])], {
      "a-plan-01": [item("EF cuivre DN 22", 10), item("EP PVC DN 100", 2)],
    }, [Z1]));
    expect(invented.false_positives).toMatchObject([{ cause: { label: "nous:invente" }, paired_with: null }]);
  });

  it("carries the reviewed plan cause of a missed key over to the item it pairs with, counted once", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line({ plan_cause: "no_separation" })])],
      { "a-plan-01": [item("ECS cuivre DN 22", 10)] }, [Z1]));
    expect(causeLabels(scope)).toEqual({ keys: ["EF DN 22: plan:no_separation"], falsePositives: ["ECS DN 22: plan:no_separation"] });
    expect(scope.counts.causes).toEqual({ "plan:no_separation": 1 });
  });

  it("never calls a main-scope item a double count because of a key of the reserve", () => {
    const reserve = manifestDocument("a-plan-02", { zone: "Z2", role: "reserve" });
    const scopes = score([
      truth("truth/a-plan-01.json", ["a-plan-01"], [line()]),
      truth("truth/a-plan-02.json", ["a-plan-02"], [line({ zone: "Z2", network: "EU", material: "pvc", dn: "DN 100", quantity: 4 })]),
    ], { "a-plan-01": [item("EF cuivre DN 22", 10), item("EU PVC DN 100", 4)], "a-plan-02": [item("EU PVC DN 100", 4)] }, [Z1, reserve]);
    const main = scopes.find((scope) => scope.role === "truth") as ScopeScore;
    expect(causeLabels(main).falsePositives).toEqual(["EU DN 100: nous:invente"]);
  });

  const roomsPlan = manifestDocument("d-plan-01", { zone: null, level: "RDC", scale: "1/100" });
  function rooms(entries: Array<[string, number]>) {
    return truth("truth/d-plan-01.json", ["d-plan-01"], entries.map(([room, quantity]) => line({
      kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, room, unit: "m2", quantity,
      source: { document: "d-plan-01", sheet: null, row: null, page: 1, text: "Fictional" },
    })), { lot: "d", source_document: "d-plan-01" });
  }

  it("calls a missed key « indéterminé » when an unreadable item reads like it, pairing the item with that key", () => {
    const scope = only(score([rooms([["Sellerie", 12], ["Salle des cartes", 20], ["Local vélos", 6]])], {
      "d-plan-01": [
        item("Sellerie", 12, "m²"),
        item("Pièce A — aire relevée", 20, "m²", 1, { evidence: "« Salle de bal 20 m² »" }),
        item("Pièce B — aire relevée", 50, "m²", 1, { evidence: "« Préau 50 m² »" }),
      ],
    }, [roomsPlan]));
    expect(causeLabels(scope).keys).toEqual(["Local vélos null: nous:manque", "Salle des cartes null: indetermine:illisible"]);
    expect(scope.false_positives).toMatchObject([
      { key: null, reason: "room_missing", items: 1, quantity: 20, paired_with: { room: "Salle des cartes" } },
      { key: null, reason: "room_missing", items: 1, quantity: 50, paired_with: null },
    ]);
    // The paired item counts on its key; the other unreadable item is one group.
    expect(scope.counts.causes).toEqual({ "indetermine:illisible": 2, "nous:manque": 1 });
    expect(scope.counts).toMatchObject({ keys_missed: 2, not_reviewed: 2, unreadable: 2, false_positive_items: 2 });
  });

  it("lets one unreadable item stand for one missed key only, of its kind, unit and attributes", () => {
    const twins = only(score([rooms([["Labo photo", 5], ["Volière", 5]])], {
      "d-plan-01": [item("Pièce — aire relevée", 5, "m²")],
    }, [roomsPlan]));
    expect(causeLabels(twins).keys).toEqual(["Labo photo null: indetermine:illisible", "Volière null: nous:manque"]);

    const pipes = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ dn: "DN 22", quantity: 10 }),
      line({ dn: "DN 28", quantity: 6 }),
      line({ kind: "count", network: null, material: null, dn: null, organ: "wc", unit: "u", quantity: 4 }),
    ])], {
      "a-plan-01": [item("Tube cuivre DN 22", 10), item("Tube cuivre DN 22", 6), item("Casiers", 60, "u"), item("Tube DN 22", 4)],
    }, [Z1]));
    expect(causeLabels(pipes).keys).toEqual(["EF DN 22: indetermine:illisible", "EF DN 28: nous:manque", "wc null: nous:manque"]);
  });

  it("pairs one false-positive group with one missed key only", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line(), line({ network: "ECS" })])], {
      "a-plan-01": [item("Bouclage ECS cuivre DN 22", 10)],
    }, [Z1]));
    expect(causeLabels(scope).keys).toEqual(["ECS DN 22: nous:mauvais_reseau", "EF DN 22: nous:manque"]);
    expect(scope.counts.causes).toEqual({ "nous:mauvais_reseau": 1, "nous:manque": 1 });
  });

  it("pairs an insulation surface read without its network with its missed key, as in ml", () => {
    for (const unit of ["ml", "m²"]) {
      const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
        line({ material: "calorifuge", dn: "DN 22", unit: unit === "ml" ? "ml" : "m2", quantity: 12.6 }),
      ])], { "a-plan-01": [item("Calorifuge sur tube cuivre DN 22", 12.6, unit)] }, [Z1]));
      expect(causeLabels(scope).keys).toEqual(["EF DN 22: indetermine:illisible"]);
      expect(scope.false_positives).toMatchObject([{ reason: "network_missing", paired_with: { network: "EF" } }]);
      expect(scope.counts.causes).toEqual({ "indetermine:illisible": 1 });
    }
  });

  it("keeps a room surface whose evidence names a nearby network the surface of that room", () => {
    for (const evidence of ["Texte « Labo photo 14.30 m² », voisin de la gaine EP", "Texte « Labo photo 14.30 m² » près du poste incendie"]) {
      const scope = only(score([rooms([["Labo photo", 14.3]])], {
        "d-plan-01": [item("Labo photo — aire relevée", 14.3, "m²", 1, { evidence })],
      }, [roomsPlan]));
      expect(scope.keys).toMatchObject([{ key: { room: "Labo photo" }, status: "ok", cause: null }]);
      expect(scope.false_positives).toEqual([]);
    }
  });

  it("pairs a room surface whose room is not read with its missed room, whatever its evidence names nearby", () => {
    for (const evidence of ["Texte « 7.70m² » près de la gaine calo", "Texte « 7.70m² » près du poste incendie"]) {
      const scope = only(score([rooms([["Volière", 7.7], ["Préau", 20]])], {
        "d-plan-01": [item("Pièce — aire relevée", 7.7, "m²", 1, { evidence })],
      }, [roomsPlan]));
      expect(causeLabels(scope).keys).toEqual(["Préau null: nous:manque", "Volière null: indetermine:illisible"]);
      expect(scope.false_positives).toMatchObject([{ key: null, reason: "room_missing", items: 1, paired_with: { room: "Volière" } }]);
      expect(scope.counts.causes).toEqual({ "indetermine:illisible": 1, "nous:manque": 1 });
    }
  });

  it("does not score a scope whose document did not run", () => {
    const scopes = score([truth("truth/a-plan-01.json", ["a-plan-01"], [line()]), truth("truth/a-plan-02.json", ["a-plan-02"], [line({ zone: "Z2" })])],
      { "a-plan-01": [item("EF cuivre DN 22", 10)] });
    expect(scopes.map((scope) => [scope.documents.join(","), scope.status])).toEqual([["a-plan-01", "scored"], ["a-plan-02", "not_run"]]);
  });
});

describe("takeoff bench confounded networks (score v3)", () => {
  function keyOf(scope: ScopeScore, network: string) {
    return scope.keys.find((key) => key.key.network === network);
  }

  it("adds an EU item and an EV item on the EUV key of a devis that prices them together", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "EUV", material: "pvc", dn: "DN 100", quantity: 10 }),
    ])], { "a-plan-01": [item("EU PVC DN 100", 6, "ml", 1), item("EV PVC DN 100", 4, "ml", 2)] }, [Z1]));
    expect(scope.keys).toMatchObject([{ key: { network: "EUV", dn: "DN 100" }, status: "ok", expected: 10, actual: 10, items: 2, cause: null }]);
    expect(scope.false_positives).toEqual([]);
    expect(scope.counts).toMatchObject({ attached: 2, keys_ok: 1, keys_missed: 0, false_positive_items: 0, causes: {} });
  });

  it("keeps an EU item on the EU key of a scope that also prices EUV, and rolls up only the EV item", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "EU", material: "pvc", dn: "DN 100", quantity: 6 }),
      line({ network: "EUV", material: "pvc", dn: "DN 100", quantity: 4 }),
    ])], { "a-plan-01": [item("EU PVC DN 100", 6), item("EV PVC DN 100", 4)] }, [Z1]));
    expect(keyOf(scope, "EU")).toMatchObject({ status: "ok", expected: 6, actual: 6, items: 1 });
    expect(keyOf(scope, "EUV")).toMatchObject({ status: "ok", expected: 4, actual: 4, items: 1 });
    expect(scope.false_positives).toEqual([]);
  });

  it("adds the CHW-S and CHW-R items on the CHW key of a devis that prices supply and return together", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "CHW", material: "acier-noir", dn: "DN 50", quantity: 20 }),
    ])], { "a-plan-01": [item("CHW-S acier noir DN 50", 12, "ml", 1), item("CHW-R acier noir DN 50", 8.5, "ml", 2)] }, [Z1]));
    expect(scope.keys).toMatchObject([{ key: { network: "CHW", material: "acier-noir", dn: "DN 50" }, status: "ok", expected: 20, actual: 20.5, items: 2 }]);
    expect(scope.false_positives).toEqual([]);
  });

  it("never takes a RECS item for the ECS key", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [line({ network: "ECS", quantity: 10 })])],
      { "a-plan-01": [item("RECS cuivre DN 22", 10)] }, [Z1]));
    expect(scope.keys).toMatchObject([{ key: { network: "ECS" }, status: "missed", actual: null, items: 0 }]);
    expect(scope.false_positives).toMatchObject([{ key: { network: "RECS", dn: "DN 22" }, items: 1, quantity: 10 }]);
    expect(scope.counts).toMatchObject({ keys_ok: 0, keys_missed: 1, false_positive_items: 1 });
  });

  it("lets an unreadable item hesitating between CHW-S and CHW-R be the missed CHW key", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "CHW", material: "acier-noir", dn: "DN 50", quantity: 20 }),
    ])], { "a-plan-01": [item("CHW-S / CHW-R acier noir DN 50", 20)] }, [Z1]));
    expect(causeLabels(scope).keys).toEqual(["CHW DN 50: indetermine:illisible"]);
    expect(scope.false_positives).toMatchObject([
      { key: null, reason: "network_ambiguous", items: 1, quantity: 20, paired_with: { network: "CHW", dn: "DN 50" } },
    ]);
    expect(scope.counts).toMatchObject({ keys_missed: 1, unreadable: 1, not_reviewed: 1, causes: { "indetermine:illisible": 1 } });
  });

  it("leaves an unreadable item hesitating between CHW-S and HW-S unpaired with an EF key", () => {
    const scope = only(score([truth("truth/a-plan-01.json", ["a-plan-01"], [
      line({ network: "EF", material: "acier-noir", dn: "DN 50", quantity: 20 }),
      line({ network: "CHW", material: "acier-noir", dn: "DN 50", quantity: 20 }),
    ])], { "a-plan-01": [item("CHW-S / HW-S acier noir DN 50", 20)] }, [Z1]));
    // It may be the CHW key (CHW-S is CHW here), never the EF key it names nowhere.
    expect(causeLabels(scope).keys).toEqual(["CHW DN 50: indetermine:illisible", "EF DN 50: nous:manque"]);
  });
});
