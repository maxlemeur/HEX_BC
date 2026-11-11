import { describe, expect, it } from "vitest";

import { blockingRules, isRuleBlocked } from "@/lib/takeoff/rules/blocking";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { nonObservableCause, ruleInputsFromDesignation, ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import { NETWORK_MATERIALS, checkNetworkDiameter } from "@/lib/takeoff/rules/network-diameters";
import { REGISTRATION, registerPages, type PageAnchors } from "@/lib/takeoff/rules/registration";
import { polygonPoints, roomsOverlap, sharedArea } from "@/lib/takeoff/rules/rooms";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { ZONE_OVERLAP, commonLength, minCommonLength, settlePair } from "@/lib/takeoff/rules/zone-overlap";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { BAND_MAX_PT } from "@/lib/takeoff/vectors/measure";
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
// Second adversarial review of the settlement, and the decision that followed
// (written before the fix): lines dropping out of a shared stretch (hub-drop),
// an applied line assumed to remove the copies it never removed, a current zone
// under an applied general plan keeping 0.36 m of band pieces, and a stretch two
// applied lines still count twice were all reported settled. A reduction says
// how much a line removed, never where: corrections now settle an isolated pair
// only; a group of three lines or more stays failed until each line is excluded
// or accepted (V). The pair is checked against an exact oracle on random
// geometry, scales, applied and excluded lines, reductions and orders.
// Adversarial review of that decision (written before their fix): two pages were
// compared through a path of registrations by a third page that did not close,
// and a 3 m duplicate passed when that page came first; a touch end to end left a
// float sliver that chained two short stretches; a copy 5 cm away, a common length
// ending in half a millimetre and a stretch just over the minimum at 1/150 changed
// with the page taken as frame or were dropped; two pairs whose ids join alike
// shared a cached coverage; a model quantity stored to the thousandth read as typed.
// TI-684 (D14, written before the fix): two copies of one run whose network, material
// or DN contradict each other were never compared, and the run was counted twice
// without a word; side by side on both plans, two pipes must stay two isolated pairs.
// Fifth Codex round (written before its fix): « EF cuivre DN 22 / Ø 23 » passed the
// DN rule, the reader keeping DN 22 and skipping the unknown Ø 23 beside it.
// Sixth Codex round (written before their fix): « ép. 2,20 mm » gave a 20 mm pipe
// (a match inside a decimal thickness) and « DN 22 ép. 1,0 mm » a 0 mm one; « 1"1/4 »
// was read « 1" » beside « DN 32 », two sizes; fifty overprinted strokes landing on one
// reference wall outweighed twenty distinct walls and registered a wrong frame.

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

/** Every order of `items`. */
function permutations(items: number[]): number[][] {
  return items.length <= 1 ? [items]
    : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
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
    expect(checkNetworkDiameter("EUG", "inox", "DN 100").status).toBe("requires_justification");
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

  it("fails a size the series lacks printed beside a known DN in any notation, and two sizes printed for one line (Codex round 5)", () => {
    const dn = (designation: string) => rule(evaluateTakeoffRules({ pages: [], lines: [line("x", { designation,
      inputs: ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 }) })] }).results, "x", "dn_network")?.code;
    // The reader keeps « DN 22 » and skips the other notation: the unknown size still fails, in either order.
    for (const designation of ["EF cuivre DN 22 / Ø 23", "EF cuivre Ø 23 / DN 22", "EF cuivre DN 22 / 23 mm", "EF cuivre DN 22 / 23x1"]) {
      expect(dn(designation), designation).toBe("DN_NETWORK_DN_NOT_IN_SERIES");
    }
    // Two known sizes for one line are none (« aucun ou deux »), whatever their notations.
    for (const designation of ["EF cuivre DN 22 / Ø 28", "EF cuivre Ø 28 / DN 22", "EF cuivre DN 22 / 28x1"]) {
      expect(dn(designation), designation).toBe("DN_NETWORK_DN_MISSING");
    }
    // One size printed two ways stays one size: « DN 20 » is the 22 mm copper tube.
    for (const designation of ["EF cuivre DN 20 / Ø 22", "EF cuivre DN 20 (22x1)", "EF Inox 316L DN 22"]) {
      expect(dn(designation), designation).toBe("DN_NETWORK_COMPATIBLE");
    }
  });

  it("reads a decimal thickness and a compound inch size whole, whatever the notation (Codex round 6)", () => {
    const read = (designation: string) => ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 });
    const dn = (designation: string) => rule(evaluateTakeoffRules({ pages: [], lines: [line("x", { designation, inputs: read(designation) })] }).results,
      "x", "dn_network")?.code;
    // « ép. 2,20 mm » is a thickness, never a 20 mm pipe; « ép. 1,0 mm » beside a DN never a 0 mm one.
    expect(read("EF PEHD ép. 2,20 mm").dn).toBeNull();
    expect(dn("EF PEHD ép. 2,20 mm")).toBe("DN_NETWORK_DN_MISSING");
    expect(dn("EF cuivre DN 22 ép. 1,0 mm")).toBe("DN_NETWORK_COMPATIBLE");
    // « 1"1/4 » and « 1 1/4" » are one size, as is the DN 32 printed beside either.
    expect(read('HW acier 1"1/4 DN 32').dn).toBe(read('HW acier 1 1/4" DN 32').dn);
    expect(dn('HW acier 1"1/4 DN 32')).toBe(dn('HW acier 1 1/4" DN 32'));
    expect(dn('HW acier 1"1/4 DN 32')).not.toBe("DN_NETWORK_DN_MISSING");
  });

  it("enters a quantity the user typed even when it equals the model's (1 ens of a service)", () => {
    const service = (entered: boolean) => line("service", { designation: "Mise en service", unit: "ens", quantity: 1, quantity_entered: entered,
      inputs: ruleInputsFromDesignation({ designation: "Mise en service", unit: "ens", quantity: 1 }) });
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [service(false)] }).results, "service", "non_observable")).toMatchObject({ status: "fail" });
    const entered = rule(evaluateTakeoffRules({ pages: [], lines: [service(true)] }).results, "service", "non_observable");
    expect(entered).toMatchObject({ status: "pass", code: "NON_OBSERVABLE_ENTERED", acceptable: false });
    expect(isRuleBlocked([entered as TakeoffRuleResult], false, false)).toBe(false);
  });

  // TI-686 D12: an entry is a quantity attested with its category, never a bare edit. The rule keeps its version: a
  // line edited without a category fails again with a new key (failure-keys), and V never settles it.
  it("leaves a quantity changed without an attested entry to enter (model 12, quantity 15)", () => {
    const supports = (entered: boolean) => line("supports", { designation: "Supports de tuyauterie acier galvanisé", unit: "u",
      quantity: 15, quantity_entered: entered,
      inputs: ruleInputsFromDesignation({ designation: "Supports de tuyauterie acier galvanisé", unit: "u", quantity: 12 }) });
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [supports(false)] }).results, "supports", "non_observable"))
      .toMatchObject({ status: "fail", code: "NON_OBSERVABLE_TO_ENTER", version: 1, acceptable: false });
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [supports(true)] }).results, "supports", "non_observable"))
      .toMatchObject({ status: "pass", code: "NON_OBSERVABLE_ENTERED", version: 1 });
  });

  it("keeps an unknown DN as printed, so that the DN rule fails it", () => {
    const read = ruleInputsFromDesignation({ designation: "EF cuivre DN 23", unit: "ml", quantity: 10 });
    expect(read).toMatchObject({ kind: "network", network: "EF", material: "cuivre", dn: "DN 23" });
    expect(checkNetworkDiameter("EF", "cuivre", read.dn).status).toBe("dn_not_in_series");
    expect(ruleInputsFromDesignation({ designation: "EF Inox 316L DN 22", unit: "ml", quantity: 10 }))
      .toMatchObject({ network: "EF", material: "inox-316l", dn: "DN 22" });
  });

  it("fails a quantity to enter until the user attests one, and verifying never settles it", () => {
    const soudures = (quantity: number, entered = false) => line("weld", { designation: "Soudures inox", unit: "u", quantity,
      quantity_entered: entered, inputs: ruleInputsFromDesignation({ designation: "Soudures inox", unit: "u", quantity: 48 }) });
    const proposed = rule(evaluateTakeoffRules({ pages: [], lines: [soudures(48)] }).results, "weld", "non_observable");
    expect(proposed).toMatchObject({ status: "fail", code: "NON_OBSERVABLE_TO_ENTER", acceptable: false });
    expect(isRuleBlocked([proposed as TakeoffRuleResult], false, true)).toBe(true);
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [soudures(52)] }).results, "weld", "non_observable"))
      .toMatchObject({ status: "fail", code: "NON_OBSERVABLE_TO_ENTER" });
    expect(rule(evaluateTakeoffRules({ pages: [], lines: [soudures(52, true)] }).results, "weld", "non_observable"))
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

  it("credits a reference line once, so that overprinted strokes never outweigh distinct walls (Codex round 6)", () => {
    type Line = [number, number, number, number];
    const walls = (sx: number) => Array.from({ length: 20 }, (_, index): Line => [10 + sx, 2 + index * 0.7, 13 + (index % 5) + sx, 2 + index * 0.7]);
    const texts = (sx: number) => TEXTS.map(([text, index]): [string, number, number] => [text, 12 + index * 1.3 + sx, 4 + index * 0.9]);
    const reference: PageAnchors = { version: 1, lines: [...walls(0), [40, 5, 42, 5]], texts: [...texts(0), ["Gaine A", 40.5, 5.5], ["Gaine B", 41.5, 5.5]] };
    // The other sheet shows the building 30 m further left. Fifty strokes overprinted within 2.5 cm, away from it, land
    // on the reference's one extra wall through the wrong translation (-20, -45) that its two « Gaine » texts propose.
    const strokes = Array.from({ length: 50 }, (_, index): Line => [60, 50 + index * 0.0005, 62, 50 + index * 0.0005]);
    const other: PageAnchors = { version: 1, lines: [...walls(-30), ...strokes], texts: [...texts(-30), ["Gaine A", 60.5, 50.5], ["Gaine B", 61.5, 50.5]] };
    expect(registerPages(reference, other)).toMatchObject({ status: "registered", dx: 30, dy: 0 });
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

  type Seg = [number, number, number, number];
  /** A line of its own page (one job each): its centrelines in the common frame, its quantity, its status and DN. */
  type Spec = { id: string; segments: Seg[]; quantity: number; frozen?: boolean; excluded?: boolean; dn?: string };

  /**
   * Lines of a level on their own pages (every page shifted by -40 m per page with its drawing), in a given page order:
   * index i of `orders` is the order of line i's page; `reverse` lists the lines and pages the other way round.
   */
  function onPages(specs: Spec[], orders: number[], denominator: number | Array<number | null> = 50, reverse = false) {
    const pages = specs.map((_, index) => page(`job-${index}#1`, { order: orders[index] * 10_000, zone: `Z${index + 1}`,
      anchors: sheet(-40 * index, 0, { titleBlock: 10 }), denominator: Array.isArray(denominator) ? denominator[index] : denominator }));
    const lines = specs.map((spec, index) => line(spec.id, { job_id: `job-${index}`, page_key: `job-${index}#1`, quantity: spec.quantity,
      designation: `EF Inox 316L DN 22 (${spec.id})`, frozen: spec.frozen ?? false, is_excluded: spec.excluded ?? false,
      ...(spec.dn ? { inputs: inputs({ dn: spec.dn }) } : {}),
      geometry: { segments_m: spec.segments.map(([x0, y0, x1, y1]): Seg => [x0 - 40 * index, y0, x1 - 40 * index, y1]),
        polygon_m: null, length_m: spec.segments.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0), area_m2: null } }));
    return evaluateTakeoffRules({ pages: reverse ? pages.reverse() : pages, lines: reverse ? lines.reverse() : lines });
  }
  /** Each line's outcome: code, length still counted twice (pair) or drawn elsewhere (group), and the group's size. */
  const codes = (results: Map<string, TakeoffRuleResult[]>, ids: string[]) => ids.map((id) => {
    const details = rule(results, id, "zone_overlap")?.details;
    return `${id}:${rule(results, id, "zone_overlap")?.code}:${details?.overlap_m ?? "-"}${details?.group_size ? `:${details.group_size} lignes` : ""}`;
  });
  /** The outcome of the lines, the same in every page order and listed either way (fails otherwise). */
  function inEveryOrder(specs: Spec[], denominator: number | Array<number | null> = 50) {
    const seen = new Set<string>();
    for (const orders of permutations(specs.map((_, index) => index))) {
      for (const reverse of [false, true]) seen.add(JSON.stringify(codes(onPages(specs, orders, denominator, reverse).results, specs.map((spec) => spec.id))));
    }
    expect([...seen], "one outcome whatever the order").toHaveLength(1);
    return JSON.parse([...seen][0]) as string[];
  }

  it("settles a pair with one reduction or two that add up, counts a reduction once, and leaves a centimetre per line reduced", () => {
    // A shares 1 m with B: either reduction of 1 m settles it, or both of 0.5 m.
    expect(settlePair(1, [1, 0])).toEqual({ settled: true, deficit_m: 0 });
    expect(settlePair(1, [0, 1])).toEqual({ settled: true, deficit_m: 0 });
    expect(settlePair(1, [0.5, 0.5])).toEqual({ settled: true, deficit_m: 0 });
    expect(settlePair(1, [0, 0])).toEqual({ settled: false, deficit_m: 1 });
    // A reduction removes at most the common length; a quantity raised above the measure removes nothing.
    expect(settlePair(1, [3, 0])).toEqual({ settled: true, deficit_m: 0 });
    expect(settlePair(1, [-2, 0.4])).toEqual({ settled: false, deficit_m: 0.6 });
    // 5 m in common: a centimetre of rounding per line reduced, never more.
    expect(settlePair(5, [4.99, 0]).settled).toBe(true);
    expect(settlePair(5, [4.98, 0])).toEqual({ settled: false, deficit_m: 0.02 });
    expect(settlePair(5, [2.49, 2.49]).settled).toBe(true);
    expect(settlePair(5, [2.485, 2.485])).toEqual({ settled: false, deficit_m: 0.03 });
  });

  it("lets an applied line reduced before it was applied settle its pair, and asks the current line when it was not", () => {
    // Z2 (3 m, applied) shares 1 m with Z1 (current).
    expect(rule(zones({ z2: { frozen: true } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
    expect(rule(zones({ z2: { frozen: true }, z1: { quantity: 4 } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(zones({ z2: { frozen: true, quantity: 2 } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
  });

  it("never settles three overlapping runs by corrections, only once a line entirely duplicated is excluded", () => {
    // Z1 0–6 m, Z2 4–10 m, Z3 5–12 m: 7 m counted too many. Which metres a correction removed is unknown: Z2 by 2 m and Z3 by
    // 5 m may be right, or a measure fixed elsewhere on the line. In a group of three lines no correction settles it.
    const runs = (z1: number, z2: number, z3: number, excluded = false): Spec[] => [
      { id: "Z1", segments: [[0, 1, 6, 1]], quantity: z1 },
      { id: "Z2", segments: [[4, 1, 10, 1]], quantity: z2, excluded },
      { id: "Z3", segments: [[5, 1, 12, 1]], quantity: z3 },
    ];
    // Each line shows what other lines draw of it: Z1 4–6 m, Z2 all of it, Z3 5–10 m.
    for (const [z1, z2, z3] of [[6, 6, 7], [6, 4, 2], [0, 0, 0]]) {
      expect(inEveryOrder(runs(z1, z2, z3)), `${z1} ${z2} ${z3}`)
        .toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:2:3 lignes", "Z2:ZONE_OVERLAP_DUPLICATE:6:3 lignes", "Z3:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
    }
    // Z2 lies inside Z1 and Z3: excluded, it leaves a pair sharing 5–6 m, settled by a 1 m reduction. Z2 is shown as it
    // would stand if it came back.
    expect(inEveryOrder(runs(6, 6, 7, true)))
      .toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:1", "Z2:ZONE_OVERLAP_DUPLICATE:6:3 lignes", "Z3:ZONE_OVERLAP_DUPLICATE:1"]);
    expect(inEveryOrder(runs(6, 6, 6, true)))
      .toEqual(["Z1:ZONE_OVERLAP_RESOLVED:-", "Z2:ZONE_OVERLAP_DUPLICATE:6:3 lignes", "Z3:ZONE_OVERLAP_RESOLVED:-"]);
  });

  it("measures each pair at its own scale, and settles a pair of two 1/50 pages beside a 1/200 page", () => {
    // A (1/50) holds 0.4 m drawn again on B (1/50) and 5 m drawn again on C (1/200, minimum 49 cm): 0.4 m is a duplicate
    // of its own pair, under C's minimum. With C applied, three lines: corrections never settle them.
    const specs = (quantityA: number, dnC = "DN 22", yC = 1, c: Partial<Spec> = { frozen: true }): Spec[] => [
      { id: "A", segments: [[0, 1, 0.4, 1], [2, 1, 7, 1]], quantity: quantityA },
      { id: "B", segments: [[0, 1, 0.4, 1]], quantity: 0.4 },
      { id: "C", segments: [[2, yC, 7, yC]], quantity: 5, dn: dnC, ...c },
    ];
    for (const quantity of [5.4, 0.01]) {
      expect(inEveryOrder(specs(quantity), [50, 50, 200]))
        .toEqual(["A:ZONE_OVERLAP_DUPLICATE:5.4:3 lignes", "B:ZONE_OVERLAP_DUPLICATE:0.4:3 lignes", "C:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
    }
    // C read with another DN at the same place is still a copy of A's 5 m (TI-684): the same group of three lines.
    expect(inEveryOrder(specs(5.4, "DN 28"), [50, 50, 200]))
      .toEqual(["A:ZONE_OVERLAP_DUPLICATE:5.4:3 lignes", "B:ZONE_OVERLAP_DUPLICATE:0.4:3 lignes", "C:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
    // C drawn 6 cm aside is another pipe: A and B are a pair of 0.4 m at 1/50, settled by A's 0.4 m reduction.
    expect(inEveryOrder(specs(5.4, "DN 22", 1.06), [50, 50, 200]))
      .toEqual(["A:ZONE_OVERLAP_DUPLICATE:0.4", "B:ZONE_OVERLAP_DUPLICATE:0.4", "C:ZONE_OVERLAP_NONE:-"]);
    expect(inEveryOrder(specs(5, "DN 28", 1.06), [50, 50, 200])).toEqual(["A:ZONE_OVERLAP_RESOLVED:-", "B:ZONE_OVERLAP_RESOLVED:-", "C:ZONE_OVERLAP_NONE:-"]);
    // TI-684, enlarged plans: C not applied is an overview of A and yields to it. A and B stay a pair of 0.4 m, which
    // A's reduction settles; C's copy of A is C's to remove, and A fails with it until then.
    expect(inEveryOrder(specs(5.4, "DN 22", 1, {}), [50, 50, 200]))
      .toEqual(["A:ZONE_OVERLAP_DUPLICATE:0.4", "B:ZONE_OVERLAP_DUPLICATE:0.4", "C:ZONE_OVERLAP_DUPLICATE:5"]);
    expect(inEveryOrder(specs(0.01, "DN 22", 1, {}), [50, 50, 200]))
      .toEqual(["A:ZONE_OVERLAP_DUPLICATE:5", "B:ZONE_OVERLAP_RESOLVED:-", "C:ZONE_OVERLAP_DUPLICATE:5"]);
    expect(inEveryOrder(specs(5, "DN 22", 1, { quantity: 0 }), [50, 50, 200]))
      .toEqual(["A:ZONE_OVERLAP_RESOLVED:-", "B:ZONE_OVERLAP_RESOLVED:-", "C:ZONE_OVERLAP_RESOLVED:-"]);
    expect(inEveryOrder(specs(5.4, "DN 28", 1, {}), [50, 50, 200]))
      .toEqual(["A:ZONE_OVERLAP_DUPLICATE:0.4", "B:ZONE_OVERLAP_DUPLICATE:0.4", "C:ZONE_OVERLAP_DUPLICATE:5"]);
  });

  // TI-684, enlarged plans (D14 of 6 Nov. 2026, written before the rule): « à indice cohérent, le détail agrandi fait
  // foi dans son périmètre ». A line of an overview whose copies are all on plans at a finer scale yields to them: it
  // carries the correction, in no group. A duplicate never settles by itself: both lines fail until it is removed.
  describe("enlarged plans (TI-684, D14)", () => {
    const detail: Spec = { id: "D", segments: [[0, 1, 5, 1]], quantity: 5 };
    const overview = (quantity = 7, extra: Partial<Spec> = {}): Spec => ({ id: "O", segments: [[2, 1, 9, 1]], quantity, ...extra });
    const zoneRule = (results: Map<string, TakeoffRuleResult[]>, id: string) => rule(results, id, "zone_overlap");
    const plans = (results: Map<string, TakeoffRuleResult[]>, id: string) =>
      zoneRule(results, id)?.details?.partners?.map((partner) => `${partner.item_id}:${partner.plan ?? "-"}:${partner.resolved}`);

    it("leaves the correction to the overview's line and says so on both lines: the enlarged plan prevails", () => {
      // D (1/50) draws 0–5 m, O (1/100) 2–9 m: 3 m are counted twice.
      expect(inEveryOrder([detail, overview()], [50, 100])).toEqual(["D:ZONE_OVERLAP_DUPLICATE:3", "O:ZONE_OVERLAP_DUPLICATE:3"]);
      const { results } = onPages([detail, overview()], [0, 1], [50, 100]);
      const [d, o] = [zoneRule(results, "D"), zoneRule(results, "O")];
      expect(o).toMatchObject({ status: "fail", acceptable: true, details: { overlap_m: 3, partner_count: 1 } });
      expect(plans(results, "O")).toEqual(["D:enlarged:false"]);
      expect(o?.reason).toContain("le plan agrandi fait foi");
      expect(o?.reason).toContain("retirez cette longueur de cette ligne");
      expect(d).toMatchObject({ status: "fail", acceptable: true, details: { overlap_m: 3, partner_count: 1 } });
      expect(plans(results, "D")).toEqual(["O:overview:false"]);
      expect(d?.reason).toContain("se retire de la ligne du plan d’ensemble, pas de celle-ci");
    });

    it("settles a detail and its overview by a reduction or an exclusion, as any pair", () => {
      expect(inEveryOrder([detail, overview(4)], [50, 100])).toEqual(["D:ZONE_OVERLAP_RESOLVED:-", "O:ZONE_OVERLAP_RESOLVED:-"]);
      expect(inEveryOrder([detail, overview(4.01)], [50, 100])).toEqual(["D:ZONE_OVERLAP_RESOLVED:-", "O:ZONE_OVERLAP_RESOLVED:-"]);
      expect(inEveryOrder([detail, overview(5)], [50, 100])).toEqual(["D:ZONE_OVERLAP_DUPLICATE:1", "O:ZONE_OVERLAP_DUPLICATE:1"]);
      // The detail reduced instead (or reduced before its job was applied): the run counts once, nothing is left to settle.
      expect(inEveryOrder([{ ...detail, quantity: 2 }, overview()], [50, 100])).toEqual(["D:ZONE_OVERLAP_RESOLVED:-", "O:ZONE_OVERLAP_RESOLVED:-"]);
      expect(inEveryOrder([{ ...detail, quantity: 2, frozen: true }, overview()], [50, 100])).toEqual(["D:ZONE_OVERLAP_RESOLVED:-", "O:ZONE_OVERLAP_RESOLVED:-"]);
      // Excluded, a line counts nothing and is shown as it would stand if it came back.
      expect(inEveryOrder([detail, overview(7, { excluded: true })], [50, 100])).toEqual(["D:ZONE_OVERLAP_NONE:-", "O:ZONE_OVERLAP_DUPLICATE:3"]);
      expect(inEveryOrder([{ ...detail, excluded: true }, overview()], [50, 100])).toEqual(["D:ZONE_OVERLAP_DUPLICATE:3", "O:ZONE_OVERLAP_NONE:-"]);
      const settled = onPages([detail, overview(4)], [0, 1], [50, 100]).results;
      expect([plans(settled, "D"), plans(settled, "O")]).toEqual([["O:overview:true"], ["D:enlarged:true"]]);
    });

    it("lets an overview above two zones settle by its own reduction, whatever the zones settle between them", () => {
      // Z1 (0–31 m) and Z2 (30–60 m) share 1 m; G (1/100) draws 0–70 m, of which the zones draw 60 m. Until this rule
      // the three lines were a group that only an exclusion or V settled.
      const run = (z1: number, g: number): Spec[] => [
        { id: "Z1", segments: [[0, 1, 31, 1]], quantity: z1 }, { id: "Z2", segments: [[30, 1, 60, 1]], quantity: 30 },
        { id: "G", segments: [[0, 1, 70, 1]], quantity: g },
      ];
      expect(inEveryOrder(run(31, 70), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:1", "Z2:ZONE_OVERLAP_DUPLICATE:1", "G:ZONE_OVERLAP_DUPLICATE:60"]);
      // Z1's reduction settles its pair with Z2 and nothing of G: a reduction never says where. Each zone then fails
      // for what G still draws of it.
      expect(inEveryOrder(run(30, 70), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:31", "Z2:ZONE_OVERLAP_DUPLICATE:30", "G:ZONE_OVERLAP_DUPLICATE:60"]);
      expect(inEveryOrder(run(31, 10), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:1", "Z2:ZONE_OVERLAP_DUPLICATE:1", "G:ZONE_OVERLAP_RESOLVED:-"]);
      expect(inEveryOrder(run(31, 40), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:1", "Z2:ZONE_OVERLAP_DUPLICATE:1", "G:ZONE_OVERLAP_DUPLICATE:30"]);
      expect(inEveryOrder(run(30, 10), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_RESOLVED:-", "Z2:ZONE_OVERLAP_RESOLVED:-", "G:ZONE_OVERLAP_RESOLVED:-"]);
      // A failed line names only what is still open: its peer, and the overview while it has not removed its copy.
      const open = onPages(run(31, 70), [0, 1, 2], [50, 50, 100]).results;
      expect([plans(open, "Z1"), plans(open, "G")]).toEqual([["Z2:-:false", "G:overview:false"], ["Z1:enlarged:false", "Z2:enlarged:false"]]);
      expect(zoneRule(open, "Z1")?.reason).toContain("Sa copie sur le plan d’ensemble");
      expect(plans(onPages(run(31, 10), [0, 1, 2], [50, 50, 100]).results, "Z1")).toEqual(["Z2:-:false"]);
      // Two zones that only touch: each fails with the overview alone, until the overview removes the 60 m.
      const touching = (g: number): Spec[] => [{ id: "Z1", segments: [[0, 1, 30.06, 1]], quantity: 30.06 },
        { id: "Z2", segments: [[29.94, 1, 60, 1]], quantity: 30.06 }, { id: "G", segments: [[0, 1, 60, 1]], quantity: g }];
      expect(inEveryOrder(touching(60), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:30.06", "Z2:ZONE_OVERLAP_DUPLICATE:30.06", "G:ZONE_OVERLAP_DUPLICATE:60"]);
      expect(inEveryOrder(touching(0), [50, 50, 100])).toEqual(["Z1:ZONE_OVERLAP_RESOLVED:-", "Z2:ZONE_OVERLAP_RESOLVED:-", "G:ZONE_OVERLAP_RESOLVED:-"]);
      expect(inEveryOrder(touching(60).map((spec) => (spec.id === "G" ? { ...spec, excluded: true } : spec)), [50, 50, 100]))
        .toEqual(["Z1:ZONE_OVERLAP_NONE:-", "Z2:ZONE_OVERLAP_NONE:-", "G:ZONE_OVERLAP_DUPLICATE:60"]);
    });

    it("keeps the pair as it was when no plan is clearly enlarged, or the overview's line is applied", () => {
      // The same scale, a scale that is not read, or one under 1.5 times finer: neither plan prevails.
      for (const scales of [[50, 50], [100, 100], [50, null], [null, 100], [null, null], [50, 70], [100, 145], [50, 75], [100, 200]] as Array<Array<number | null>>) {
        const [finer, coarser] = scales;
        const enlarged = finer !== null && coarser !== null && coarser / finer >= 1.5;
        const { results } = onPages([detail, overview()], [0, 1], scales);
        expect(codes(results, ["D", "O"]), String(scales)).toEqual(["D:ZONE_OVERLAP_DUPLICATE:3", "O:ZONE_OVERLAP_DUPLICATE:3"]);
        expect([plans(results, "D"), plans(results, "O")], String(scales))
          .toEqual(enlarged ? [["O:overview:false"], ["D:enlarged:false"]] : [["O:-:false"], ["D:-:false"]]);
      }
      // An applied overview is never called to change: the correction stays with the current line, as for any applied partner.
      const applied = onPages([detail, overview(7, { frozen: true })], [0, 1], [50, 100]).results;
      expect(codes(applied, ["D", "O"])).toEqual(["D:ZONE_OVERLAP_DUPLICATE:3", "O:ZONE_OVERLAP_DUPLICATE:3"]);
      expect(plans(applied, "D")).toEqual(["O:-:false"]);
      expect(zoneRule(applied, "D")?.reason).toContain("job appliqué");
      // An applied detail changes nothing: the overview yields to it.
      expect(plans(onPages([{ ...detail, frozen: true }, overview()], [0, 1], [50, 100]).results, "O")).toEqual(["D:enlarged:false"]);
    });

    it("yields only when every copy of the line is on an enlarged plan", () => {
      // O (1/100) is drawn again on D (1/50) and on P, another 1/100 page: a group of three lines, as before.
      const plain: Spec[] = [detail, overview(), { id: "P", segments: [[4, 1, 9, 1]], quantity: 5 }];
      expect(inEveryOrder(plain, [50, 100, 100]))
        .toEqual(["D:ZONE_OVERLAP_DUPLICATE:3:3 lignes", "O:ZONE_OVERLAP_DUPLICATE:7:3 lignes", "P:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
      // Three scales: the 1/200 plan yields to both finer plans; the 1/100 plan, itself a detail of it, settles its pair
      // with the 1/50 plan as any pair (a line that prevails over one plan never yields to another).
      const chain: Spec[] = [{ id: "F", segments: [[0, 1, 4, 1]], quantity: 4 }, { id: "M", segments: [[0, 1, 10, 1]], quantity: 10 },
        { id: "G", segments: [[0, 1, 20, 1]], quantity: 20 }];
      expect(inEveryOrder(chain, [50, 100, 200])).toEqual(["F:ZONE_OVERLAP_DUPLICATE:4", "M:ZONE_OVERLAP_DUPLICATE:4", "G:ZONE_OVERLAP_DUPLICATE:10"]);
      expect(inEveryOrder([chain[0], { ...chain[1], quantity: 6 }, { ...chain[2], quantity: 10 }], [50, 100, 200]))
        .toEqual(["F:ZONE_OVERLAP_RESOLVED:-", "M:ZONE_OVERLAP_RESOLVED:-", "G:ZONE_OVERLAP_RESOLVED:-"]);
    });

    it("lets the enlarged plan's reading prevail over a copy the overview reads differently", () => {
      const { results } = onPages([detail, overview(7, { dn: "DN 28" })], [0, 1], [50, 100]);
      expect(codes(results, ["D", "O"])).toEqual(["D:ZONE_OVERLAP_DUPLICATE:3", "O:ZONE_OVERLAP_DUPLICATE:3"]);
      const o = zoneRule(results, "O");
      expect(o?.details?.partners).toEqual([expect.objectContaining({ item_id: "D", differs: ["dn"], plan: "enlarged" })]);
      expect(o?.reason).toContain("lu autrement (diamètre)");
      expect(o?.reason).toContain("la lecture du plan agrandi fait foi");
      expect(zoneRule(results, "D")?.details?.partners).toEqual([expect.objectContaining({ item_id: "O", differs: ["dn"], plan: "overview" })]);
    });

    // Independent review of the enlarged plans, written before their fix.
    it("never lets a line yield when its own result is « zones non recalées » (review)", () => {
      // O (1/100) could be one run with Z, on a page without anchors: O fails as unregistered. D, a copy of O read with
      // another DN on an enlarged plan, passed for O's to settle, and O's V for the registration let the 3 m through.
      const pages = [page("job-0#1", { order: 0, anchors: sheet(0, 0, { titleBlock: 10 }), denominator: 100 }),
        page("job-1#1", { order: 10_000, zone: "Z2", anchors: sheet(-40, 0, { titleBlock: 10 }), denominator: 50 }),
        page("job-2#1", { order: 20_000, zone: "Z3", anchors: null, denominator: 100 })];
      const at = (id: string, slot: number, x0: number, x1: number, dn = "DN 22") => line(id, { job_id: `job-${slot}`, page_key: `job-${slot}#1`,
        quantity: x1 - x0, inputs: inputs({ dn, model_quantity: x1 - x0 }),
        geometry: { segments_m: [[x0 - 40 * slot, 1, x1 - 40 * slot, 1]], polygon_m: null, length_m: x1 - x0, area_m2: null } });
      const { results } = evaluateTakeoffRules({ pages, lines: [at("O", 0, 2, 9), at("D", 1, 0, 5, "DN 28"), at("Z", 2, 0, 4)] });
      expect(zoneRule(results, "O")?.code).toBe("ZONE_OVERLAP_UNREGISTERED");
      expect(zoneRule(results, "D")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 3 } });
      expect(plans(results, "D")).toEqual(["O:-:false"]);
    });

    it("keeps the detail failed when a V given in a group is left alone with a yielding line (review)", () => {
      // O (1/100) 0–10 m, D (1/50) 0–5 m, X (1/100) 6–10 m: a group of three. O accepted (V), then X excluded: O
      // yields, with a failure it already had, so its V stays. D still fails with O: 15 m are counted for 10 m drawn.
      const run = (excluded: boolean): Spec[] => [{ id: "O", segments: [[0, 1, 10, 1]], quantity: 10 }, { id: "D", segments: [[0, 1, 5, 1]], quantity: 5 },
        { id: "X", segments: [[6, 1, 10, 1]], quantity: 4, excluded }];
      expect(inEveryOrder(run(false), [100, 50, 100]))
        .toEqual(["O:ZONE_OVERLAP_DUPLICATE:9:3 lignes", "D:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "X:ZONE_OVERLAP_DUPLICATE:4:3 lignes"]);
      expect(inEveryOrder(run(true), [100, 50, 100]).slice(0, 2)).toEqual(["O:ZONE_OVERLAP_DUPLICATE:5", "D:ZONE_OVERLAP_DUPLICATE:5"]);
    });
  });

  it("never settles a chain of four pages by corrections (Codex round 4), only once the lines entirely duplicated are excluded", () => {
    // A = X, B = X + Y, C = Y + Z, D = Z: three separate 5 m stretches each drawn twice.
    const [X, Y, Z]: Seg[] = [[0, 1, 5, 1], [10, 1, 15, 1], [20, 1, 25, 1]];
    const four = (quantities: number[], excluded = [false, false, false, false]): Spec[] => [[X], [X, Y], [Y, Z], [Z]]
      .map((segments, index) => ({ id: `q${index}`, segments, quantity: quantities[index], excluded: excluded[index] }));
    // A and B cleared (15 m removed, Z still counted twice), one copy of each stretch removed (right), nothing removed.
    for (const quantities of [[0, 0, 10, 5], [0, 5, 5, 5], [5, 10, 10, 5]]) {
      expect(inEveryOrder(four(quantities)), String(quantities)).toEqual(["q0:ZONE_OVERLAP_DUPLICATE:5:4 lignes",
        "q1:ZONE_OVERLAP_DUPLICATE:10:4 lignes", "q2:ZONE_OVERLAP_DUPLICATE:10:4 lignes", "q3:ZONE_OVERLAP_DUPLICATE:5:4 lignes"]);
    }
    // A inside B and D inside C excluded: B and C are a pair over Y, settled by C's 5 m reduction.
    const ends = [true, false, false, true];
    expect(inEveryOrder(four([5, 10, 10, 5], ends))).toEqual(["q0:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "q1:ZONE_OVERLAP_DUPLICATE:5",
      "q2:ZONE_OVERLAP_DUPLICATE:5", "q3:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
    expect(inEveryOrder(four([5, 10, 5, 5], ends))).toEqual(["q0:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "q1:ZONE_OVERLAP_RESOLVED:-",
      "q2:ZONE_OVERLAP_RESOLVED:-", "q3:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
  });

  it("never settles a general plan over two zones by corrections, in any page order, only once it is excluded", () => {
    // 1/100: Z1 draws 0–5.12 m, Z2 4.88–10 m (a 24 cm touch at the limit, no pair); the general plan G draws 0–10 m.
    const run = (g: number, z1: number, z2: number, excluded = false): Spec[] => [
      { id: "G", segments: [[0, 1, 10, 1]], quantity: g, excluded },
      { id: "Z1", segments: [[0, 1, 5.12, 1]], quantity: z1 },
      { id: "Z2", segments: [[4.88, 1, 10, 1]], quantity: z2 },
    ];
    // G cleared (right), Z1 cleared with Z2 kept at 0.45 m (wrong), nothing removed: a group of three is settled by none.
    for (const [g, z1, z2] of [[0, 5.12, 5.12], [10, 0, 0.45], [10, 5.12, 5.12]]) {
      expect(inEveryOrder(run(g, z1, z2), 100), `${g} ${z1} ${z2}`)
        .toEqual(["G:ZONE_OVERLAP_DUPLICATE:10:3 lignes", "Z1:ZONE_OVERLAP_DUPLICATE:5.12:3 lignes", "Z2:ZONE_OVERLAP_DUPLICATE:5.12:3 lignes"]);
    }
    // G lies entirely under Z1 and Z2: excluded, the zones only touch, nothing is counted twice.
    expect(inEveryOrder(run(10, 5.12, 5.12, true), 100))
      .toEqual(["G:ZONE_OVERLAP_DUPLICATE:10:3 lignes", "Z1:ZONE_OVERLAP_NONE:-", "Z2:ZONE_OVERLAP_NONE:-"]);
  });

  it("never settles three lines 4.5 cm apart by corrections, applied or not, only once the middle one is excluded", () => {
    // A at y = 1, B at 1.045, C at 1.09: B is within 5 cm of both, A and C (9 cm apart) are two pipes.
    const run = (b: number, frozen = false, excluded = false): Spec[] => [
      { id: "A", segments: [[0, 1, 5, 1]], quantity: 5, frozen },
      { id: "B", segments: [[0, 1.045, 5, 1.045]], quantity: b, excluded },
      { id: "C", segments: [[0, 1.09, 5, 1.09]], quantity: 5, frozen },
    ];
    for (const b of [5, 0]) {
      for (const frozen of [false, true]) {
        expect(inEveryOrder(run(b, frozen)), `${b} ${frozen}`)
          .toEqual(["A:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "B:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "C:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
      }
    }
    expect(inEveryOrder(run(5, false, true))).toEqual(["A:ZONE_OVERLAP_NONE:-", "B:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "C:ZONE_OVERLAP_NONE:-"]);
  });

  it("keeps a group failed when drawings drop out of a shared stretch (hub-drop, second adversarial round)", () => {
    // One 3 m run on three pages: on 0–1.5 m, A and C sit 2.8 cm above and 2.4 cm below B (5.2 cm apart, no pair there);
    // on 1.5–3 m all three coincide. A and C each reduced by 1.5 m, or A and B, was reported settled with 1.5 m counted twice.
    const run = (a: number, b: number, c: number): Spec[] => [
      { id: "A", segments: [[0, 1.028, 1.5, 1.028], [1.5, 1, 3, 1]], quantity: 3 - a },
      { id: "B", segments: [[0, 1, 3, 1]], quantity: 3 - b },
      { id: "C", segments: [[0, 0.976, 1.5, 0.976], [1.5, 1, 3, 1]], quantity: 3 - c },
    ];
    for (const [a, b, c] of [[1.5, 0, 1.5], [1.5, 1.5, 0], [3, 1.5, 0], [0, 0, 0]]) {
      expect(inEveryOrder(run(a, b, c)), `${a} ${b} ${c}`)
        .toEqual(["A:ZONE_OVERLAP_DUPLICATE:3:3 lignes", "B:ZONE_OVERLAP_DUPLICATE:3:3 lignes", "C:ZONE_OVERLAP_DUPLICATE:3:3 lignes"]);
    }
  });

  it("never lets applied lines settle the current line they draw over (copies of applied lines, second adversarial round)", () => {
    // One 5 m stretch drawn by F (y = 1) and G (1.045), both applied, and N (1.09, current): F–G and G–N are pairs, F and N
    // two pipes. With nothing reduced, N was reported settled: G, whose removal clears both pairs, was assumed to pay.
    const run = (f: number, g: number, n: number): Spec[] => [
      { id: "F", segments: [[0, 1, 5, 1]], quantity: 5 - f, frozen: true },
      { id: "G", segments: [[0, 1.045, 5, 1.045]], quantity: 5 - g, frozen: true },
      { id: "N", segments: [[0, 1.09, 5, 1.09]], quantity: 5 - n },
    ];
    for (const [f, g, n] of [[0, 0, 0], [5, 0, 0], [0, 0, 5]]) {
      expect(inEveryOrder(run(f, g, n))[2], `${f} ${g} ${n}`).toBe("N:ZONE_OVERLAP_DUPLICATE:5:3 lignes");
    }
  });

  it("keeps the current line failed while two applied lines count its stretch twice (residual of applied lines, second adversarial round)", () => {
    // F and G (applied, unreduced) and N (current) draw one 1 m stretch. N's copy removed was reported settled, though F
    // and G still count it twice, seen nowhere: N's reason names both.
    const run: Spec[] = [
      { id: "F", segments: [[0, 1, 1, 1]], quantity: 1, frozen: true },
      { id: "G", segments: [[0, 1, 1, 1]], quantity: 1, frozen: true },
      { id: "N", segments: [[0, 1, 1, 1]], quantity: 0 },
    ];
    expect(inEveryOrder(run)).toEqual(["F:ZONE_OVERLAP_DUPLICATE:1:3 lignes", "G:ZONE_OVERLAP_DUPLICATE:1:3 lignes", "N:ZONE_OVERLAP_DUPLICATE:1:3 lignes"]);
    const n = rule(onPages(run, [0, 1, 2]).results, "N", "zone_overlap");
    expect(n?.details?.partners?.map((partner) => [partner.item_id, partner.overlap_m, partner.resolved])).toEqual([["F", 1, false], ["G", 1, false]]);
    expect(n?.reason).toContain("1,00 m avec « EF Inox 316L DN 22 (F) » (Z1), 1,00 m avec « EF Inox 316L DN 22 (G) » (Z2)");
    expect(n?.reason).toContain("3 lignes");
  });

  it("keeps an applied general plan's current zone failed until it is excluded (pieces dropping out, second adversarial round)", () => {
    // G (1/100) draws three runs 0–60 m; Z1 (1/50) 0–30.06 m and Z2 (1/50) 29.94–60 m touch at the limit (no pair). G and
    // Z1 were applied, Z1 cleared; Z2 (current) lies inside G. Reduced by all but its 0.36 m of band pieces inside G, it
    // was reported settled with 0.36 m counted twice.
    const ys = [1, 4, 7];
    const run = (reduction: number, excluded = false): Spec[] => [
      { id: "G", segments: ys.map((y): Seg => [0, y, 60, y]), quantity: 180, frozen: true },
      { id: "Z1", segments: ys.map((y): Seg => [0, y, 30.06, y]), quantity: 0, frozen: true },
      { id: "Z2", segments: ys.map((y): Seg => [29.94, y, 60, y]), quantity: 90.18 - reduction, excluded },
    ];
    for (const reduction of [0, 89.82, 90.18]) {
      expect(inEveryOrder(run(reduction), [100, 50, 50])[2], String(reduction)).toBe("Z2:ZONE_OVERLAP_DUPLICATE:90.18:3 lignes");
    }
    // Excluded, Z2 blocks nothing; G and Z1, a pair, are settled by Z1's clearing.
    expect(inEveryOrder(run(0, true), [100, 50, 50]))
      .toEqual(["G:ZONE_OVERLAP_RESOLVED:-", "Z1:ZONE_OVERLAP_RESOLVED:-", "Z2:ZONE_OVERLAP_DUPLICATE:90.18:3 lignes"]);
  });

  it("measures a group of four dashed lines of 4 000 dashes each (the most centrelines a line persists)", () => {
    const dashes = Array.from({ length: 4000 }, (_, index): Seg => [index * 0.25, 1, index * 0.25 + 0.2, 1]);
    const { results } = onPages([0, 1, 2, 3].map((index) => ({ id: `L${index}`, segments: dashes, quantity: 800 })), [0, 1, 2, 3]);
    expect(codes(results, ["L0", "L1", "L2", "L3"])).toEqual(["L0", "L1", "L2", "L3"].map((id) => `${id}:ZONE_OVERLAP_DUPLICATE:800:4 lignes`));
  });

  it("settles a pair by its common length, the smaller of both directions, whichever page comes first", () => {
    // X runs straight where Y jogs 4 cm either side (two 20 cm pieces, not continuous from Y's side): common length 5 m.
    const X: Seg[] = [[0, 1, 0.4, 1], [10, 1, 15, 1]];
    const Y: Seg[] = [[0, 1.04, 0.2, 1.04], [0.2, 1.04, 0.2, 0.96], [0.2, 0.96, 0.4, 0.96], [10, 1, 15, 1]];
    expect(inEveryOrder([{ id: "X", segments: X, quantity: 0.4 }, { id: "Y", segments: Y, quantity: 5.48 }]))
      .toEqual(["X:ZONE_OVERLAP_RESOLVED:-", "Y:ZONE_OVERLAP_RESOLVED:-"]);
  });

  it("compares one pipe labelled « DN 100 » on a plan and « Ø 110 » on the other", () => {
    const castIron = (dn: number) => inputs({ network: "EU", material: "fonte", dn: `DN ${dn}` });
    const result = zones({ z1: { inputs: castIron(100) }, z2: { inputs: castIron(110) } });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
  });

  /** What a line's partners read differently: « - » for one reading (one run), the differences of a copy read otherwise (TI-684). */
  const readings = (results: Map<string, TakeoffRuleResult[]>, id: string) =>
    (rule(results, id, "zone_overlap")?.details?.partners ?? []).map((partner) => (partner.differs ?? []).join("+") || "-");

  // TI-684, written before the fix: stainless drainage was read through the pressure series here, unlike the DN rule.
  // Two sizes that are not one are no longer left uncompared (TI-684, D14): drawn at one place, they are copies whose
  // DN contradict each other, and the partner says so.
  it("compares one stainless drainage pipe labelled « DN 100 » and « Ø 110 » through NF EN 1124, never as one size with « Ø 108 »", () => {
    const stainless = (network: "EU" | "EF", dn: string) => inputs({ network, material: "inox", dn });
    const drainage = zones({ z1: { inputs: stainless("EU", "DN 100") }, z2: { inputs: stainless("EU", "Ø 110") } });
    expect(rule(drainage.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(rule(drainage.results, "z2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(readings(drainage.results, "z1")).toEqual(["-"]);
    const press = zones({ z1: { inputs: stainless("EU", "DN 100") }, z2: { inputs: stainless("EU", "Ø 108") } });
    expect(readings(press.results, "z1")).toEqual(["dn"]);
    // Outside drainage, stainless keeps its pressure series: Ø 108 is the DN 100 press-fit tube.
    const coldWater = zones({ z1: { inputs: stainless("EF", "DN 100") }, z2: { inputs: stainless("EF", "Ø 108") } });
    expect(rule(coldWater.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(readings(coldWater.results, "z1")).toEqual(["-"]);
    expect(readings(zones({ z1: { inputs: stainless("EF", "DN 100") }, z2: { inputs: stainless("EF", "Ø 110") } }).results, "z1")).toEqual(["dn"]);
  });

  // TI-684 pinning test, passing when written: a vector size is stored as « DN n » whatever the plan printed, so the
  // « Ø 110 » of the test above reaches the rule as « DN 110 ». Pins that stored form through NF EN 1124.
  it("compares the stored vector form of a stainless drainage pipe, « DN 100 » and « DN 110 », never as one size with « DN 108 »", () => {
    const stainless = (dn: number) => inputs({ source: "vector", network: "EU", material: "inox", dn: `DN ${dn}` });
    const drainage = zones({ z1: { inputs: stainless(100) }, z2: { inputs: stainless(110) } });
    expect(rule(drainage.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(rule(drainage.results, "z2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect([readings(drainage.results, "z1"), readings(drainage.results, "z2")]).toEqual([["-"], ["-"]]);
    const press = zones({ z1: { inputs: stainless(100) }, z2: { inputs: stainless(108) } });
    expect([readings(press.results, "z1"), readings(press.results, "z2")]).toEqual([["dn"], ["dn"]]);
  });

  it("never takes two insulations of different sizes for one run: at one place, their sizes contradict each other", () => {
    const insulation = (dn: number) => inputs({ kind: "insulation", material: "calorifuge", dn: `DN ${dn}` });
    const result = zones({ z1: { inputs: insulation(15) }, z2: { inputs: insulation(20) } });
    expect(readings(result.results, "z1")).toEqual(["dn"]);
    const same = zones({ z1: { inputs: insulation(20) }, z2: { inputs: insulation(20) } });
    expect(rule(same.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
    expect(readings(same.results, "z1")).toEqual(["-"]);
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
    // Z2's run lies 6 cm aside: another pipe, so that only the two lines of Z1's page share a place.
    const result = zones({ lines: [twin], z2: { geometry: { segments_m: [[-36, 1.06, -33, 1.06]], polygon_m: null, length_m: 3, area_m2: null } } });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(result.results, "z1b", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });

  it("spends no reduction on an excluded partner", () => {
    // z1 reduced by 1 m shares 1 m with z2 (excluded) and 1 m with z3 (included): its reduction settles z3.
    const z3 = line("z3", { job_id: "job-z3", page_key: "job-z3#1", geometry: { segments_m: [[-76, 1, -73, 1]], polygon_m: null, length_m: 3, area_m2: null },
      inputs: inputs({ model_quantity: 3 }), quantity: 3 });
    const result = zones({ z1: { quantity: 4, geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null } },
      z2: { is_excluded: true }, lines: [z3], pages: [page("job-z3#1", { order: 20_000, zone: "Z3", anchors: sheet(-80, 0, { titleBlock: 10 }), denominator: 50 })] });
    expect(rule(result.results, "z3", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
    // z2 is shown as it would stand if it came back: one of three lines, a group no correction settles.
    expect(rule(result.results, "z2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { group_size: 3 } });
  });

  // Another DN or network at the same place was ignored too, until TI-684: see the tests of copies read differently below.
  it("ignores an excluded partner, lines of one page and pages of two levels, whatever their readings", () => {
    expect(rule(zones({ z2: { is_excluded: true } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2: { is_excluded: true, inputs: inputs({ network: "ECS" }) } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2Level: "R+2", z2: { inputs: inputs({ dn: "DN 28" }) } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
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

  // TI-684 (D14, « trou connu »), written before the fix: the detection only paired lines of one network and one
  // size, so two copies of one run whose readings contradict each other (network, material or DN) were never
  // compared and the version counted the run twice without a word.
  const differs = (results: Map<string, TakeoffRuleResult[]>, id: string) =>
    (rule(results, id, "zone_overlap")?.details?.partners ?? []).map((partner) => `${partner.item_id}:${(partner.differs ?? []).join("+") || "-"}`);

  it("fails two copies of one run read with another DN, network or material, naming what differs (TI-684)", () => {
    const dn = zones({ z2: { designation: "EF Inox 316L DN 28", inputs: inputs({ dn: "DN 28", model_quantity: 3 }) } });
    expect(rule(dn.results, "z1", "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE", acceptable: true,
      details: { overlap_m: 1, partner_count: 1, partners: [{ item_id: "z2", zone: "Z2", overlap_m: 1, resolved: false, differs: ["dn"] }] } });
    expect(rule(dn.results, "z2", "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE",
      details: { overlap_m: 1, partners: [{ item_id: "z1", differs: ["dn"] }] } });
    // The reason says the readings contradict each other, and what to do in either case.
    expect(rule(dn.results, "z1", "zone_overlap")?.reason).toMatch(/lu autrement \(diamètre\)/);
    expect(rule(dn.results, "z1", "zone_overlap")?.reason).toMatch(/deux tuyaux distincts/);
    expect(differs(zones({ z2: { inputs: inputs({ network: "ECS", model_quantity: 3 }) } }).results, "z1")).toEqual(["z2:network"]);
    expect(differs(zones({ z2: { inputs: inputs({ material: "cuivre", model_quantity: 3 }) } }).results, "z1")).toEqual(["z2:material"]);
    expect(differs(zones({ z2: { inputs: inputs({ network: "EU", material: "pvc", dn: "DN 100", model_quantity: 3 }) } }).results, "z1"))
      .toEqual(["z2:network+material+dn"]);
    // A copy whose DN was not read contradicts the one that carries it.
    expect(differs(zones({ z2: { inputs: inputs({ dn: null, model_quantity: 3 }) } }).results, "z1")).toEqual(["z2:dn"]);
    // Two readings of one identity carry no difference.
    expect(differs(zones().results, "z1")).toEqual(["z2:-"]);
  });

  it("settles a contradicting pair like any pair: a reduction by the common length, or the exclusion of a copy (TI-684)", () => {
    const other = { inputs: inputs({ dn: "DN 28", model_quantity: 3 }) };
    expect(rule(zones({ z1: { quantity: 4 }, z2: other }).results, "z1", "zone_overlap")).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(zones({ z1: { quantity: 4 }, z2: other }).results, "z2", "zone_overlap")).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(zones({ z1: { quantity: 4.5 }, z2: other }).results, "z2", "zone_overlap")).toMatchObject({ status: "fail", details: { overlap_m: 0.5 } });
    const excluded = zones({ z2: { ...other, is_excluded: true } });
    expect(rule(excluded.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(excluded.results, "z2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { partners: [{ item_id: "z1", differs: ["dn"] }] } });
    // An applied copy is never asked to change: the reason leaves the correction to the current line.
    expect(rule(zones({ z2: { ...other, frozen: true } }).results, "z1", "zone_overlap")?.reason).toMatch(/job appliqué/);
  });

  it("never takes a pipe and its insulation, a touch or a pipe beyond the distance for contradicting copies (TI-684)", () => {
    const insulation = zones({ z2: { inputs: inputs({ kind: "insulation", material: "calorifuge", model_quantity: 3 }) } });
    expect(rule(insulation.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(insulation.results, "z2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    const geometry = (segments: Seg[]) => ({ segments_m: segments, polygon_m: null, length_m: 3, area_m2: null });
    const other = inputs({ network: "ECS", model_quantity: 3 });
    // 10 cm in common at the zone limit, then 6 cm aside: neither is a copy.
    expect(rule(zones({ z2: { inputs: other, geometry: geometry([[-35.1, 1, -32.1, 1]]) } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(rule(zones({ z2: { inputs: other, geometry: geometry([[-36, 1.06, -33, 1.06]]) } }).results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    // The band of a 1/200 drawing is the smallest copy there too.
    expect(rule(zones({ z2: { inputs: other, geometry: geometry([[-35.4, 1, -32.4, 1]]) }, denominator: 200 }).results, "z1", "zone_overlap"))
      .toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(differs(zones({ z2: { inputs: other, geometry: geometry([[-35.4, 1, -32.4, 1]]) } }).results, "z1")).toEqual(["z2:network"]);
  });

  it("keeps two pipes drawn 4 cm apart on both plans as two pairs, each settled by its own reduction (TI-684)", () => {
    // Cold and hot water side by side, both drawn on Z1 (0–5 m) and Z2 (4–7 m). Each run has its copy of the same
    // reading on the other plan: the neighbour 4 cm away is another pipe, never a contradicting copy, and the two
    // pairs stay isolated (a group of four lines could not be settled by a correction).
    const hot = (overrides: Partial<TakeoffRuleInputs> = {}) => inputs({ network: "ECS", ...overrides });
    const side = (z1: Partial<RuleLine> = {}, z2: Partial<RuleLine> = {}, ef2: Partial<RuleLine> = {}) => zones({ z2: ef2, lines: [
      line("h1", { designation: "ECS Inox 316L DN 22", inputs: hot(), geometry: { segments_m: [[0, 1.04, 5, 1.04]], polygon_m: null, length_m: 5, area_m2: null }, ...z1 }),
      line("h2", { job_id: "job-z2", page_key: "job-z2#1", designation: "ECS Inox 316L DN 22", quantity: 3, inputs: hot({ model_quantity: 3 }),
        geometry: { segments_m: [[-36, 1.04, -33, 1.04]], polygon_m: null, length_m: 3, area_m2: null }, ...z2 }),
    ] });
    const both = side();
    expect(differs(both.results, "z1")).toEqual(["z2:-"]);
    expect(differs(both.results, "h1")).toEqual(["h2:-"]);
    expect(rule(both.results, "z2", "zone_overlap")?.details?.group_size).toBeUndefined();
    const reduced = side({ quantity: 4 });
    expect(rule(reduced.results, "h1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
    expect(rule(reduced.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
    // A copy excluded to settle its pair still shows where its run is drawn: the neighbour stays another pipe.
    const excluded = side({}, {}, { is_excluded: true });
    expect(rule(excluded.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(differs(excluded.results, "h1")).toEqual(["h2:-"]);
  });

  it("leaves a run alone when the plan beside draws only its neighbour, which has its own copy (TI-684)", () => {
    // Z1 draws cold and hot water 4 cm apart, Z2 only hot water: the cold run is on one plan, counted once.
    const hot = (overrides: Partial<TakeoffRuleInputs> = {}) => inputs({ network: "ECS", ...overrides });
    const result = zones({ z2: { designation: "ECS Inox 316L DN 22", inputs: hot({ model_quantity: 3 }) }, lines: [
      line("h1", { designation: "ECS Inox 316L DN 22", inputs: hot(), geometry: { segments_m: [[0, 1.04, 5, 1.04]], polygon_m: null, length_m: 5, area_m2: null } }),
    ] });
    expect(rule(result.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
    expect(differs(result.results, "h1")).toEqual(["z2:-"]);
    expect(differs(result.results, "z2")).toEqual(["h1:-"]);
  });

  it("counts of a contradicting copy only what no copy of the same reading explains, in every page order (TI-684)", () => {
    // A 0–10 m ; on the other plan, B (same reading) 4–6 m and C (another DN) 4–9 m at the same place: 4–6 m is B's,
    // C contradicts A on 6–9 m only. Three lines joined by pairs: a group, each line excluded or accepted.
    const runs: Spec[] = [
      { id: "A", segments: [[0, 1, 10, 1]], quantity: 10 },
      { id: "B", segments: [[4, 1, 6, 1]], quantity: 2 },
      { id: "C", segments: [[4, 1, 9, 1]], quantity: 5, dn: "DN 28" },
    ];
    const pages = [page("job-0#1", { order: 0, anchors: sheet(0, 0, { titleBlock: 10 }), denominator: 50 }),
      page("job-1#1", { order: 10_000, zone: "Z2", anchors: sheet(-40, 0, { titleBlock: 10 }), denominator: 50 })];
    const build = (reverse: boolean) => {
      const lines = runs.map((spec, index) => line(spec.id, { job_id: index === 0 ? "job-0" : "job-1", page_key: index === 0 ? "job-0#1" : "job-1#1",
        quantity: spec.quantity, designation: `EF Inox 316L ${spec.dn ?? "DN 22"} (${spec.id})`, ...(spec.dn ? { inputs: inputs({ dn: spec.dn }) } : {}),
        geometry: { segments_m: spec.segments.map(([x0, y0, x1, y1]): Seg => [x0 - (index === 0 ? 0 : 40), y0, x1 - (index === 0 ? 0 : 40), y1]),
          polygon_m: null, length_m: spec.quantity, area_m2: null } }));
      return evaluateTakeoffRules({ pages: reverse ? [...pages].reverse().map((entry, index) => ({ ...entry, order: index })) : pages,
        lines: reverse ? lines.reverse() : lines });
    };
    for (const reverse of [false, true]) {
      const { results } = build(reverse);
      expect(codes(results, ["A", "B", "C"]), String(reverse)).toEqual(["A:ZONE_OVERLAP_DUPLICATE:5:3 lignes", "B:ZONE_OVERLAP_DUPLICATE:2:3 lignes",
        "C:ZONE_OVERLAP_DUPLICATE:3:3 lignes"]);
      expect(rule(results, "A", "zone_overlap")?.details?.partners?.map((partner) => `${partner.item_id}=${partner.overlap_m}:${(partner.differs ?? []).join("+") || "-"}`))
        .toEqual(["C=3:dn", "B=2:-"]);
      expect(rule(results, "A", "zone_overlap")?.reason).toMatch(/lu autrement \(diamètre\)/);
    }
  });

  it("gives contradicting copies the same outcome in every page order, pairs and groups (TI-684)", () => {
    // Three plans of one run, the middle one read with another DN: a group of three lines.
    expect(inEveryOrder([
      { id: "Z1", segments: [[0, 1, 6, 1]], quantity: 6 },
      { id: "Z2", segments: [[4, 1, 10, 1]], quantity: 6, dn: "DN 28" },
      { id: "Z3", segments: [[5, 1, 12, 1]], quantity: 7 },
    ])).toEqual(["Z1:ZONE_OVERLAP_DUPLICATE:2:3 lignes", "Z2:ZONE_OVERLAP_DUPLICATE:6:3 lignes", "Z3:ZONE_OVERLAP_DUPLICATE:5:3 lignes"]);
    expect(inEveryOrder([{ id: "Z1", segments: [[0, 1, 6, 1]], quantity: 6 }, { id: "Z2", segments: [[4, 1, 10, 1]], quantity: 4, dn: "DN 28" }]))
      .toEqual(["Z1:ZONE_OVERLAP_RESOLVED:-", "Z2:ZONE_OVERLAP_RESOLVED:-"]);
  });

  // Independent review of TI-684, written before their fix.
  it("keeps two dashed pipes 4 cm apart as two pairs when a plan sits a centimetre along the run (TI-684 review)", () => {
    // The registration leaves a residual under 2 cm: each dash kept a sliver its copy did not cover, and the slivers,
    // chained from dash to dash, made the neighbour a contradicting copy: a group of four no reduction settles.
    const dashes = (y: number, x: number, count: number) => Array.from({ length: count }, (_, index): Seg => [x + index * 0.25, y, x + index * 0.25 + 0.2, y]);
    const geometry = (segments: Seg[], sheetShift: number) => ({ segments_m: segments.map(([x0, y0, x1, y1]): Seg => [x0 + sheetShift, y0, x1 + sheetShift, y1]),
      polygon_m: null, length_m: segments.length * 0.2, area_m2: null });
    for (const [shift, count] of [[0, 60], [0.01, 60], [0.02, 20], [0.005, 80]]) {
      const { results } = evaluateTakeoffRules({
        pages: [page("job-0#1", { order: 0, anchors: sheet(0, 0, { titleBlock: 10 }), denominator: 50 }),
          page("job-1#1", { order: 10_000, zone: "Z2", anchors: sheet(-40, 0, { titleBlock: 10 }), denominator: 50 })],
        lines: [
          line("a1", { job_id: "job-0", page_key: "job-0#1", geometry: geometry(dashes(1, 0, count), 0) }),
          line("b1", { job_id: "job-0", page_key: "job-0#1", inputs: inputs({ dn: "DN 28" }), geometry: geometry(dashes(1.04, 0.05, count), 0) }),
          line("a2", { job_id: "job-1", page_key: "job-1#1", geometry: geometry(dashes(1, shift, count), -40) }),
          line("b2", { job_id: "job-1", page_key: "job-1#1", inputs: inputs({ dn: "DN 28" }), geometry: geometry(dashes(1.04, 0.05 + shift, count), -40) }),
        ],
      });
      expect([differs(results, "a1"), differs(results, "b1"), differs(results, "a2"), differs(results, "b2")], `${shift} m`)
        .toEqual([["a2:-"], ["b2:-"], ["a1:-"], ["b1:-"]]);
    }
    // A run drawn as short chords with no copy of its reading keeps every chord: only slivers beside a copy are dropped.
    const chords = Array.from({ length: 40 }, (_, index): Seg => [index * 0.03, 1, (index + 1) * 0.03, 1]);
    const curved = evaluateTakeoffRules({
      pages: [page("job-0#1", { order: 0, anchors: sheet(0, 0, { titleBlock: 10 }), denominator: 50 }),
        page("job-1#1", { order: 10_000, zone: "Z2", anchors: sheet(-40, 0, { titleBlock: 10 }), denominator: 50 })],
      lines: [line("c1", { job_id: "job-0", page_key: "job-0#1", quantity: 1.2, geometry: { ...geometry(chords, 0), length_m: 1.2 } }),
        line("c2", { job_id: "job-1", page_key: "job-1#1", quantity: 1.2, inputs: inputs({ dn: "DN 28" }), geometry: { ...geometry(chords, -40), length_m: 1.2 } })],
    });
    expect(differs(curved.results, "c1")).toEqual(["c2:dn"]);
    expect(rule(curved.results, "c1", "zone_overlap")?.details?.overlap_m).toBe(1.2);
  });

  it("never names the diameter when two notations print one size on two networks (TI-684 review)", () => {
    const castIron = (network: "EU" | "EP", dn: string) => inputs({ network, material: "fonte", dn, model_quantity: 3 });
    expect(differs(zones({ z1: { inputs: castIron("EU", "DN 100") }, z2: { inputs: castIron("EP", "Ø 110") } }).results, "z1")).toEqual(["z2:network"]);
    expect(differs(zones({ z1: { inputs: castIron("EU", "DN 100") }, z2: { inputs: castIron("EP", "DN 125") } }).results, "z1")).toEqual(["z2:network+dn"]);
  });

  it("gives mixed readings one outcome in every order, symmetric pairs, and leaves the pairs of one reading as they were (TI-684 review)", () => {
    // Seeded scenes on two or three plans: runs, dashes and corners 0 to 12 cm apart, read « DN 22 » or « DN 28 », a tenth excluded.
    let state = 684;
    const next = () => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state / 2 ** 32; };
    const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
    type Scene = Array<{ id: string; slot: number; segments: Seg[]; dn: string; excluded: boolean }>;
    const runs = (slot: number, prefix: string): Scene => Array.from({ length: int(1, 3) }, (_, index) => {
      const segments: Seg[] = [];
      const y = 1 + int(0, 6) * 0.02;
      let x = int(0, 300) / 100;
      for (let piece = int(1, 4); piece > 0; piece -= 1) {
        const kind = next();
        if (kind < 0.25) for (let dash = int(2, 12); dash > 0; dash -= 1) { segments.push([x, y, x + 0.2, y]); x += 0.25; }
        else if (kind < 0.35) segments.push([x, y, x, y + int(10, 200) / 100]);
        else { const length = int(5, 300) / 100; segments.push(next() < 0.3 ? [x + length, y, x, y] : [x, y, x + length, y]); x += length + (next() < 0.5 ? 0 : int(1, 60) / 100); }
      }
      return { id: `${prefix}${index}`, slot, segments, dn: next() < 0.5 ? "DN 22" : "DN 28", excluded: next() < 0.1 };
    });
    const evaluate = (scene: Scene, order: number[], reverse: boolean) => {
      const slots = [...new Set(scene.map((entry) => entry.slot))].sort();
      const pages = slots.map((slot) => page(`job-${slot}#1`, { order: order[slot] * 10_000, zone: `Z${slot + 1}`, denominator: 50, anchors: sheet(-40 * slot, 0, { titleBlock: 10 }) }));
      const lines = scene.map((entry) => {
        const length = entry.segments.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0);
        return line(entry.id, { job_id: `job-${entry.slot}`, page_key: `job-${entry.slot}#1`, quantity: length, is_excluded: entry.excluded,
          inputs: inputs({ dn: entry.dn, model_quantity: length }), geometry: { polygon_m: null, length_m: length, area_m2: null,
            segments_m: entry.segments.map(([x0, y0, x1, y1]): Seg => [x0 - 40 * entry.slot, y0, x1 - 40 * entry.slot, y1]) } });
      });
      return evaluateTakeoffRules({ pages: reverse ? pages.reverse() : pages, lines: reverse ? lines.reverse() : lines }).results;
    };
    const partnersOf = (results: Map<string, TakeoffRuleResult[]>, id: string) => rule(results, id, "zone_overlap")?.details?.partners ?? [];
    const show = (results: Map<string, TakeoffRuleResult[]>, scene: Scene) => scene.map(({ id }) => {
      const entry = rule(results, id, "zone_overlap");
      return `${id}:${entry?.code}:${entry?.details?.overlap_m ?? "-"}:${entry?.details?.group_size ?? "-"}:${partnersOf(results, id).map((partner) =>
        `${partner.item_id}=${partner.overlap_m}${partner.differs ? `≠${partner.differs.join("+")}` : ""}`).join(",")}`;
    }).join(" | ");
    const wrong: string[] = [];
    let contradicting = 0;
    for (let round = 0; round < 300; round += 1) {
      const three = next() < 0.3;
      const scene = [...runs(0, "a"), ...runs(1, "b"), ...(three ? runs(2, "c") : [])];
      const results = evaluate(scene, [0, 1, 2], false);
      const outcome = show(results, scene);
      for (const order of three ? [[2, 1, 0], [1, 2, 0]] : [[1, 0, 2]]) {
        for (const reverse of [false, true]) if (show(evaluate(scene, order, reverse), scene) !== outcome) wrong.push(`#${round} order ${order} ${reverse}: ${outcome}`);
      }
      const byId = new Map(scene.map((entry) => [entry.id, entry]));
      for (const entry of scene) {
        for (const partner of partnersOf(results, entry.id)) {
          if (partner.differs) contradicting += 1;
          // « differs » exactly on two readings; a pair reads the same length from both lines.
          if (Boolean(partner.differs) !== (entry.dn !== byId.get(partner.item_id)?.dn)) wrong.push(`#${round} differs ${entry.id} ${partner.item_id}`);
          const back = partnersOf(results, partner.item_id).find((other) => other.item_id === entry.id);
          if (!entry.excluded && back?.overlap_m !== partner.overlap_m) wrong.push(`#${round} ${entry.id}→${partner.item_id} ${partner.overlap_m} ≠ ${back?.overlap_m}`);
        }
      }
      // The pairs of one reading are those the lines of that reading have alone.
      for (const reading of ["DN 22", "DN 28"]) {
        const only = scene.filter((entry) => entry.dn === reading);
        if (only.length === 0 || only.length === scene.length) continue;
        const alone = evaluate(only, [0, 1, 2], false);
        for (const { id } of only) {
          const pairs = (list: ReturnType<typeof partnersOf>) => list.filter((partner) => !partner.differs).map((partner) => `${partner.item_id}=${partner.overlap_m}`).sort().join(",");
          if (rule(alone, id, "zone_overlap") && pairs(partnersOf(alone, id)) !== pairs(partnersOf(results, id))) wrong.push(`#${round} ${id}: ${pairs(partnersOf(alone, id))} alone, ${pairs(partnersOf(results, id))} mixed`);
        }
      }
    }
    expect(wrong.slice(0, 3)).toEqual([]);
    expect(contradicting).toBeGreaterThanOrEqual(100);
  });

  it("compares 600 lines of two plans, every one of another reading, without measuring pairs far apart (TI-684)", () => {
    // 300 runs a plan, 40 cm apart, each of 400 dashes: only the runs drawn at one place are measured.
    const dashes = (y: number, shift: number) => Array.from({ length: 400 }, (_, index): Seg => [index * 0.25 + shift, y, index * 0.25 + 0.2 + shift, y]);
    const pages = [page("job-0#1", { order: 0, anchors: sheet(0, 0, { titleBlock: 10 }), denominator: 50 }),
      page("job-1#1", { order: 10_000, zone: "Z2", anchors: sheet(-40, 0, { titleBlock: 10 }), denominator: 50 })];
    const lines = [0, 1].flatMap((slot) => Array.from({ length: 300 }, (_, index) => line(`p${slot}-${index}`, { job_id: `job-${slot}`,
      page_key: `job-${slot}#1`, quantity: 80, inputs: inputs({ dn: slot === 0 ? "DN 22" : "DN 28", model_quantity: 80 }),
      geometry: { segments_m: dashes(1 + index * 0.4 + slot * 0.2, -40 * slot), polygon_m: null, length_m: 80, area_m2: null } })));
    const { results } = evaluateTakeoffRules({ pages, lines });
    expect(lines.every((entry) => rule(results, entry.id, "zone_overlap")?.code === "ZONE_OVERLAP_NONE")).toBe(true);
  });
});

describe("duplicates whatever the frame: registration cycles, float noise and rounding", () => {
  type Seg = [number, number, number, number];
  const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
  /**
   * Lines on pages of one level, each page at a sheet shift (sx, sy) of its slot; segments given in the building's frame
   * are persisted in page metres on the 0.1 mm grid, as the vector reading stores them.
   */
  function scene(pages: Array<{ slot: number; order: number; denominator?: number | null; shift?: [number, number] }>,
    lines: Array<{ id: string; slot: number; segments: Seg[]; quantity?: number; dn?: string }>, reverse = false) {
    const shiftOf = (slot: number) => pages.find((entry) => entry.slot === slot)?.shift ?? [-40 * slot, 0];
    const built = {
      pages: pages.map(({ slot, order, denominator }) => page(`job-${slot}#1`, { order, zone: `Z${slot + 1}`, denominator: denominator ?? null,
        anchors: sheet(shiftOf(slot)[0], shiftOf(slot)[1], { titleBlock: 10 }) })),
      lines: lines.map(({ id, slot, segments, quantity, dn }) => {
        const [sx, sy] = shiftOf(slot);
        const length = segments.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0);
        return line(id, { job_id: `job-${slot}`, page_key: `job-${slot}#1`, quantity: quantity ?? Math.round(length * 1000) / 1000,
          ...(dn ? { inputs: inputs({ dn }) } : {}),
          geometry: { segments_m: segments.map(([x0, y0, x1, y1]): Seg => [round4(x0 + sx), round4(y0 + sy), round4(x1 + sx), round4(y1 + sy)]),
            polygon_m: null, length_m: Math.round(length * 1000) / 1000, area_m2: null } });
      }),
    };
    return evaluateTakeoffRules(reverse ? { pages: built.pages.reverse(), lines: built.lines.reverse() } : built);
  }
  const outcome = (results: Map<string, TakeoffRuleResult[]>, ids: string[]) => ids.map((id) => {
    const entry = rule(results, id, "zone_overlap");
    return `${id}:${entry?.code}:${entry?.details?.overlap_m ?? "-"}:${(entry?.details?.partners ?? []).map((partner) => `${partner.item_id}=${partner.overlap_m}`).join(",")}${entry?.details?.group_size ? `:${entry.details.group_size}` : ""}`;
  });

  it("compares two pages through their own registration, never through a third page whose registrations do not close", () => {
    // A, B and C register pairwise on three parts of one building (A–B on part 1, A–C on part 2, B–C on part 3); B's copy of
    // part 1 is drawn 2.5 cm off, so each registration is exact but the cycle does not close. A run of A and its copy on C,
    // 3 cm apart: with B first, C was brought into A's frame through B, 5.5 cm away, and the duplicate passed unseen.
    const region = (x0: number) => Array.from({ length: 22 }, (_, index): Seg => [x0, index * 0.7, x0 + 3 + (index % 5), index * 0.7]);
    const texts = (names: string[], x0: number) => names.map((name, index): [string, number, number] => [name, x0 + 1 + index * 1.1, 3.3 + index * 2.1]);
    const anchors = (sx: number, sets: Array<{ lines: Seg[]; dy?: number }>, labels: Array<[string, number, number]>): PageAnchors => ({ version: 1,
      lines: sets.flatMap(({ lines, dy = 0 }) => lines.map(([a, b, c, d]): Seg => [a + sx, b + dy, c + sx, d + dy])),
      texts: labels.map(([text, x, y]) => [text, x + sx, y]) });
    const sheets = [
      anchors(0, [{ lines: region(0) }, { lines: region(20) }], [...texts(["T1", "T2", "T3"], 0), ...texts(["T4", "T5", "T6"], 20)]),
      anchors(-100, [{ lines: region(0), dy: 0.025 }, { lines: region(40) }], [...texts(["T1", "T2", "T3"], 0), ...texts(["T7", "T8", "T9"], 40)]),
      anchors(-200, [{ lines: region(20) }, { lines: region(40) }], [...texts(["T4", "T5", "T6"], 20), ...texts(["T7", "T8", "T9"], 40)]),
    ];
    const geometry = (segments: Seg[], length: number) => ({ segments_m: segments, polygon_m: null, length_m: length, area_m2: null });
    for (const orders of permutations([0, 1, 2])) {
      const { results } = evaluateTakeoffRules({
        pages: [0, 1, 2].map((slot) => page(`job-${slot}#1`, { order: orders[slot], zone: `Z${slot + 1}`, anchors: sheets[slot], denominator: 50 })),
        lines: [
          line("a", { job_id: "job-0", page_key: "job-0#1", quantity: 4, geometry: geometry([[5, 30, 9, 30]], 4) }),
          line("b", { job_id: "job-1", page_key: "job-1#1", quantity: 2, geometry: geometry([[-50, 40, -48, 40]], 2) }),
          line("c", { job_id: "job-2", page_key: "job-2#1", quantity: 4, geometry: geometry([[-194, 29.97, -190, 29.97]], 4) }),
        ],
      });
      expect(outcome(results, ["a", "b", "c"]), String(orders)).toEqual(["a:ZONE_OVERLAP_DUPLICATE:3:c=3", "b:ZONE_OVERLAP_NONE:-:", "c:ZONE_OVERLAP_DUPLICATE:3:a=3"]);
    }
  });

  it("never turns a touch into a sliver of float noise that chains two short stretches, whichever page is the frame", () => {
    // Dashes of A (1/50) and B (no scale) meet end to start at 1.49 m: 0.27 m in common, then 0.09 m 0.33 m further,
    // each under the 0.30 m minimum. With A's page first, a 7e-15 m sliver at 1.49 m chained them into a duplicate.
    const A: Seg[] = [[0.39, 1, 0.59, 1], [0.64, 1, 0.84, 1], [0.89, 1, 1.09, 1], [1.14, 1, 1.21, 1], [1.49, 1, 1.69, 1], [1.74, 1, 1.91, 1]];
    const B: Seg[] = [[0.79, 1, 0.99, 1], [1.04, 1, 1.24, 1], [1.29, 1, 1.49, 1], [1.54, 1, 1.61, 1], [1.89, 1, 2.09, 1], [2.14, 1, 2.31, 1]];
    for (const orders of [[0, 1], [1, 0]]) {
      const { results } = scene([{ slot: 1, order: orders[0], denominator: 50 }, { slot: 4, order: orders[1], denominator: null }],
        [{ id: "A", slot: 1, segments: A }, { id: "B", slot: 4, segments: B }]);
      expect(outcome(results, ["A", "B"]), String(orders)).toEqual(["A:ZONE_OVERLAP_NONE:-:", "B:ZONE_OVERLAP_NONE:-:"]);
    }
  });

  it("takes a run 5 cm from its copy as a duplicate, never one 5.1 cm away", () => {
    expect(rule(zones({ z2: { geometry: { segments_m: [[-36, 1.05, -33, 1.05]], polygon_m: null, length_m: 3, area_m2: null } } }).results, "z1", "zone_overlap"))
      .toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
    expect(rule(zones({ z2: { geometry: { segments_m: [[-36, 1.051, -33, 1.051]], polygon_m: null, length_m: 3, area_m2: null } } }).results, "z1", "zone_overlap"))
      .toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });

  it("keeps a pair whose stretch reaches the minimum, whatever its rounding to the millimetre (1/150)", () => {
    // Minimum at 1/150: 0.380417 m. A common stretch of 0.38045 m is a duplicate; its length reads 0.38 m once rounded.
    const pair = zones({ denominator: 150, z2: { geometry: { segments_m: [[4.61955 - 40, 1, -33, 1]], polygon_m: null, length_m: 2.38045, area_m2: null } } });
    expect(rule(pair.results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE" });
  });

  it("never mixes the coverage of two pairs whose line ids join alike (« a|b » with « c », « a » with « b|c »)", () => {
    const geometry = (segments: Seg[]) => ({ segments_m: segments, polygon_m: null, length_m: 3, area_m2: null });
    const { results } = evaluateTakeoffRules({
      pages: [page("job-0#1", { order: 0, anchors: sheet(0, 0, { titleBlock: 10 }), denominator: 50 }),
        page("job-1#1", { order: 1, zone: "Z2", anchors: sheet(-40, 0, { titleBlock: 10 }), denominator: 50 })],
      lines: [
        line("a|b", { job_id: "job-0", page_key: "job-0#1", quantity: 3, geometry: geometry([[20, 1, 23, 1]]) }),
        line("a", { job_id: "job-0", page_key: "job-0#1", quantity: 3, geometry: geometry([[0, 1, 3, 1]]) }),
        line("c", { job_id: "job-1", page_key: "job-1#1", quantity: 3, geometry: geometry([[-40, 5, -37, 5]]) }),
        line("b|c", { job_id: "job-1", page_key: "job-1#1", quantity: 3, geometry: geometry([[-40, 1, -37, 1]]) }),
      ],
    });
    expect(outcome(results, ["a", "b|c"])).toEqual(["a:ZONE_OVERLAP_DUPLICATE:3:b|c=3", "b|c:ZONE_OVERLAP_DUPLICATE:3:a=3"]);
  });

  it("gives the same results in every page order on the 0.1 mm grid of persisted drawings (pairs and groups, sheets shifted off the metre)", () => {
    // Seeded scenes: two or three pages shifted by any 0.1 mm, runs 0 to 6 cm apart (5 cm included), ends and lengths on
    // the 0.1 mm grid, quantities on the millimetre. Every page order and both list orders must give one outcome.
    let state = 2026;
    const next = () => { state = (state * 1_103_515_245 + 12_345) % 2_147_483_648; return state / 2_147_483_648; };
    const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
    const flips: string[] = [];
    for (let index = 0; index < 150; index += 1) {
      const count = int(2, 3);
      const pages = Array.from({ length: count }, (_, slot) => ({ slot, order: 0, denominator: [50, 100, 150, 200, null][int(0, 4)],
        shift: [-(37 + int(0, 99_999) / 10_000) * slot, (int(-5_000, 5_000) / 10_000) * slot] as [number, number] }));
      const lines = pages.flatMap(({ slot }) => Array.from({ length: int(1, 2) }, (_, k) => {
        const y = 1 + int(0, 6) / 100;
        const segments = Array.from({ length: int(1, 2) }, (): Seg => {
          const x0 = int(0, 60_000) / 10_000;
          return [x0, y, x0 + int(2_000, 40_000) / 10_000, y];
        });
        const length = segments.reduce((sum, [x0, , x1]) => sum + (x1 - x0), 0);
        return { id: `l${slot}${k}`, slot, segments, quantity: Math.max(0, Math.round((length - [0, 0, int(0, 3_000) / 1000][int(0, 2)]) * 1000) / 1000) };
      }));
      const ids = lines.map((entry) => entry.id);
      const seen = new Set<string>();
      for (const orders of permutations(pages.map((_, slot) => slot))) {
        for (const reverse of [false, true]) {
          seen.add(JSON.stringify(outcome(scene(pages.map((entry, slot) => ({ ...entry, order: orders[slot] })), lines, reverse).results, ids)));
        }
      }
      if (seen.size > 1) flips.push(`#${index}: ${[...seen].join(" ≠ ")}`);
    }
    expect(flips).toEqual([]);
  });
});

describe("isolated pairs of duplicates against an exact oracle", () => {
  /** A seeded generator (mulberry32): the same cases on every run. */
  function generator(seed: number) {
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
    return { next, int, pick: <T>(items: readonly T[]) => items[int(0, items.length - 1)] };
  }
  type Generator = ReturnType<typeof generator>;
  /** Runs along one axis in whole centimetres, [start, end]. */
  type Run = [number, number];

  function union(runs: readonly Run[]): Run[] {
    const merged: Run[] = [];
    for (const [start, end] of [...runs].sort((left, right) => left[0] - right[0])) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }

  /** One to three runs, near those of `around` when given; drawn whole or as 20 cm dashes 5 cm apart. */
  function runsOf(random: Generator, around: readonly Run[] = []): Run[] {
    const runs = Array.from({ length: random.int(1, 3) }, (): Run => {
      const start = around.length > 0 && random.next() < 0.75 ? random.pick(around)[random.int(0, 1)] + random.int(-80, 80) : random.int(0, 1500);
      return [start, start + random.int(5, 700)];
    });
    const merged = union(runs);
    if (random.next() >= 0.25) return merged;
    return merged.flatMap(([start, end]) => {
      const dashes: Run[] = [];
      for (let from = start; from < end; from += 25) dashes.push([from, Math.min(end, from + 20)]);
      return dashes;
    });
  }

  /**
   * The oracle, in whole centimetres, written from the rule (docs « Doublon »), never from the code: where both lines
   * draw, pieces less than the minimum apart along the run make one stretch, kept when it reaches the minimum.
   */
  function common(a: readonly Run[], b: readonly Run[], minimum: number) {
    const pieces: Run[] = [];
    for (const [a0, a1] of union(a)) for (const [b0, b1] of union(b)) if (Math.min(a1, b1) > Math.max(a0, b0)) pieces.push([Math.max(a0, b0), Math.min(a1, b1)]);
    pieces.sort((left, right) => left[0] - right[0]);
    let total = 0, chain = 0, end = -Infinity;
    for (const [start, stop] of pieces) {
      if (start - end > minimum + 1e-6) {
        if (chain >= minimum - 1e-6) total += chain;
        chain = 0;
      }
      chain += stop - start;
      end = stop;
    }
    return chain >= minimum - 1e-6 ? total + chain : total;
  }

  /** Minimum common length in centimetres: 30 cm, or a band of the coarser drawing (7 pt) and a centimetre. */
  const minimumOf = (denominators: Array<number | null>) =>
    Math.max(30, (BAND_MAX_PT * MM_PER_POINT * Math.max(0, ...denominators.filter((value): value is number => value !== null))) / 10 + 1);

  it("gives the oracle's outcome on random pairs: geometry, scales, applied, excluded, reductions, page and list orders", () => {
    const random = generator(664);
    const mismatches: string[] = [];
    const seen = { none: 0, settled: 0, open: 0, coarse: 0, frozen: 0, excluded: 0, dashed: 0, tolerance: 0, contradicting: 0, enlarged: 0 };
    for (let index = 0; index < 2000; index += 1) {
      const a = runsOf(random);
      const b = runsOf(random, a);
      const denominators = [random.pick([50, 100, 200, null]), random.pick([50, 100, 200, null])];
      const minimum = minimumOf(denominators);
      const shared = common(a, b, minimum); // centimetres
      const commonMm = shared * 10;
      const lengthMm = (runs: Run[]) => runs.reduce((sum, [start, end]) => sum + (end - start), 0) * 10;
      // Reductions in millimetres: none, the common length or about it on one or both lines, any, or a raised quantity.
      const split = random.int(0, commonMm);
      const short = random.pick([0, 5, 10, 15, 20, 25]);
      const [ra, rb] = random.pick([
        () => [0, 0], () => [commonMm, 0], () => [0, commonMm], () => [split, commonMm - split],
        () => [Math.max(0, split - short), commonMm - split], () => [commonMm - short, 0], () => [0, Math.max(0, commonMm - short)],
        () => [random.int(0, commonMm + 500), random.int(0, commonMm + 500)], () => [-random.int(1, 500), random.int(0, commonMm)],
      ])().map((value, side) => Math.min(value, lengthMm(side === 0 ? a : b)));
      const frozen = [random.next() < 0.3, random.next() < 0.3];
      const excluded = [random.next() < 0.1, random.next() < 0.1];
      const offset = random.int(-4, 4) / 100;
      const noise = random.next() < 0.3;
      // b read with another DN (TI-684): a copy of a all the same, with the pair's outcome, and it says what differs.
      const contradicting = random.next() < 0.3;
      const specs = [
        { id: "a", runs: a, y: 1, reduction: ra, frozen: frozen[0], excluded: excluded[0], dn: "DN 22", kind: "network" as const },
        { id: "b", runs: b, y: 1 + offset, reduction: rb, frozen: frozen[1], excluded: excluded[1], dn: contradicting ? "DN 28" : "DN 22", kind: "network" as const },
        // An insulation drawn over b on a third page: never a partner of a pipe, whatever it shares.
        ...(noise ? [{ id: "n", runs: b, y: 1, reduction: 0, frozen: false, excluded: false, dn: "DN 22", kind: "insulation" as const }] : []),
      ];
      const order = random.pick(permutations(specs.map((_, slot) => slot)));
      const pages = specs.map((_, slot) => page(`job-${slot}#1`, { order: order[slot] * 10_000, zone: `Z${slot + 1}`,
        anchors: sheet(-40 * slot, 0, { titleBlock: 10 }), denominator: slot < 2 ? denominators[slot] : 200 }));
      const lines = specs.map((spec, slot) => {
        const length = lengthMm(spec.runs) / 1000;
        return line(spec.id, { job_id: `job-${slot}`, page_key: `job-${slot}#1`, quantity: length - spec.reduction / 1000, frozen: spec.frozen,
          is_excluded: spec.excluded, inputs: inputs({ dn: spec.dn, kind: spec.kind, model_quantity: length }),
          geometry: { segments_m: spec.runs.map(([start, end]): [number, number, number, number] => [start / 100 - 40 * slot, spec.y, end / 100 - 40 * slot, spec.y]),
            polygon_m: null, length_m: length, area_m2: null } });
      });
      if (random.next() < 0.5) { pages.reverse(); lines.reverse(); }
      const { results } = evaluateTakeoffRules({ pages, lines });

      // Expected: a pair when they share at least the minimum and one of them is included; each line then settled when
      // the reductions, each up to the common length, remove it within a centimetre per line reduced.
      const paired = shared > 0 && !(excluded[0] && excluded[1]);
      const useful = (reduction: number) => Math.min(commonMm, Math.max(0, reduction));
      const deficit = Math.max(0, commonMm - useful(ra) - useful(rb));
      const settled = deficit <= 10 * Math.max(1, [ra, rb].filter((reduction) => reduction > 0).length);
      // Enlarged plans (TI-684): the line of the coarser page yields when the other page is at least 1.5 times finer and
      // the line is not applied. Two lines alone settle as any pair; each names what the other's plan is to its own.
      const finer = (side: number) => denominators[side] !== null && denominators[1 - side] !== null
        && (denominators[1 - side] as number) >= (denominators[side] as number) * 1.5;
      const yielding = [0, 1].find((side) => finer(1 - side) && !frozen[side]);
      const expected = (side: number) => {
        const plan = yielding === side ? "→enlarged" : yielding === 1 - side ? "→overview" : "";
        const other = `${side === 0 ? "b" : "a"}=${commonMm / 1000}${contradicting ? "≠dn" : ""}${plan}`;
        if (!paired || excluded[1 - side]) return "ZONE_OVERLAP_NONE";
        return settled ? `ZONE_OVERLAP_RESOLVED [${other}]` : `ZONE_OVERLAP_DUPLICATE ${deficit / 1000} [${other}]`;
      };
      const actual = (id: string) => {
        const entry = rule(results, id, "zone_overlap");
        const details = entry?.details;
        return `${entry?.code}${details?.overlap_m !== undefined ? ` ${details.overlap_m}` : ""}${details?.partners ? ` [${details.partners.map((partner) => `${partner.item_id}=${partner.overlap_m}${partner.differs ? `≠${partner.differs.join("+")}` : ""}${partner.plan ? `→${partner.plan}` : ""}`).join(",")}]` : ""}${details?.group_size ? ` ${details.group_size} lignes` : ""}`;
      };
      for (const [side, id] of [[0, "a"], [1, "b"]] as const) {
        if (actual(id) !== expected(side)) mismatches.push(`#${index} ${id}: ${actual(id)} ≠ ${expected(side)} (a ${JSON.stringify(a)} b ${JSON.stringify(b)} 1/${denominators.join(", 1/")} r ${ra}, ${rb} frozen ${frozen} excluded ${excluded})`);
      }
      if (noise && actual("n") !== "ZONE_OVERLAP_NONE") mismatches.push(`#${index} n: ${actual("n")}`);
      if (!paired) seen.none += 1;
      else if (settled) seen.settled += 1;
      else seen.open += 1;
      if (paired && minimum > 30) seen.coarse += 1;
      if (paired && frozen.some(Boolean)) seen.frozen += 1;
      if (paired && excluded.some(Boolean)) seen.excluded += 1;
      if (paired && [a, b].some((runs) => runs.length > 3)) seen.dashed += 1;
      if (paired && deficit > 0 && settled) seen.tolerance += 1;
      if (paired && contradicting) seen.contradicting += 1;
      if (paired && yielding !== undefined) seen.enlarged += 1;
    }
    expect(mismatches).toEqual([]);
    // The cases cover every branch of the oracle.
    for (const [kind, count] of Object.entries(seen)) expect(count, kind).toBeGreaterThanOrEqual(10);
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

  it("compares the original net floor measurement at 1%, even after pricing with the printed quantity", () => {
    const { results } = evaluateTakeoffRules({ pages: [page("job-z1#1")], lines: [
      room("near", square(0, 0, 4), 16, 16.1, "Bureau sol net"), room("far", square(10, 0, 4), 16, 18.5, "Bureau sol net"),
      room("fixed", square(20, 0, 4), 16, 18.5, "Bureau sol net", 18.5),
    ] });
    expect(rule(results, "near", "area_printed")).toMatchObject({ status: "pass", code: "AREA_PRINTED_CONSISTENT" });
    expect(rule(results, "far", "area_printed")).toMatchObject({ status: "fail", code: "AREA_PRINTED_MISMATCH" });
    // TI-680: a protected price quantity cannot erase the independent measurement discrepancy.
    expect(rule(results, "fixed", "area_printed")).toMatchObject({ status: "fail", details: { measured_m2: 16 } });
  });

  // TI-686 D9: V on these failures now needs a coded reason; without a new version an earlier V would stay valid
  // without one. The printed area also carries the basis the price line expects, read by the acceptance (D17).
  it("versions the scale rule 2 and the printed-area rule 3, which carries the basis the price line expects", () => {
    const pages = [page("job-z1#1", { scale: { status: "unverified", reason: "dimension_mismatch" } }), page("job-z1#2")];
    const { results } = evaluateTakeoffRules({ pages, lines: [
      line("ml", { inputs: ruleInputsFromDesignation({ designation: "EF cuivre DN 22", unit: "ml", quantity: 5 }) }),
      room("floor", square(0, 0, 4), 16, 18.5, "Bureau sol net"),
      { ...room("heated", square(10, 0, 4), 16, 18.5, "Bureau sol net"), designation: "Plancher chauffant Bureau" },
      { ...room("pass", square(20, 0, 4), 16, 16.1, "Bureau sol net"), page_key: "job-z1#2" },
    ] });
    expect(rule(results, "ml", "scale_dimension")).toMatchObject({ status: "fail", code: "SCALE_DIMENSION_MISMATCH", version: 2 });
    expect(rule(results, "pass", "scale_dimension")).toMatchObject({ status: "pass", version: 2 });
    expect(rule(results, "floor", "area_printed")).toMatchObject({ status: "fail", version: 3,
      details: { printed_m2: 18.5, expected_basis: "net_floor" } });
    expect(rule(results, "pass", "area_printed")).toMatchObject({ status: "pass", version: 3, details: { expected_basis: "net_floor" } });
    // A heated floor has no basis of its own (quantity-policy.ts): the acceptance compares nothing.
    expect(rule(results, "heated", "area_printed")).toMatchObject({ status: "fail", version: 3, details: { cause: "basis_unknown" } });
    expect(rule(results, "heated", "area_printed")?.details).not.toHaveProperty("expected_basis");
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
