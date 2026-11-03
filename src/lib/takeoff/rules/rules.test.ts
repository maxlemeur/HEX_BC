import { describe, expect, it } from "vitest";

import { blockingRules, isRuleBlocked } from "@/lib/takeoff/rules/blocking";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { nonObservableCause, ruleInputsFromDesignation, ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import { NETWORK_MATERIALS, checkNetworkDiameter } from "@/lib/takeoff/rules/network-diameters";
import { REGISTRATION, registerPages, type PageAnchors } from "@/lib/takeoff/rules/registration";
import { sharedArea } from "@/lib/takeoff/rules/rooms";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { ZONE_OVERLAP, commonLength, settlePairs } from "@/lib/takeoff/rules/zone-overlap";
import { NETWORK_CODES } from "@/lib/takeoff/bench/keys";

// Ways the fixed quantity rules of TI-664 could let a wrong quantity through,
// or block a right one, written before the code. Every plan, label and quantity
// is fictional. A browser journey cannot set up most of these cases (rotated
// sheets, title blocks larger than the drawing, three partners of one run), so
// they are checked here; the army journey covers the guard, the decision and
// the estimate end to end.
// DN × network:
// - a network of the vocabulary has no row, or a missing material or DN passes;
// - a material a network does not take passes (PVC on cold water, galvanised
//   steel on glycol), or a DN its material's series lacks (copper DN 23);
// - one size printed two ways reads differently (« DN 22 » and « 22x1,2 » on
//   press stainless; « DN 20 » copper is the 22 mm tube; « DN 76 » is 76.1);
// - a generic « inox » misses the welded or the press series;
// - an insulation (calorifuge) is failed for its material, a count is read.
// Inputs read in a designation:
// - a weld, tap, support, vertical, transport or service line is proposed as an
//   observable quantity; a valve « avec support » or « de colonne montante » is
//   taken as non-observable; « Collecteur » reads as « colliers »;
// - an unknown DN is dropped instead of failed.
// Registration (Z1/Z2):
// - the title block, printed at the same sheet place on both zone plans, decides
//   the frame although the building moved, even when it holds more texts;
// - two plans of the same drawing at the same place are not registered;
// - too few building lines, two equally supported translations, or a residual
//   above the limit still register (a guessed frame);
// - a sheet drawn rotated registers.
// Duplicates:
// - the common length of a run drawn on both plans is missed or counted twice
//   (two runs of the other plan over one stretch); a different DN or network, a
//   parallel pipe beyond the distance, a common length under the minimum or a
//   crossing is taken as a duplicate;
// - lines of one page are compared; pages of two levels are compared;
// - a reduction by the common length does not settle the pair, or settles two
//   pairs at once; an applied (frozen) unreduced line is asked to change;
// - an excluded line still counts as a partner;
// - plans of a level that do not register leave their lines unflagged.
// Scale, area, overlap, boxes, quantities to enter:
// - a length on a page whose cote contradicts the scale passes; a count fails;
// - a polygon area far from the printed surface passes; a corrected quantity
//   still fails; two rooms sharing only a wall overlap;
// - a « Placard », a « Gaine technique » or a four-sided box at a third of the
//   printed surface counts as a room;
// - a quantity to enter is settled by verifying it; a typed quantity still fails.
// Blocking:
// - a failed acceptable rule blocks a verified line; a non-acceptable one does
//   not block it; stale results do not block.

const TEXTS: Array<[string, number]> = [
  ["Bureau 101", 0], ["Salle de réunion", 1], ["EF - Inox 316L DN 22", 2], ["Local technique", 3], ["Circulation C2", 4],
  ["Sanitaires H", 5], ["Sanitaires F", 6], ["Archives", 7],
];

/** A fictional floor drawing: a grid of building lines and room texts, seen through a sheet shifted by (sx, sy). */
function sheet(sx: number, sy: number, options: { titleBlock?: number; lines?: number; jitter?: number } = {}): PageAnchors {
  const lines: Array<[number, number, number, number]> = [];
  const count = options.lines ?? 30;
  for (let index = 0; index < count; index += 1) {
    const y = 2 + index * 0.7;
    const length = 3 + (index % 5);
    const jitter = (options.jitter ?? 0) * (index % 2 === 0 ? 1 : -1);
    lines.push([10 + sx + jitter, y + sy, 10 + length + sx + jitter, y + sy]);
  }
  const texts: Array<[string, number, number]> = TEXTS.map(([text, index]) => [text, 12 + index * 1.3 + sx, 4 + index * 0.9 + sy]);
  // Title block texts: same place on every sheet, never shifted with the drawing.
  for (let index = 0; index < (options.titleBlock ?? 0); index += 1) texts.push([`Cartouche ${index}`, 60, 30 + index * 0.4]);
  return { version: 1, texts, lines };
}

function inputs(overrides: Partial<TakeoffRuleInputs> = {}): TakeoffRuleInputs {
  return {
    version: 1, source: "vector", kind: "network", network: "EF", material: "inox-316l", dn: "DN 22", non_observable: null,
    model_quantity: 5, ...overrides,
  };
}

function page(key: string, overrides: Partial<RulePage> = {}): RulePage {
  return { key, job_id: key.split("#")[0], order: 0, level: "R+1", zone: "Z1", scale: { status: "format", reason: null }, anchors: null, ...overrides };
}

function line(id: string, overrides: Partial<RuleLine> = {}): RuleLine {
  return {
    id, job_id: "job-z1", page_key: "job-z1#1", designation: "EF Inox 316L DN 22", unit: "ml", quantity: 5, is_excluded: false, frozen: false,
    inputs: inputs(), geometry: null, ...overrides,
  };
}

function rule(results: Map<string, TakeoffRuleResult[]>, id: string, ruleId: TakeoffRuleResult["rule"]) {
  return results.get(id)?.find((entry) => entry.rule === ruleId);
}

describe("DN × network reference", () => {
  it("has a row for every network of the vocabulary", () => {
    for (const code of NETWORK_CODES) expect(NETWORK_MATERIALS[code].length, code).toBeGreaterThan(0);
  });

  it("fails a missing material or DN, a material the network does not take and a DN outside the series", () => {
    expect(checkNetworkDiameter("EF", null, "DN 22").status).toBe("material_missing");
    expect(checkNetworkDiameter("EF", "cuivre", null).status).toBe("dn_missing");
    expect(checkNetworkDiameter("EF", "pvc", "DN 32").status).toBe("material_not_allowed");
    expect(checkNetworkDiameter("ECS", "pvc-pression", "DN 32").status).toBe("material_not_allowed");
    expect(checkNetworkDiameter("GLY", "acier-galvanise", "DN 50").status).toBe("material_not_allowed");
    expect(checkNetworkDiameter("EF", "cuivre", "DN 23").status).toBe("dn_not_in_series");
    expect(checkNetworkDiameter("EU", "pvc", "DN 105").status).toBe("dn_not_in_series");
  });

  it("reads one size printed two ways as one, and a generic inox in both stainless series", () => {
    expect(checkNetworkDiameter("EF", "inox-316l", "DN 22").status).toBe("compatible");
    expect(checkNetworkDiameter("EF", "inox-316l", "22x1,2").status).toBe("compatible");
    expect(checkNetworkDiameter("EF", "cuivre", "DN 20").status).toBe("compatible");
    expect(checkNetworkDiameter("CHW", "inox", "DN 76").status).toBe("compatible");
    expect(checkNetworkDiameter("CHW", "inox", "DN 65").status).toBe("compatible");
    expect(checkNetworkDiameter("CS", "acier-galvanise", "DN 65").status).toBe("compatible");
    expect(checkNetworkDiameter("EUV", "pvc", "DN 100").status).toBe("compatible");
    expect(checkNetworkDiameter("EUG", "fonte", "DN 125").status).toBe("compatible");
  });

  it("gives the DN rule's codes on lines, never on an insulation or a count", () => {
    const { results } = evaluateTakeoffRules({ pages: [], lines: [
      line("ok"),
      line("pvc", { inputs: inputs({ material: "pvc", dn: "DN 32" }) }),
      line("calo", { inputs: inputs({ kind: "insulation", material: "calorifuge" }) }),
      line("count", { unit: "u", inputs: inputs({ kind: "count", network: null }) }),
      line("unlabelled", { inputs: inputs({ material: null, dn: null }) }),
    ] });
    expect(rule(results, "ok", "dn_network")).toMatchObject({ status: "pass", code: "DN_NETWORK_COMPATIBLE" });
    expect(rule(results, "pvc", "dn_network")).toMatchObject({ status: "fail", code: "DN_NETWORK_MATERIAL_NOT_ALLOWED", acceptable: true });
    expect(rule(results, "calo", "dn_network")).toBeUndefined();
    expect(rule(results, "count", "dn_network")).toBeUndefined();
    expect(rule(results, "unlabelled", "dn_network")).toMatchObject({ status: "fail", code: "DN_NETWORK_MATERIAL_MISSING" });
  });
});

describe("inputs read in a designation", () => {
  it("names the quantities a plan view never shows, and keeps the organs it draws", () => {
    expect(nonObservableCause("Soudures bout à bout inox")).toBe("weld");
    expect(nonObservableCause("Piquages sur collecteur")).toBe("tap");
    expect(nonObservableCause("Supports et colliers")).toBe("support");
    expect(nonObservableCause("Chute EU PVC DN 100")).toBe("vertical");
    expect(nonObservableCause("Mise en service et essais")).toBe("service");
    expect(nonObservableCause("Collecteur EF 4 départs")).toBeNull();
    expect(ruleInputsFromDesignation({ designation: "Soudures inox", unit: "u", quantity: 48 }).non_observable).toBe("weld");
    expect(ruleInputsFromDesignation({ designation: "Vanne d'isolement DN 20 avec support", unit: "u", quantity: 4 }).non_observable).toBeNull();
    expect(ruleInputsFromDesignation({ designation: "Vanne de colonne montante DN 50", unit: "u", quantity: 2 }).non_observable).toBeNull();
    expect(ruleInputsFromDesignation({ designation: "Chute EU PVC DN 100", unit: "ml", quantity: 12 }).non_observable).toBe("vertical");
  });

  it("keeps an incomplete triplet incomplete: no network, two networks or two DN fail, never skip, the DN rule", () => {
    const failed = (designation: string) => rule(evaluateTakeoffRules({ pages: [], lines: [line("x", { designation,
      inputs: ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 }) })] }).results, "x", "dn_network")?.code;
    expect(failed("Tube cuivre DN 22")).toBe("DN_NETWORK_NETWORK_MISSING");
    expect(failed("Réseau EF et ECS cuivre DN 22")).toBe("DN_NETWORK_NETWORK_MISSING");
    expect(failed("EF cuivre DN 22 / DN 54")).toBe("DN_NETWORK_DN_MISSING");
    expect(failed("Calorifuge EF DN 22")).toBeUndefined();
  });

  it("keeps an unknown DN as printed, so that the DN rule fails it", () => {
    const read = ruleInputsFromDesignation({ designation: "EF cuivre DN 23", unit: "ml", quantity: 10 });
    expect(read).toMatchObject({ kind: "network", network: "EF", material: "cuivre", dn: "DN 23" });
    expect(checkNetworkDiameter("EF", "cuivre", read.dn).status).toBe("dn_not_in_series");
    expect(ruleInputsFromDesignation({ designation: "EF Inox 316L DN 22", unit: "ml", quantity: 10 }))
      .toMatchObject({ network: "EF", material: "inox-316l", dn: "DN 22" });
  });

  it("fails a quantity to enter until the user types one, and verifying never settles it", () => {
    const soudures = (quantity: number) => line("weld", { designation: "Soudures inox", unit: "u", quantity,
      inputs: ruleInputsFromDesignation({ designation: "Soudures inox", unit: "u", quantity: 48 }) });
    const proposed = rule(evaluateTakeoffRules({ pages: [], lines: [soudures(48)] }).results, "weld", "non_observable");
    expect(proposed).toMatchObject({ status: "fail", code: "NON_OBSERVABLE_TO_ENTER", acceptable: false });
    expect(isRuleBlocked([proposed as TakeoffRuleResult], false, true)).toBe(true);
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [soudures(52)] }).results, "weld", "non_observable"))
      .toMatchObject({ status: "pass", code: "NON_OBSERVABLE_ENTERED" });
  });
});

describe("registration of two plans of one level", () => {
  it("follows the building, never the title block printed at the same sheet place, even when it holds more texts", () => {
    const outcome = registerPages(sheet(0, 0, { titleBlock: 20 }), sheet(-42.4, -6.6, { titleBlock: 20 }));
    expect(outcome.status).toBe("registered");
    if (outcome.status !== "registered") return;
    expect(outcome.dx).toBeCloseTo(42.4, 3);
    expect(outcome.dy).toBeCloseTo(6.6, 3);
    expect(outcome.residual_m).toBeLessThanOrEqual(REGISTRATION.maxResidual_m);
  });

  it("registers two readings of one drawing at one place with no shift", () => {
    expect(registerPages(sheet(0, 0), sheet(0, 0))).toMatchObject({ status: "registered", dx: 0, dy: 0 });
  });

  it("never guesses: too few building lines, a residual over the limit or a rotated sheet stay unregistered", () => {
    expect(registerPages(sheet(0, 0, { lines: 5 }), sheet(-3, 0, { lines: 5 }))).toMatchObject({ status: "unregistered", reason: "too_few_lines" });
    expect(registerPages(sheet(0, 0), sheet(-3, 0, { jitter: 0.04 }))).toMatchObject({ status: "unregistered", reason: "residual" });
    const rotated = sheet(0, 0);
    const turned: PageAnchors = { version: 1, texts: rotated.texts.map(([text, x, y]) => [text, -y, x]),
      lines: rotated.lines.map(([x0, y0, x1, y1]) => [-y0, x0, -y1, x1]) };
    expect(registerPages(rotated, turned).status).toBe("unregistered");
  });

  it("refuses two translations the building lines support alike", () => {
    // A drawing made of one repeated bay: shifting it by one bay lands as many lines as the true shift.
    const bay = (sx: number): PageAnchors => {
      const lines: Array<[number, number, number, number]> = [];
      for (let repeat = 0; repeat < 6; repeat += 1) for (let index = 0; index < 8; index += 1) {
        lines.push([sx + repeat * 10, index, sx + repeat * 10 + 4, index]);
      }
      return { version: 1, lines, texts: [["Bay A", sx + 1, 1], ["Bay B", sx + 2, 2], ["Bay A'", sx + 11, 1], ["Bay B'", sx + 12, 2]] };
    };
    const other = bay(-10);
    other.texts = [["Bay A", 1 - 10, 1], ["Bay B", 2 - 10, 2], ["Bay A'", 11 - 20, 1], ["Bay B'", 12 - 20, 2]];
    expect(registerPages(bay(0), other)).toMatchObject({ status: "unregistered" });
  });
});

describe("duplicate runs between zones", () => {
  const identity: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

  it("measures the common length once, whatever the other plan's pieces", () => {
    const left = { id: "a", segments: [[0, 0, 5, 0]] as Array<[number, number, number, number]> };
    const right = { id: "b", segments: [[3, 0.01, 4, 0.01], [3.5, 0, 6, 0]] as Array<[number, number, number, number]> };
    expect(commonLength(left, identity, right, identity)).toBeCloseTo(2, 3);
  });

  it("does not take a parallel pipe beyond the distance, a crossing or a touch as a duplicate", () => {
    const run = { id: "a", segments: [[0, 0, 5, 0]] as Array<[number, number, number, number]> };
    expect(commonLength(run, identity, { id: "b", segments: [[0, ZONE_OVERLAP.distance_m + 0.01, 5, ZONE_OVERLAP.distance_m + 0.01]] }, identity)).toBe(0);
    expect(commonLength(run, identity, { id: "b", segments: [[2, -2, 2, 2]] }, identity)).toBe(0);
    expect(commonLength(run, identity, { id: "b", segments: [[4.9, 0, 8, 0]] }, identity)).toBeLessThan(ZONE_OVERLAP.minLength_m);
  });

  it("settles a pair with one reduction, once, and never asks a frozen line to change", () => {
    const lines = new Map([
      ["a", { id: "a", measured_m: 5, quantity: 4, frozen: false }],
      ["b", { id: "b", measured_m: 3, quantity: 3, frozen: false }],
      ["c", { id: "c", measured_m: 3, quantity: 3, frozen: false }],
    ]);
    const ab = { left: "a", right: "b", overlap_m: 1 };
    const ac = { left: "a", right: "c", overlap_m: 1 };
    expect([...settlePairs([ab, ac], lines)]).toHaveLength(1);
    const frozen = new Map([["a", { id: "a", measured_m: 5, quantity: 5, frozen: true }], ["b", { id: "b", measured_m: 3, quantity: 2, frozen: false }]]);
    expect(settlePairs([ab], frozen).has(ab)).toBe(true);
  });

  /** Two zone plans of one level, Z2's sheet showing the building 40 m further: Z1's run 0–5 m and Z2's 4–7 m share 1 m. */
  function zones(overrides: { z1?: Partial<RuleLine>; z2?: Partial<RuleLine>; z2Anchors?: PageAnchors | null; z2Level?: string } = {}) {
    const pages = [
      page("job-z1#1", { order: 0, zone: "Z1", anchors: sheet(0, 0, { titleBlock: 10 }) }),
      page("job-z2#1", { order: 10_000, zone: "Z2", level: overrides.z2Level ?? "R+1",
        anchors: overrides.z2Anchors === undefined ? sheet(-40, 0, { titleBlock: 10 }) : overrides.z2Anchors }),
    ];
    const lines = [
      line("z1", { geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null }, ...overrides.z1 }),
      line("z2", { job_id: "job-z2", page_key: "job-z2#1", designation: "EF Inox 316L DN 22", quantity: 3,
        geometry: { segments_m: [[-36, 1, -33, 1]], polygon_m: null, length_m: 3, area_m2: null }, inputs: inputs({ model_quantity: 3 }), ...overrides.z2 }),
    ];
    return evaluateTakeoffRules({ pages, lines });
  }

  it("fails both lines with the common length and the other line, until one is reduced by it", () => {
    const first = zones();
    expect(rule(first.results, "z1", "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE", acceptable: true,
      details: { overlap_m: 1, partners: [{ item_id: "z2", zone: "Z2", overlap_m: 1, resolved: false }] } });
    expect(rule(first.results, "z2", "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
    expect(first.transforms.get("job-z2#1")?.[4]).toBeCloseTo(40, 3);
    const corrected = zones({ z1: { quantity: 4 } });
    expect(rule(corrected.results, "z1", "zone_overlap")).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(corrected.results, "z2", "zone_overlap")).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(zones({ z1: { quantity: 4.5 } }).results, "z2", "zone_overlap")).toMatchObject({ status: "fail" });
  });

  it("ignores an excluded partner, another DN or network, lines of one page and pages of two levels", () => {
    expect(rule(zones({ z2: { is_excluded: true } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2: { inputs: inputs({ dn: "DN 28" }) } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2: { inputs: inputs({ network: "ECS" }) } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2: { page_key: "job-z1#1", geometry: { segments_m: [[4, 1, 7, 1]], polygon_m: null, length_m: 3, area_m2: null } } })
      .results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2Level: "R+2" }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });

  it("fails « zones non recalées » on the lines that could be one run when their plans do not register", () => {
    const unregistered = zones({ z2Anchors: null });
    expect(rule(unregistered.results, "z1", "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_UNREGISTERED" });
    expect(rule(unregistered.results, "z2", "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_UNREGISTERED" });
    expect(unregistered.transforms.get("job-z2#1")).toBeNull();
    expect(rule(zones({ z2Anchors: null, z2: { inputs: inputs({ network: "EU", material: "pvc", dn: "DN 100" }) } }).results, "z1", "zone_overlap"))
      .toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });
});

describe("scale, rooms and boxes", () => {
  it("fails a length or surface on a page whose cote contradicts the scale, never a count", () => {
    const pages = [page("job-z1#1", { scale: { status: "unverified", reason: "dimension_mismatch" } })];
    const { results } = evaluateTakeoffRules({ pages, lines: [
      line("ml", { inputs: ruleInputsFromDesignation({ designation: "EF cuivre DN 22", unit: "ml", quantity: 5 }) }),
      line("u", { unit: "u", inputs: ruleInputsFromDesignation({ designation: "Vanne DN 22", unit: "u", quantity: 2 }) }),
    ] });
    expect(rule(results, "ml", "scale_dimension")).toMatchObject({ status: "fail", code: "SCALE_DIMENSION_MISMATCH" });
    expect(rule(results, "u", "scale_dimension")).toBeUndefined();
  });

  function room(id: string, polygon: number[], area: number, printed: number, label = "Bureau", quantity = area): RuleLine {
    return line(id, { designation: `Surface « ${label} »`, unit: "m2", quantity,
      inputs: ruleInputsFromVector({ kind: "surface", network: null, material: null, dn: null, quantity: area, room: label, printed_m2: printed }),
      geometry: { segments_m: [], polygon_m: polygon, length_m: null, area_m2: area } });
  }
  const square = (x: number, y: number, size: number) => [x, y, x + size, y, x + size, y + size, x, y + size];

  it("compares the area with the printed surface, the quantity as corrected", () => {
    const { results } = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [
      room("near", square(0, 0, 4), 16, 16.2), room("far", square(10, 0, 4), 16, 18.5), room("fixed", square(20, 0, 4), 16, 18.5, "Bureau", 18.5),
    ] });
    expect(rule(results, "near", "area_printed")).toMatchObject({ status: "pass", code: "AREA_PRINTED_CONSISTENT" });
    expect(rule(results, "far", "area_printed")).toMatchObject({ status: "fail", code: "AREA_PRINTED_MISMATCH" });
    expect(rule(results, "fixed", "area_printed")).toMatchObject({ status: "pass" });
  });

  it("fails overlapping rooms, never two rooms sharing a wall", () => {
    expect(sharedArea([[0, 0], [4, 0], [4, 4], [0, 4]], [[4, 0], [8, 0], [8, 4], [4, 4]])).toBe(0);
    const { results } = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [
      room("a", square(0, 0, 4), 16, 16), room("b", square(3, 0, 4), 16, 16), room("c", square(6, 0, 4), 16, 16),
    ] });
    expect(rule(results, "a", "room_overlap")).toMatchObject({ status: "fail", code: "ROOM_OVERLAP", details: { overlapping_item_ids: ["b"] } });
    expect(rule(results, "c", "room_overlap")).toMatchObject({ status: "fail", details: { overlapping_item_ids: ["b"] } });
    const apart = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [room("a", square(0, 0, 4), 16, 16), room("c", square(4, 0, 4), 16, 16)] });
    expect(rule(apart.results, "a", "room_overlap")).toMatchObject({ status: "pass" });
  });

  it("fails a bathtub, cupboard or shaft label and a four-sided box far smaller than its printed surface", () => {
    const { results } = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [
      room("cupboard", square(0, 0, 1), 1, 1, "Placard"), room("shaft", square(5, 0, 1), 1, 1, "Gaine technique"),
      room("box", square(10, 0, 2), 4, 13.6, "Infirmerie"), room("room", square(20, 0, 3.7), 13.69, 13.6, "Infirmerie"),
    ] });
    expect(rule(results, "cupboard", "closed_box")).toMatchObject({ status: "fail", code: "CLOSED_BOX_LABEL" });
    expect(rule(results, "shaft", "closed_box")).toMatchObject({ status: "fail", code: "CLOSED_BOX_LABEL" });
    expect(rule(results, "box", "closed_box")).toMatchObject({ status: "fail", code: "CLOSED_BOX_SHAPE" });
    expect(rule(results, "room", "closed_box")).toMatchObject({ status: "pass" });
  });
});

describe("blocking", () => {
  const fail = (acceptable: boolean): TakeoffRuleResult => ({
    rule: "dn_network", status: "fail", code: "DN_NETWORK_DN_MISSING", version: 1, acceptable, reason: "Fictional",
  });

  it("lets a verified line through an acceptable failure only, and blocks stale results", () => {
    expect(isRuleBlocked([fail(true)], false, false)).toBe(true);
    expect(isRuleBlocked([fail(true)], false, true)).toBe(false);
    expect(isRuleBlocked([fail(false)], false, true)).toBe(true);
    expect(isRuleBlocked([], true, true)).toBe(true);
    expect(isRuleBlocked(null, false, false)).toBe(false);
    expect(blockingRules([fail(true), fail(false)], true)).toHaveLength(1);
  });
});
