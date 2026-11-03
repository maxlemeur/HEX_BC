import { describe, expect, it } from "vitest";

import { blockingRules, isRuleBlocked } from "@/lib/takeoff/rules/blocking";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { nonObservableCause, ruleInputsFromDesignation, ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import { NETWORK_MATERIALS, checkNetworkDiameter } from "@/lib/takeoff/rules/network-diameters";
import { REGISTRATION, registerPages, type PageAnchors } from "@/lib/takeoff/rules/registration";
import { polygonPoints, roomsOverlap, sharedArea } from "@/lib/takeoff/rules/rooms";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { ZONE_OVERLAP, commonLength, minCommonLength, settleDuplicates } from "@/lib/takeoff/rules/zone-overlap";
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
// Found by the independent review of the first version, written before their fix:
// - « Tube cuivre … y compris supports / essais » or « Pompe … y compris mise en
//   service » became a quantity to enter (a word that only qualifies the line);
//   a user confirming the model's value (1 ens of « Mise en service ») could never
//   enter it;
// - a frozen line's reduction already spent on a pair of two applied jobs settled
//   the current job's pair too; a reduction pair by pair left a pair open when the
//   reductions covered every duplicate;
// - two zones were « non recalées » when the first page of the level could not
//   register; a translation only the title block proposed was accepted when two
//   identical wings sat at one sheet place;
// - the minimum common length ignored the scale (runs abutting at the zone limit
//   at 1/200 overlap by a 49 cm band);
// - a box drawn back to its start then closed counted 3 corners; a sliver of a
//   few centimetres between rooms was sampled at 5 cm;
// - PVC drainage took pressure sizes (DN 20) and the reverse; standard sizes were
//   missing (cast iron DN 80, copper 8 mm); stainless drainage and copper glycol
//   were refused; a vector « Ø 110 » cast iron failed; a size printed « Ø 23 »
//   failed as a missing DN; an m2 network line was read as a pipe;
// - a surface the model proposed got a closed-box pass it never checked.
// Codex review of PR #153, written before their fix:
// - « Pose seule de vanne », « Transport de pompe », « Mise en service de pompe »
//   became observable because an organ followed the activity the head names;
// - « EF cuivre DN 22 / DN 23 » passed the DN rule on its first, known size;
// - runs drawn on three plans demanded a reduction per pair (a stretch on three
//   plans counted three times over instead of twice), so a correct correction
//   never settled them;
// - « DN 100 » and « Ø 110 » of one cast-iron pipe on two zone plans were never
//   compared.
// Second Codex round (written before their fix):
// - two insulations « DN 15 » and « DN 20 » met in a series of another material
//   (an insulation has none) and were taken as one run;
// - four runs each touching their continuation by 10 cm at the zone limit added
//   up past the minimum common length;
// - a wall thickness (« ép. 20 mm ») became the DN of a line without one;
// - « Tronçons verticaux » (the masculine plural) stayed observable.
// Third Codex round (written before their fix):
// - a group of pages at two scales settled with the coarsest minimum of all, so a
//   0.4 m duplicate of two 1/50 pages was never paid by its own reduction;
// - (bench) a Decisions stop left the documents read before it without rules.
// Fourth Codex round (written before their fix):
// - a group's reductions were compared with its debt as sums, so clearing A = X
//   and B = X + Y settled the duplicate Z of C and D, which they never draw.
// Adversarial review of the settlement (written before their fix):
// - a current line paid the copy two applied lines count between themselves;
// - a piece taken once on the first line of the page order lost or added copies
//   when the lines were not all partners there (a general plan over two zones
//   touching at their limit, three lines 4.5 cm apart): results changed with the
//   page order, a 4.5 m double count was reported settled in one order;
// - a pair's debt was measured from its first page only, not as the smaller of
//   both directions;
// - a group of four lines of 4 000 dashes took over 2 s.

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

  it("tells PVC drainage from PVC pressure sizes, and knows the standard sizes and materials the first table missed", () => {
    expect(checkNetworkDiameter("EU", "pvc", "DN 20").status).toBe("dn_not_in_series");
    expect(checkNetworkDiameter("EF", "pvc-pression", "DN 100").status).toBe("dn_not_in_series");
    expect(checkNetworkDiameter("EF", "pvc-pression", "DN 20").status).toBe("compatible");
    expect(checkNetworkDiameter("EU", "fonte", "DN 80").status).toBe("compatible");
    expect(checkNetworkDiameter("GAZ", "cuivre", "DN 8").status).toBe("compatible");
    expect(checkNetworkDiameter("EUG", "inox", "DN 100").status).toBe("compatible");
    expect(checkNetworkDiameter("GLY", "cuivre", "DN 28").status).toBe("compatible");
  });

  it("reads a vector size either way, and keeps a printed size the series lacks", () => {
    const { results } = evaluateTakeoffRules({ pages: [], lines: [
      line("cast", { inputs: ruleInputsFromVector({ kind: "network", network: "EU", material: "fonte", dn: 110, quantity: 4 }) }),
      line("od", { inputs: ruleInputsFromDesignation({ designation: "EF cuivre Ø 23", unit: "ml", quantity: 4 }) }),
      line("calo", { unit: "m2", inputs: ruleInputsFromDesignation({ designation: "Calorifugeage tube cuivre EF DN 22", unit: "m2", quantity: 4 }) }),
    ] });
    expect(rule(results, "cast", "dn_network")).toMatchObject({ code: "DN_NETWORK_COMPATIBLE" });
    expect(rule(results, "od", "dn_network")).toMatchObject({ code: "DN_NETWORK_DN_NOT_IN_SERIES" });
    expect(rule(results, "calo", "dn_network")).toBeUndefined();
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

  it("reads the cause in the line's head only: a qualifier or a drawn organ keeps the line observable", () => {
    for (const [designation, unit] of [
      ["Tube cuivre EF DN 22 y compris supports et colliers", "ml"], ["Tube cuivre EF 20/22 y compris essais et désinfection", "ml"],
      ["Tube acier noir CHW DN 50 assemblage par soudure", "ml"], ["Pompe de relevage y compris mise en service", "u"],
      ["Ballon ECS 300 L y compris manutention", "u"], ["Robinet d'essai DN 25 SPK", "u"], ["WC suspendu pose seule", "u"],
    ]) {
      expect(ruleInputsFromDesignation({ designation, unit, quantity: 3 }).non_observable, designation).toBeNull();
    }
    expect(ruleInputsFromDesignation({ designation: "Fourniture et pose de supports", unit: "u", quantity: 3 }).non_observable).toBe("support");
    expect(ruleInputsFromDesignation({ designation: "Mise en service", unit: "ens", quantity: 1 }).non_observable).toBe("service");
  });

  it("reads vertical runs in the masculine plural too, and never a wall thickness as a DN", () => {
    expect(nonObservableCause("Tronçons verticaux EF cuivre DN 22")).toBe("vertical");
    for (const designation of ["EF PEHD ép. 20 mm", "EF PEHD épaisseur 20 mm", "EF PEHD Ep 20mm"]) {
      const thick = ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 });
      expect(thick.dn, designation).toBeNull();
      expect(checkNetworkDiameter("EF", "pehd", thick.dn).status, designation).toBe("dn_missing");
    }
    expect(ruleInputsFromDesignation({ designation: "EF PEHD 20 mm ép. 2 mm", unit: "ml", quantity: 10 }).dn).toBe("20 mm");
  });

  it("keeps the activity a head names to be entered, whatever organ follows it", () => {
    for (const designation of ["Pose seule de vanne DN 20", "Transport de pompe", "Mise en service de pompe"]) {
      expect(ruleInputsFromDesignation({ designation, unit: "u", quantity: 2 }).non_observable, designation).not.toBeNull();
    }
  });

  it("fails a line printing a size its series lacks, whatever the order of its sizes", () => {
    for (const designation of ["EF cuivre DN 22 / DN 23", "EF cuivre DN 23 / DN 22"]) {
      const { results } = evaluateTakeoffRules({ pages: [], lines: [line("x", { designation,
        inputs: ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 }) })] });
      expect(rule(results, "x", "dn_network")?.status, designation).toBe("fail");
    }
  });

  it("enters a quantity the user typed even when it equals the model's (1 ens of a service)", () => {
    const service = (entered: boolean) => line("service", { designation: "Mise en service", unit: "ens", quantity: 1, quantity_entered: entered,
      inputs: ruleInputsFromDesignation({ designation: "Mise en service", unit: "ens", quantity: 1 }) });
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [service(false)] }).results, "service", "non_observable")).toMatchObject({ status: "fail" });
    const entered = rule(evaluateTakeoffRules({ pages: [], lines: [service(true)] }).results, "service", "non_observable");
    expect(entered).toMatchObject({ status: "pass", code: "NON_OBSERVABLE_ENTERED", acceptable: false });
    expect(isRuleBlocked([entered as TakeoffRuleResult], false, false)).toBe(false);
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

  it("never takes the frame from the title block alone, even when two identical wings sit at one sheet place", () => {
    const wing = (prefix: string): PageAnchors => ({
      version: 1, lines: sheet(0, 0).lines,
      texts: [...TEXTS.map(([text, index]): [string, number, number] => [`${prefix} ${text}`, 12 + index * 1.3, 4 + index * 0.9]),
        ...Array.from({ length: 10 }, (_, index): [string, number, number] => [`Cartouche ${index}`, 60, 30 + index * 0.4])],
    });
    expect(registerPages(wing("A"), wing("B"))).toMatchObject({ status: "unregistered", reason: "no_building_text" });
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

  /** A line of a group of duplicates and its reduction; a stretch drawn by some of the lines over its length. */
  const member = (id: string, reduction_m: number, frozen = false) => ({ id, frozen, reduction_m });
  /** A stretch drawn by lines that are all partners of each other. */
  const shared = (length_m: number, ...lines: string[]) => ({ lines, length_m,
    pairs: lines.flatMap((left, index) => lines.slice(index + 1).map((right): [string, string] => [left, right])) });

  it("settles a pair with one reduction, counts a reduction once, and never asks a frozen line to change", () => {
    // A shares 1 m with B: either reduction of 1 m settles it.
    expect(settleDuplicates([member("a", 1), member("b", 0)], [shared(1, "a", "b")])).toEqual({ settled: true, deficit_m: 0 });
    expect(settleDuplicates([member("a", 0), member("b", 0)], [shared(1, "a", "b")])).toEqual({ settled: false, deficit_m: 1 });
    // A shares 1 m with B and another 1 m with C: A reduced by 1 m leaves 1 m counted twice.
    expect(settleDuplicates([member("a", 1), member("b", 0), member("c", 0)], [shared(1, "a", "b"), shared(1, "a", "c")]))
      .toMatchObject({ settled: false, deficit_m: 1 });
    // A reduction never removes more of a stretch than its line draws: 1 m drawn three times needs two lines.
    expect(settleDuplicates([member("a", 3), member("b", 0), member("c", 0)], [shared(1, "a", "b", "c")]))
      .toMatchObject({ settled: false, deficit_m: 1 });
    // A frozen line reduced by its whole share settles the current one.
    expect(settleDuplicates([member("f", 1, true), member("n", 0)], [shared(1, "f", "n")])).toMatchObject({ settled: true });
    // Three copies of 5 m: two lines left at 1 cm each settle it (a centimetre of rounding per line reduced), 2 cm each do not.
    expect(settleDuplicates([member("a", 0), member("b", 4.99), member("c", 4.99)], [shared(5, "a", "b", "c")]).settled).toBe(true);
    expect(settleDuplicates([member("a", 0), member("b", 4.98), member("c", 4.98)], [shared(5, "a", "b", "c")]))
      .toEqual({ settled: false, deficit_m: 0.04 });
  });

  it("spends a frozen reduction on the applied pair it was made for, and shares reductions that cover every pair", () => {
    // F (applied) was reduced by 1 m for its duplicate with Z (applied); N (current) also shares 1 m with F: N must reduce.
    const stretches = [shared(1, "f", "z"), shared(1, "f", "n")];
    expect(settleDuplicates([member("f", 1, true), member("z", 0, true), member("n", 0)], stretches)).toEqual({ settled: false, deficit_m: 1 });
    expect(settleDuplicates([member("f", 1, true), member("z", 0, true), member("n", 1)], stretches).settled).toBe(true);
    // A shares 1 m with B and 1 m with C; B and A were each reduced by 1 m: both are settled, whatever the order.
    expect(settleDuplicates([member("a", 1), member("b", 1), member("c", 0)], [shared(1, "a", "b"), shared(1, "a", "c")]).settled).toBe(true);
    // A stretch two applied lines already count twice, drawn again by N: N owes its own copy only, never theirs.
    expect(settleDuplicates([member("f", 0, true), member("g", 0, true), member("n", 1)], [shared(1, "f", "g", "n")]))
      .toEqual({ settled: true, deficit_m: 0 });
    expect(settleDuplicates([member("f", 0, true), member("g", 0, true), member("n", 0)], [shared(1, "f", "g", "n")]))
      .toEqual({ settled: false, deficit_m: 1 });
    // A reduction never pays a stretch its line does not draw: A = X, B = X + Y, C = Y + Z, D = Z, A and B cleared.
    expect(settleDuplicates([member("a", 5), member("b", 10), member("c", 0), member("d", 0)],
      [shared(5, "a", "b"), shared(5, "b", "c"), shared(5, "c", "d")])).toEqual({ settled: false, deficit_m: 5 });
  });

  it("settles three overlapping runs once the version counts each stretch once", () => {
    // Z1 0–6 m, Z2 4–10 m, Z3 5–12 m: 4–5 m drawn twice, 5–6 m three times, 6–10 m twice: 7 m counted too many,
    // though their pairs add up to 8 m. Z2 reduced by 2 m and Z3 by 5 m settle the three; Z3 by 4 m leaves 1 m.
    const runs: Array<[number, number]> = [[0, 6], [4, 10], [5, 12]];
    const three = (quantities: [number, number, number]) => evaluateTakeoffRules({
      pages: [0, 1, 2].map((index) => page(`job-${index}#1`, { order: index * 10_000, zone: `Z${index + 1}`,
        anchors: sheet(-40 * index, 0, { titleBlock: 10 }), denominator: 50 })),
      lines: [0, 1, 2].map((index) => line(`r${index}`, { job_id: `job-${index}`, page_key: `job-${index}#1`, quantity: quantities[index],
        geometry: { segments_m: [[runs[index][0] - 40 * index, 1, runs[index][1] - 40 * index, 1]], polygon_m: null,
          length_m: runs[index][1] - runs[index][0], area_m2: null } })),
    });
    expect(rule(three([6, 6, 7]).results, "r0", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 7 } });
    const corrected = three([6, 4, 2]);
    for (const id of ["r0", "r1", "r2"]) expect(rule(corrected.results, id, "zone_overlap")?.code, id).toBe("ZONE_OVERLAP_RESOLVED");
    expect(rule(three([6, 4, 3]).results, "r2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
  });

  it("settles a group of pages at two scales with each pair's own minimum common length", () => {
    // A (1/50) holds 0.4 m drawn again on B (1/50) and 5 m drawn again on C (1/200, minimum 49 cm): A counts 5.4 m too
    // many; A reduced by 5.4 m settles the three, though 0.4 m is under C's minimum.
    const segments: Array<Array<[number, number, number, number]>> = [[[0, 1, 0.4, 1], [2, 1, 7, 1]], [[0, 1, 0.4, 1]], [[2, 1, 7, 1]]];
    const lengths = [5.4, 0.4, 5];
    const scaled = (quantityA: number) => evaluateTakeoffRules({
      pages: [0, 1, 2].map((index) => page(`job-${index}#1`, { order: index * 10_000, zone: `Z${index + 1}`,
        anchors: sheet(-40 * index, 0, { titleBlock: 10 }), denominator: index === 2 ? 200 : 50 })),
      lines: [0, 1, 2].map((index) => line(`s${index}`, { job_id: `job-${index}`, page_key: `job-${index}#1`,
        quantity: index === 0 ? quantityA : lengths[index],
        geometry: { segments_m: segments[index].map(([x0, y0, x1, y1]) => [x0 - 40 * index, y0, x1 - 40 * index, y1] as [number, number, number, number]),
          polygon_m: null, length_m: lengths[index], area_m2: null } })),
    });
    expect(rule(scaled(5.4).results, "s0", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 5.4 } });
    const settled = scaled(0.01);
    for (const id of ["s0", "s1", "s2"]) expect(rule(settled.results, id, "zone_overlap")?.code, id).toBe("ZONE_OVERLAP_RESOLVED");
  });

  it("spends a reduction only on the stretches its line draws, never on another pair's duplicate", () => {
    // Four pages: A = X, B = X + Y, C = Y + Z, D = Z, three separate 5 m stretches each drawn twice (15 m too many).
    const X: [number, number, number, number] = [0, 1, 5, 1], Y: [number, number, number, number] = [10, 1, 15, 1];
    const Z: [number, number, number, number] = [20, 1, 25, 1];
    const drawn = [[X], [X, Y], [Y, Z], [Z]];
    const four = (quantities: [number, number, number, number]) => evaluateTakeoffRules({
      pages: [0, 1, 2, 3].map((index) => page(`job-${index}#1`, { order: index * 10_000, zone: `Z${index + 1}`,
        anchors: sheet(-40 * index, 0, { titleBlock: 10 }), denominator: 50 })),
      lines: [0, 1, 2, 3].map((index) => line(`q${index}`, { job_id: `job-${index}`, page_key: `job-${index}#1`, quantity: quantities[index],
        geometry: { segments_m: drawn[index].map(([x0, y0, x1, y1]) => [x0 - 40 * index, y0, x1 - 40 * index, y1] as [number, number, number, number]),
          polygon_m: null, length_m: drawn[index].length * 5, area_m2: null } })),
    });
    // A and B cleared (15 m removed) leave Z counted twice: no reduction of A or B can remove it.
    const wrong = four([0, 0, 10, 5]);
    for (const id of ["q2", "q3"]) {
      expect(rule(wrong.results, id, "zone_overlap"), id).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 5 } });
    }
    // One copy of each stretch removed (A by X, B by Y, C by Z) settles the four.
    const right = four([0, 5, 5, 5]);
    for (const id of ["q0", "q1", "q2", "q3"]) expect(rule(right.results, id, "zone_overlap")?.code, id).toBe("ZONE_OVERLAP_RESOLVED");
  });

  /**
   * Lines of a level on their own pages (one job each, every page shifted by -40 m per page with its drawing), in a
   * given page order: index i of `orders` is the order of line i's page.
   */
  function onPages(specs: Array<{ id: string; segments: Array<[number, number, number, number]>; quantity: number; frozen?: boolean }>,
    orders: number[], denominator = 50) {
    return evaluateTakeoffRules({
      pages: specs.map((_, index) => page(`job-${index}#1`, { order: orders[index] * 10_000, zone: `Z${index + 1}`,
        anchors: sheet(-40 * index, 0, { titleBlock: 10 }), denominator })),
      lines: specs.map((spec, index) => line(spec.id, { job_id: `job-${index}`, page_key: `job-${index}#1`, quantity: spec.quantity,
        frozen: spec.frozen ?? false,
        geometry: { segments_m: spec.segments.map(([x0, y0, x1, y1]) => [x0 - 40 * index, y0, x1 - 40 * index, y1] as [number, number, number, number]),
          polygon_m: null, length_m: spec.segments.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0), area_m2: null } })),
    });
  }
  const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const codes = (results: Map<string, TakeoffRuleResult[]>, ids: string[]) =>
    ids.map((id) => { const entry = rule(results, id, "zone_overlap"); return `${id}:${entry?.code}:${(entry?.details as { overlap_m?: number } | undefined)?.overlap_m ?? "-"}`; });

  it("settles a general plan over two zones that only touch at their limit the same way in every page order", () => {
    // 1/100: Z1 draws 0–5.12 m, Z2 4.88–10 m (a 24 cm touch at the limit, no pair); the general plan G draws 0–10 m.
    const run = (g: number, z1: number, z2: number) => [
      { id: "G", segments: [[0, 1, 10, 1]] as Array<[number, number, number, number]>, quantity: g },
      { id: "Z1", segments: [[0, 1, 5.12, 1]] as Array<[number, number, number, number]>, quantity: z1 },
      { id: "Z2", segments: [[4.88, 1, 10, 1]] as Array<[number, number, number, number]>, quantity: z2 },
    ];
    for (const orders of ORDERS) {
      // G cleared: Z1 and Z2 are left, touching under the minimum: settled.
      expect(codes(onPages(run(0, 5.12, 5.12), orders, 100).results, ["G", "Z1", "Z2"]), String(orders))
        .toEqual(["G:ZONE_OVERLAP_RESOLVED:-", "Z1:ZONE_OVERLAP_RESOLVED:-", "Z2:ZONE_OVERLAP_RESOLVED:-"]);
      // Z1 cleared, Z2 keeps 0.45 m, all inside G: 0.45 m still counted twice.
      expect(codes(onPages(run(10, 0, 0.45), orders, 100).results, ["G", "Z1", "Z2"]), String(orders))
        .toEqual(["G:ZONE_OVERLAP_DUPLICATE:0.45", "Z1:ZONE_OVERLAP_DUPLICATE:0.45", "Z2:ZONE_OVERLAP_DUPLICATE:0.45"]);
    }
  });

  it("asks the middle line of two distinct pipes 9 cm apart for one copy only, in every page order and when they are applied", () => {
    // A at y = 1, B at 1.045, C at 1.09: B is within 5 cm of both, A and C (9 cm apart) are two pipes.
    const run = (b: number, frozen = false) => [
      { id: "A", segments: [[0, 1, 5, 1]] as Array<[number, number, number, number]>, quantity: 5, frozen },
      { id: "B", segments: [[0, 1.045, 5, 1.045]] as Array<[number, number, number, number]>, quantity: b },
      { id: "C", segments: [[0, 1.09, 5, 1.09]] as Array<[number, number, number, number]>, quantity: 5, frozen },
    ];
    for (const orders of ORDERS) {
      expect(codes(onPages(run(5), orders).results, ["A", "B", "C"]), String(orders))
        .toEqual(["A:ZONE_OVERLAP_DUPLICATE:5", "B:ZONE_OVERLAP_DUPLICATE:5", "C:ZONE_OVERLAP_DUPLICATE:5"]);
      for (const frozen of [false, true]) {
        expect(codes(onPages(run(0, frozen), orders).results, ["A", "B", "C"]), `${orders} ${frozen}`)
          .toEqual(["A:ZONE_OVERLAP_RESOLVED:-", "B:ZONE_OVERLAP_RESOLVED:-", "C:ZONE_OVERLAP_RESOLVED:-"]);
      }
    }
  });

  it("settles a pair by its common length, the smaller of both directions, whichever page comes first", () => {
    // X runs straight where Y jogs 4 cm either side (two 20 cm pieces, not continuous from Y's side): common length 5 m.
    const X: Array<[number, number, number, number]> = [[0, 1, 0.4, 1], [10, 1, 15, 1]];
    const Y: Array<[number, number, number, number]> = [[0, 1.04, 0.2, 1.04], [0.2, 1.04, 0.2, 0.96], [0.2, 0.96, 0.4, 0.96], [10, 1, 15, 1]];
    for (const orders of [[0, 1], [1, 0]]) {
      const settled = onPages([{ id: "X", segments: X, quantity: 0.4 }, { id: "Y", segments: Y, quantity: 5.48 }], orders);
      expect(codes(settled.results, ["X", "Y"]), String(orders)).toEqual(["X:ZONE_OVERLAP_RESOLVED:-", "Y:ZONE_OVERLAP_RESOLVED:-"]);
    }
  });

  it("compares one pipe labelled « DN 100 » on a plan and « Ø 110 » on the other", () => {
    const castIron = (dn: number) => inputs({ network: "EU", material: "fonte", dn: `DN ${dn}` });
    const result = zones({ z1: { inputs: castIron(100) }, z2: { inputs: castIron(110) } });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
  });

  it("never takes two insulations of different sizes for one run", () => {
    const insulation = (dn: number) => inputs({ kind: "insulation", material: "calorifuge", dn: `DN ${dn}` });
    const result = zones({ z1: { inputs: insulation(15) }, z2: { inputs: insulation(20) } });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z1: { inputs: insulation(20) }, z2: { inputs: insulation(20) } }).results, "z1", "zone_overlap"))
      .toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
  });

  it("applies the minimum common length to each continuous stretch, never to touches added up", () => {
    // Four runs of Z1 (0–2 m, 3–5 m, 6–8 m, 9–11 m) each touched 10 cm by its continuation on Z2: four touches, no duplicate.
    const z1 = [[0, 1, 2, 1], [3, 1, 5, 1], [6, 1, 8, 1], [9, 1, 11, 1]] as Array<[number, number, number, number]>;
    const z2 = z1.map(([, , x1]) => [x1 - 0.1 - 40, 1, x1 + 1 - 40, 1] as [number, number, number, number]);
    const touches = zones({ z1: { geometry: { segments_m: z1, polygon_m: null, length_m: 8, area_m2: null } },
      z2: { geometry: { segments_m: z2, polygon_m: null, length_m: 4.4, area_m2: null } } });
    expect(rule(touches.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    // One run drawn as three short legs end to end, all on both plans: one stretch of 60 cm, a duplicate.
    const legs = [[0, 1, 0.2, 1], [0.2, 1, 0.4, 1], [0.4, 1, 0.6, 1]] as Array<[number, number, number, number]>;
    const chained = zones({ z1: { geometry: { segments_m: legs, polygon_m: null, length_m: 0.6, area_m2: null } },
      z2: { geometry: { segments_m: legs.map(([a, b, c, d]) => [a - 40, b, c - 40, d] as [number, number, number, number]), polygon_m: null,
        length_m: 0.6, area_m2: null } } });
    expect(rule(chained.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    // A dashed run (20 cm dashes, 5 cm gaps, as on B R+4) drawn on both plans: one stretch of its dashes, a duplicate.
    const dashes = Array.from({ length: 12 }, (_, index) => [index * 0.25, 1, index * 0.25 + 0.2, 1] as [number, number, number, number]);
    const dashed = (shift: number) => ({ segments_m: dashes.map(([a, b, c, d]) => [a + shift, b, c + shift, d] as [number, number, number, number]),
      polygon_m: null, length_m: 2.4, area_m2: null });
    expect(rule(zones({ z1: { geometry: dashed(0) }, z2: { geometry: dashed(-40) } }).results, "z1", "zone_overlap"))
      .toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 2.4 } });
    // Three parallel pipes 10 cm apart, each touching its continuation by 12 cm at the zone limit: three touches, no duplicate.
    const pipes = [0, 0.1, 0.2].map((y) => [0, 1 + y, 2, 1 + y] as [number, number, number, number]);
    const beside = zones({ z1: { geometry: { segments_m: pipes, polygon_m: null, length_m: 6, area_m2: null } },
      z2: { geometry: { segments_m: pipes.map(([, b, , d]) => [1.88 - 40, b, 4 - 40, d] as [number, number, number, number]), polygon_m: null,
        length_m: 6.36, area_m2: null } } });
    expect(rule(beside.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });

  it("measures a long diagonal run once along its length", () => {
    const run = { id: "a", segments: [[0, 0, 1000, 700]] as Array<[number, number, number, number]> };
    expect(commonLength(run, identity, { id: "b", segments: [[0, 0, 1000, 700]] }, identity)).toBeCloseTo(Math.hypot(1000, 700), 0);
  });

  it("takes a band of the coarser drawing as the smallest duplicate (49 cm at 1/200)", () => {
    expect(minCommonLength([50, 50])).toBe(ZONE_OVERLAP.minLength_m);
    expect(minCommonLength([50, 200])).toBeGreaterThan(0.49);
  });

  /** Two zone plans of one level, Z2's sheet showing the building 40 m further: Z1's run 0–5 m and Z2's 4–7 m share 1 m. */
  function zones(overrides: { z1?: Partial<RuleLine>; z2?: Partial<RuleLine>; z2Anchors?: PageAnchors | null; z2Level?: string;
    pages?: RulePage[]; lines?: RuleLine[]; denominator?: number } = {}) {
    const pages = [
      page("job-z1#1", { order: 0, zone: "Z1", anchors: sheet(0, 0, { titleBlock: 10 }), denominator: overrides.denominator ?? 50 }),
      page("job-z2#1", { order: 10_000, zone: "Z2", level: overrides.z2Level ?? "R+1", denominator: overrides.denominator ?? 50,
        anchors: overrides.z2Anchors === undefined ? sheet(-40, 0, { titleBlock: 10 }) : overrides.z2Anchors }),
      ...(overrides.pages ?? []),
    ];
    const lines = [...(overrides.lines ?? []),
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

  it("applies the minimum common length through the rule, at the pages' scale", () => {
    // Z2's run 4.9–7 m abuts Z1's 0–5 m: 10 cm in common, a touch at the zone limit.
    const touch = { z2: { geometry: { segments_m: [[-35.1, 1, -33, 1]] as Array<[number, number, number, number]>, polygon_m: null, length_m: 2.1, area_m2: null } } };
    expect(rule(zones(touch).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    // 40 cm in common: a duplicate at 1/50, the band of a 1/200 drawing at 1/200.
    const forty = { z2: { geometry: { segments_m: [[-35.4, 1, -33, 1]] as Array<[number, number, number, number]>, polygon_m: null, length_m: 2.4, area_m2: null } } };
    expect(rule(zones(forty).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(rule(zones({ ...forty, denominator: 200 }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });

  it("compares two zones that register with each other although the level's first page does not", () => {
    const detail = page("job-detail#1", { order: -1, zone: null, anchors: { version: 1, texts: [], lines: [] } });
    const detailLine = line("detail", { job_id: "job-detail", page_key: "job-detail#1", inputs: inputs({ network: "ECS" }),
      geometry: { segments_m: [[0, 0, 1, 0]], polygon_m: null, length_m: 1, area_m2: null } });
    const result = zones({ pages: [detail], lines: [detailLine] });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(result.transforms.get("job-detail#1")).toBeNull();
  });

  it("never compares two lines of one page, even beside another registered page", () => {
    const twin = line("z1b", { geometry: { segments_m: [[4, 1, 7, 1]], polygon_m: null, length_m: 3, area_m2: null } });
    const result = zones({ lines: [twin], z2: { inputs: inputs({ dn: "DN 28" }) } });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });

  it("spends no reduction on an excluded partner", () => {
    // z1 reduced by 1 m shares 1 m with z2 (excluded) and 1 m with z3 (included): its reduction settles z3.
    const z3 = line("z3", { job_id: "job-z3", page_key: "job-z3#1", geometry: { segments_m: [[-76, 1, -73, 1]], polygon_m: null, length_m: 3, area_m2: null },
      inputs: inputs({ model_quantity: 3 }), quantity: 3 });
    const result = zones({ z1: { quantity: 4, geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null } },
      z2: { is_excluded: true }, lines: [z3], pages: [page("job-z3#1", { order: 20_000, zone: "Z3", anchors: sheet(-80, 0, { titleBlock: 10 }), denominator: 50 })] });
    expect(rule(result.results, "z3", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
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
      line("m2", { unit: "m2", inputs: ruleInputsFromDesignation({ designation: "Surface Bureau 101", unit: "m2", quantity: 12 }) }),
      line("u", { unit: "u", inputs: ruleInputsFromDesignation({ designation: "Vanne DN 22", unit: "u", quantity: 2 }) }),
    ] });
    expect(rule(results, "ml", "scale_dimension")).toMatchObject({ status: "fail", code: "SCALE_DIMENSION_MISMATCH" });
    expect(rule(results, "m2", "scale_dimension")).toMatchObject({ status: "fail", code: "SCALE_DIMENSION_MISMATCH" });
    expect(rule(results, "u", "scale_dimension")).toBeUndefined();
    // A surface the model proposed has no label nor contour: the closed-box rule has nothing to read.
    expect(rule(results, "m2", "closed_box")).toBeUndefined();
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
    const excluded = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [room("a", square(0, 0, 4), 16, 16),
      { ...room("b", square(3, 0, 4), 16, 16), is_excluded: true }] });
    expect(rule(excluded.results, "a", "room_overlap")).toMatchObject({ status: "pass" });
  });

  it("measures a sliver of a few centimetres between two rooms", () => {
    const rect = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    // 10 × 1.5 m rooms overlapping by 3 cm: 0.30 m², at the threshold of max(2 % of 15 m², 0.1 m²), no overlap.
    const sliver = sharedArea(rect(0, 0, 10, 1.5), rect(0, 1.47, 10, 2.97));
    expect(sliver).toBeCloseTo(0.3, 2);
    expect(roomsOverlap(sliver, 15, 15)).toBe(false);
    // 2.4 cm along a 30 × 1 m corridor: 0.72 m², over its 0.6 m² threshold.
    const corridor = sharedArea(rect(0, 0, 30, 1), rect(0, 0.976, 30, 3));
    expect(corridor).toBeCloseTo(0.72, 1);
    expect(roomsOverlap(corridor, 30, 60)).toBe(true);
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

  it("counts the corners of a box drawn back to its start then closed", () => {
    // m A l B l C l D l A h: the extraction repeats A twice at the end.
    const drawn = [10, 0, 12, 0, 12, 2, 10, 2, 10, 0, 10, 0];
    expect(polygonPoints(drawn)).toHaveLength(4);
    const { results } = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [room("box", drawn, 4, 13.6, "Infirmerie")] });
    expect(rule(results, "box", "closed_box")).toMatchObject({ status: "fail", code: "CLOSED_BOX_SHAPE" });
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
    const pass: TakeoffRuleResult = { rule: "non_observable", status: "pass", code: "NON_OBSERVABLE_ENTERED", version: 1, acceptable: false, reason: "Fictional" };
    expect(isRuleBlocked([pass], false, false)).toBe(false);
  });
});
