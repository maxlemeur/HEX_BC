import { describe, expect, it } from "vitest";

import { haveComparableQuantities } from "@/lib/takeoff/quantity-compatibility";
import { boundRuleResults } from "@/lib/takeoff/rules/contracts";
import { evaluateTakeoffRules, type RuleLine } from "@/lib/takeoff/rules/evaluate";
import { ruleFailureKeys } from "@/lib/takeoff/rules/failure-keys";
import { TAKEOFF_RULE_INPUTS_VERSION, ruleInputsFromDesignation, ruleInputsFromVector, sizeReadings } from "@/lib/takeoff/rules/inputs";
import {
  NETWORK_DIAMETER_TABLE_VERSION,
  checkNetworkDiameter,
  findNetworkDiameterEntries,
  resolveNetworkSize,
} from "@/lib/takeoff/rules/network-diameters";
import type { TakeoffRuleInputs } from "@/lib/takeoff/rules/types";

// The size key of a line (TI-683, decisions Q7 of 5 Nov. and D7 of 6 Nov.): material, outer diameter, wall and the
// text as printed; the nominal DN is derived from them, never the other way round. Ways the rules could betray it,
// written before the change. Codes and sizes are generic trade values, never a devis nor a client plan:
// - notation: a vector size is rebuilt « DN n » whatever the plan printed, then read either way, so that a stainless
//   drainage « Ø 100 » (no such tube in NF EN 1124) reads as the DN 100 tube; a designation « cuivre 20/22 » or
//   « Ø 110 » is rewritten « DN 22 » or « DN 110 »; a stored line of before the change (inputs v1) stops being read
//   either way and fails where it passed;
// - series by usage: PE and PP have one list for pressure and drainage, so a pressure-only size passes on a gravity
//   network (PE Ø 20 on EU, PP Ø 16 on EV), or the split takes a size away from a pressure network, from condensates
//   (pumped or gravity: both series) or from a line whose network was not read; the DN rule, the designation reader
//   and the DPGF identity read a size through different lists (PVC was restricted by the rule alone);
// - ambiguity: a « DN n » that names two tubes of the material (copper « DN 15 »: the Ø 15 printed by its outer
//   diameter, or the Ø 18 whose nominal DN is 15; pressure stainless « DN 100 »: Ø 108 press-fit or Ø 114,3 welded)
//   passes as compatible, and the line is priced as one of them without anyone choosing; or the check flags a size
//   that names one tube (« Ø 15 », « 16/18 », « 15x1 », a cast-iron DN 75 printed for the DN 70 pipe, a stainless
//   DN 65 whose two series share one outer diameter); or it hides a failure that comes first (material not admitted,
//   blocked couple) or drops the condition of a couple to justify;
// - derived DN: a passing line does not say what tube it resolved to (outer diameter, wall, nominal DN), or takes
//   the usual wall of the series for the one the text prints (« 22x1,5 »).

function inputs(overrides: Partial<TakeoffRuleInputs> = {}): TakeoffRuleInputs {
  return { version: TAKEOFF_RULE_INPUTS_VERSION, source: "designation", kind: "network", network: "EF", material: "cuivre", dn: "DN 22",
    non_observable: null, model_quantity: 5, ...overrides };
}

function dnNetwork(lineInputs: TakeoffRuleInputs) {
  const line: RuleLine = { id: "line", job_id: "job", page_key: null, designation: "Ligne fictive", unit: "ml", quantity: 5, is_excluded: false,
    frozen: false, inputs: lineInputs, geometry: null };
  return evaluateTakeoffRules({ pages: [], lines: [line] }).results.get("line")?.find((entry) => entry.rule === "dn_network");
}

const outerDiameters = (dn: string, network: Parameters<typeof findNetworkDiameterEntries>[1], material: Parameters<typeof findNetworkDiameterEntries>[2]) =>
  findNetworkDiameterEntries(dn, network, material).map((entry) => entry.od_mm);

describe("printed notation of a size (TI-683, D7)", () => {
  it("writes a vector size with the notation of its label, at inputs version 2", () => {
    expect(TAKEOFF_RULE_INPUTS_VERSION).toBe(2);
    const outer = ruleInputsFromVector({ kind: "network", network: "EU", material: "fonte", dn: 110, notation: "Ø", quantity: 4 });
    expect(outer).toMatchObject({ version: 2, dn: "Ø 110" });
    expect(ruleInputsFromVector({ kind: "network", network: "EU", material: "fonte", dn: 100, notation: "DN", quantity: 4 }))
      .toMatchObject({ version: 2, dn: "DN 100" });
    expect(ruleInputsFromVector({ kind: "network", network: "EU", material: null, dn: null, notation: null, quantity: 4 }))
      .toMatchObject({ version: 2, dn: null });
    // A size whose notation is not known is written as before (« DN n », version 1) and read either way.
    expect(ruleInputsFromVector({ kind: "network", network: "EU", material: "fonte", dn: 110, quantity: 4 })).toMatchObject({ version: 1, dn: "DN 110" });
  });

  it("reads a size as printed, and only a vector size of before the notation either way", () => {
    expect(sizeReadings(inputs({ source: "vector", version: 1, dn: "DN 110" }))).toEqual(["DN 110", "Ø 110"]);
    expect(sizeReadings(inputs({ source: "vector", version: 2, dn: "DN 110" }))).toEqual(["DN 110"]);
    expect(sizeReadings(inputs({ source: "vector", version: 2, dn: "Ø 110" }))).toEqual(["Ø 110"]);
    expect(sizeReadings(inputs({ source: "designation", version: 1, dn: "DN 110" }))).toEqual(["DN 110"]);
    expect(sizeReadings(inputs({ dn: null }))).toEqual([]);
  });

  it("fails a cast-iron « DN 110 » printed as such, and still passes the stored form of before", () => {
    const printed = (dn: number, notation: "DN" | "Ø") =>
      dnNetwork(ruleInputsFromVector({ kind: "network", network: "EU", material: "fonte", dn, notation, quantity: 4 }));
    expect(printed(110, "Ø")).toMatchObject({ code: "DN_NETWORK_COMPATIBLE" });
    expect(printed(100, "DN")).toMatchObject({ code: "DN_NETWORK_COMPATIBLE" });
    expect(printed(110, "DN")).toMatchObject({ code: "DN_NETWORK_DN_NOT_IN_SERIES" });
    expect(printed(100, "Ø")).toMatchObject({ code: "DN_NETWORK_DN_NOT_IN_SERIES" });
    expect(dnNetwork(inputs({ source: "vector", version: 1, network: "EU", material: "fonte", dn: "DN 110" })))
      .toMatchObject({ code: "DN_NETWORK_COMPATIBLE" });
  });

  it("reads a stainless drainage « Ø 100 » as a size NF EN 1124 lacks, « DN 100 » and « Ø 110 » as its 110 mm tube", () => {
    const stainless = (dn: number, notation: "DN" | "Ø") =>
      dnNetwork(ruleInputsFromVector({ kind: "network", network: "EU", material: "inox", dn, notation, quantity: 4 }));
    expect(stainless(100, "Ø")).toMatchObject({ code: "DN_NETWORK_DN_NOT_IN_SERIES" });
    expect(stainless(100, "DN")).toMatchObject({ code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION" });
    expect(stainless(110, "Ø")).toMatchObject({ code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION" });
    expect(stainless(110, "DN")).toMatchObject({ code: "DN_NETWORK_DN_NOT_IN_SERIES" });
  });

  it("keeps the notation a designation prints", () => {
    const read = (designation: string) => ruleInputsFromDesignation({ designation, unit: "ml", quantity: 4 });
    expect(read("EF tube cuivre 20/22")).toMatchObject({ network: "EF", material: "cuivre", dn: "20/22" });
    expect(read("EU PVC Ø 110")).toMatchObject({ network: "EU", material: "pvc", dn: "Ø 110" });
    expect(read("EU fonte DN 100")).toMatchObject({ dn: "DN 100" });
    expect(read("EF inox 316L 22x1,2")).toMatchObject({ dn: "22x1.2" });
    // One size printed two ways is kept by the text that names one tube: « DN 15 » alone names two copper tubes.
    expect(read("EF cuivre DN 15 / Ø 15")).toMatchObject({ dn: "Ø 15" });
    expect(read("EF cuivre DN 20 / Ø 22")).toMatchObject({ dn: "DN 20" });
    expect(read("EF cuivre DN 15")).toMatchObject({ dn: "DN 15" });
    const pair = dnNetwork(read("EF tube cuivre 20/22"));
    expect(pair).toMatchObject({ code: "DN_NETWORK_COMPATIBLE", details: { dn: "20/22", size: { printed: "20/22", od_mm: 22, nominal_dn: 20 } } });
    expect(pair?.reason.startsWith("20/22 en cuivre")).toBe(true);
  });
});

describe("series of a material by its usage (TI-683, D7)", () => {
  it("reads PE on a gravity network in its drainage sizes only", () => {
    expect(checkNetworkDiameter("EU", "pehd", "Ø 110").status).toBe("compatible");
    expect(checkNetworkDiameter("EP", "pehd", "Ø 315").status).toBe("compatible");
    for (const size of ["Ø 20", "Ø 25", "Ø 140"]) expect(checkNetworkDiameter("EU", "pehd", size).status, size).toBe("dn_not_in_series");
  });

  it("reads PP on a gravity network in its drainage sizes only", () => {
    expect(checkNetworkDiameter("EV", "pp", "Ø 110").status).toBe("compatible");
    expect(checkNetworkDiameter("EV", "pp", "Ø 32").status).toBe("compatible");
    for (const size of ["Ø 16", "Ø 20", "Ø 25"]) expect(checkNetworkDiameter("EV", "pp", size).status, size).toBe("dn_not_in_series");
  });

  it("takes no size away from a pressure network, from condensates or from a line without network", () => {
    for (const size of ["Ø 20", "Ø 25", "Ø 140", "Ø 110"]) {
      expect(checkNetworkDiameter("CHW", "pehd", size).status, size).toBe("compatible");
      expect(checkNetworkDiameter("COND", "pehd", size).status, size).toBe("compatible");
      expect(outerDiameters(size, null, "pehd"), size).toHaveLength(1);
    }
    for (const size of ["Ø 16", "Ø 20", "Ø 25", "Ø 110"]) {
      expect(checkNetworkDiameter("EF", "pp", size).status, size).toBe("compatible");
      expect(checkNetworkDiameter("COND", "pp", size).status, size).toBe("compatible");
      expect(outerDiameters(size, null, "pp"), size).toHaveLength(1);
    }
    // A couple to justify keeps its condition whatever the size: PE on cold water is never « compatible ».
    expect(checkNetworkDiameter("EF", "pehd", "Ø 20").status).toBe("requires_justification");
  });

  it("gives the rule, the designation reader and the DPGF identity one list per usage, PVC included", () => {
    expect(outerDiameters("Ø 20", "EU", "pehd")).toEqual([]);
    expect(outerDiameters("Ø 16", "EV", "pp")).toEqual([]);
    expect(outerDiameters("Ø 16", "EU", "pvc")).toEqual([]);
    expect(outerDiameters("Ø 100", "EF", "pvc-pression")).toEqual([]);
    expect(outerDiameters("Ø 110", "EU", "pehd")).toEqual([110]);
    // A size the usage lacks fails the rule, alone or beside a known one (two sizes: none read).
    expect(dnNetwork(ruleInputsFromDesignation({ designation: "EU PEHD Ø 20", unit: "ml", quantity: 4 })))
      .toMatchObject({ code: "DN_NETWORK_DN_NOT_IN_SERIES" });
    expect(dnNetwork(ruleInputsFromDesignation({ designation: "EU PEHD Ø 110 / Ø 20", unit: "ml", quantity: 4 })))
      .toMatchObject({ status: "fail", code: "DN_NETWORK_DN_MISSING" });
    const line = (designation: string) => ({ designation, unit: "ml", quantity: 10 });
    expect(haveComparableQuantities(line("EU PEHD Ø 110"), line("EU PEHD DN 110"))).toBe(true);
    expect(haveComparableQuantities(line("EU PEHD Ø 110"), line("EU PEHD Ø 125"))).toBe(false);
  });
});

describe("a size that names two tubes (TI-683, Q7)", () => {
  it("resolves a size to one tube: outer diameter, wall and derived nominal DN", () => {
    expect(resolveNetworkSize("DN 22", "EF", "cuivre")).toEqual({ status: "resolved",
      size: { printed: "DN 22", families: ["cuivre"], od_mm: 22, wall_mm: 1, wall_source: "series", nominal_dn: 20 } });
    expect(resolveNetworkSize("Ø 22", "EF", "cuivre")).toMatchObject({ status: "resolved", size: { od_mm: 22, nominal_dn: 20 } });
    // The wall the text prints, never the usual wall of the series.
    expect(resolveNetworkSize("22x1,5", "EF", "inox-316l")).toMatchObject({ status: "resolved",
      size: { printed: "22x1,5", od_mm: 22, wall_mm: 1.5, wall_source: "printed", nominal_dn: 20 } });
    // Two series, one outer diameter: one tube, no wall when they disagree on it.
    expect(resolveNetworkSize("DN 65", "CHW", "inox")).toMatchObject({ status: "resolved",
      size: { families: ["inox-sertir", "inox-soude"], od_mm: 76.1, wall_mm: null, wall_source: null, nominal_dn: 65 } });
    // The 78 mm cast-iron pipe, DN 70 of NF EN 877, is printed DN 75 by French catalogues: one tube either way.
    expect(resolveNetworkSize("DN 75", "EU", "fonte")).toMatchObject({ status: "resolved", size: { od_mm: 78, nominal_dn: 75 } });
    expect(resolveNetworkSize("DN 70", "EU", "fonte")).toMatchObject({ status: "resolved", size: { od_mm: 78, nominal_dn: 70 } });
    expect(resolveNetworkSize("Ø 110", "EU", "pvc")).toMatchObject({ status: "resolved", size: { od_mm: 110, wall_mm: null, nominal_dn: null } });
    expect(resolveNetworkSize("DN 23", "EF", "cuivre")).toEqual({ status: "unknown" });
  });

  it("reads an outer diameter as the tube of exactly that diameter, before one a rounding reaches", () => {
    // Stainless under pressure: the press-fit Ø 42 (DN 40) and the welded Ø 42,4 (DN 32) both print « 42 » once rounded.
    expect(resolveNetworkSize("Ø 42", "EF", "inox")).toMatchObject({ status: "resolved", size: { families: ["inox-sertir"], od_mm: 42, nominal_dn: 40 } });
    expect(resolveNetworkSize("Ø 42,4", "EF", "inox")).toMatchObject({ status: "resolved", size: { families: ["inox-soude"], od_mm: 42.4, nominal_dn: 32 } });
    expect(resolveNetworkSize("42x1,5", "EF", "inox")).toMatchObject({ status: "resolved", size: { od_mm: 42, wall_mm: 1.5, wall_source: "printed" } });
    expect(dnNetwork(inputs({ material: "inox", dn: "Ø 42" }))).toMatchObject({ status: "pass", code: "DN_NETWORK_COMPATIBLE" });
    // A rounded size no tube has exactly still names its one tube; a « DN n » never chooses by its number.
    expect(resolveNetworkSize("Ø 114", "CHW", "inox")).toMatchObject({ status: "resolved", size: { od_mm: 114.3 } });
    expect(resolveNetworkSize("DN 15", "EF", "cuivre").status).toBe("ambiguous");
  });

  it("names the tubes an ambiguous « DN n » may be", () => {
    const candidates = (dn: string, network: Parameters<typeof resolveNetworkSize>[1], material: Parameters<typeof resolveNetworkSize>[2]) => {
      const resolved = resolveNetworkSize(dn, network, material);
      return resolved.status === "ambiguous" ? resolved.candidates.map((candidate) => candidate.od_mm) : resolved.status;
    };
    expect(candidates("DN 15", "EF", "cuivre")).toEqual([15, 18]);
    expect(candidates("DN 32", "EF", "cuivre")).toEqual([32, 35]);
    expect(candidates("DN 100", "EF", "inox")).toEqual([108, 114.3]);
    expect(candidates("DN 20", "ECS", "multicouche")).toEqual([20, 26]);
    // On a drainage network stainless has one series: its DN 100 is the 110 mm tube.
    expect(candidates("DN 100", "EU", "inox")).toBe("resolved");
    for (const [dn, material] of [["Ø 15", "cuivre"], ["16/18", "cuivre"], ["15x1", "cuivre"], ["DN 20", "cuivre"], ["DN 22", "cuivre"],
      ["Ø 20", "multicouche"], ["DN 26", "multicouche"], ["DN 35", "inox-316l"], ["Ø 108", "inox"]] as const) {
      expect(candidates(dn, "EF", material), `${material} ${dn}`).toBe("resolved");
    }
  });

  it("fails an ambiguous size as a DN not read, with its candidates, and passes the same tube printed by its outer diameter", () => {
    expect(checkNetworkDiameter("EF", "cuivre", "DN 15").status).toBe("dn_ambiguous");
    const ambiguous = dnNetwork(inputs({ dn: "DN 15" }));
    expect(ambiguous).toMatchObject({ status: "fail", code: "DN_NETWORK_DN_MISSING", acceptable: true, version: NETWORK_DIAMETER_TABLE_VERSION,
      details: { network: "EF", material: "cuivre", dn: "DN 15",
        size_candidates: [{ od_mm: 15, nominal_dn: 12 }, { od_mm: 18, nominal_dn: 15 }] } });
    expect(ambiguous?.reason).toBe("DN 15 désigne deux tubes en cuivre : Ø 15 (DN nominal 12) ou Ø 18 (DN nominal 15). "
      + "Préciser le diamètre extérieur pour le réseau EF (eau froide).");
    expect(dnNetwork(inputs({ dn: "Ø 15" }))).toMatchObject({ status: "pass", code: "DN_NETWORK_COMPATIBLE",
      details: { size: { printed: "Ø 15", od_mm: 15, wall_mm: 1, nominal_dn: 12 } } });
    expect(dnNetwork(inputs({ dn: "Ø 15" }))?.reason).toBe("Ø 15 en cuivre (Ø extérieur 15 mm, DN nominal 12) compatible avec le réseau EF (eau froide).");
    const stainless = dnNetwork(inputs({ material: "inox", dn: "DN 100" }));
    expect(stainless).toMatchObject({ status: "fail", code: "DN_NETWORK_DN_MISSING" });
    expect(stainless?.reason).toContain("Ø 108 (DN nominal 100) ou Ø 114,3 (DN nominal 100)");
  });

  it("keeps what comes before the size and the condition of a couple to justify", () => {
    expect(checkNetworkDiameter("EF", null, "DN 15").status).toBe("material_missing");
    expect(checkNetworkDiameter("EU", "cuivre", "DN 15").status).toBe("material_not_allowed");
    expect(checkNetworkDiameter("GAZ", "multicouche", "DN 20").status).toBe("blocked");
    expect(checkNetworkDiameter("COND", "cuivre", "DN 15")).toMatchObject({ status: "dn_ambiguous", condition: "Justifier des condensats de climatisation." });
    // A couple to justify stays one whatever tube its size names: the line keeps the failure that blocks until
    // justified, never the warning of a size not read (review of the PR).
    for (const [network, material, dn, condition] of [["COND", "cuivre", "DN 15", "Justifier des condensats de climatisation."],
      ["GLY", "multicouche", "DN 20", "antigel"]] as const) {
      const result = dnNetwork(inputs({ network, material, dn }));
      expect(result, `${network} ${material} ${dn}`).toMatchObject({ status: "fail", code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION", acceptable: true });
      expect(result?.reason).toContain(condition);
      expect(result?.reason).toContain("Préciser le diamètre extérieur");
      expect((result?.details as { size_candidates?: unknown[] }).size_candidates).toHaveLength(2);
    }
    // Read either way, a vector size of before the notation is ambiguous only when both readings leave two tubes. The
    // tube it resolved to keeps the size as stored, never a text the plan did not print.
    expect(dnNetwork(inputs({ source: "vector", version: 1, network: "EU", material: "fonte", dn: "DN 110" })))
      .toMatchObject({ code: "DN_NETWORK_COMPATIBLE", details: { dn: "DN 110", size: { printed: "DN 110", od_mm: 110, nominal_dn: 100 } } });
  });

  it("moves the table to version 4: every dn_network failure key changes", () => {
    const failing = dnNetwork(inputs({ dn: "DN 15" }));
    expect(ruleFailureKeys(failing ? [failing] : [])).toEqual(["dn_network|DN_NETWORK_DN_MISSING|4|"]);
  });

  it("keeps the resolved tube and the candidates through the bounds of stored results", () => {
    const stored = boundRuleResults([dnNetwork(inputs({ dn: "DN 22" }))!, dnNetwork(inputs({ material: "inox", network: "COND", dn: "DN 40" }))!]);
    expect(stored[0].details).toMatchObject({ size: { printed: "DN 22", od_mm: 22, nominal_dn: 20, wall_mm: 1, wall_source: "series" } });
    expect((stored[1].details as { size_candidates: Array<{ od_mm: number }> }).size_candidates.map((tube) => tube.od_mm)).toEqual([40, 42, 48.3]);
  });

  it("reads an exact outer diameter the same way for the rule and for the DPGF identity", () => {
    // « Ø 42 » is the press-fit tube (DN 40), never the welded Ø 42,4 (DN 32) a rounding reaches.
    const line = (designation: string) => ({ designation, unit: "ml", quantity: 10 });
    expect(outerDiameters("Ø 42", "EF", "inox")).toEqual([42]);
    expect(outerDiameters("Ø 42,4", "EF", "inox")).toEqual([42.4]);
    expect(haveComparableQuantities(line("EF inox Ø 42"), line("EF inox DN 32"))).toBe(false);
    expect(haveComparableQuantities(line("EF inox Ø 42"), line("EF inox 42x1,5"))).toBe(true);
  });
});
