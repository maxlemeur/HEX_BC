import { describe, expect, it } from "vitest";

import { findDiameterEntries } from "@/lib/takeoff/bench/diameters";
import { takeoffItemBatchPatchSchema, prepareTakeoffItemPatch } from "@/lib/takeoff/item-patch-preparation";
import { haveComparableQuantities } from "@/lib/takeoff/quantity-compatibility";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import { requiresGasPeReason } from "@/lib/takeoff/rules/verification";
import { evaluateTakeoffRules, type RuleLine } from "@/lib/takeoff/rules/evaluate";
import { checkNetworkDiameter } from "@/lib/takeoff/rules/network-diameters";
import type { TakeoffRuleInputs } from "@/lib/takeoff/rules/types";
import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";

// TI-685, written before implementation. The browser cannot enumerate all network families or distinguish the
// nominal/outer diameter parser paths reliably. Risks: silent accepts, EFA/returns or inox grades escaping a
// condition, drainage sizes leaking into pressure series, a blanket WC minimum, and V bypassing justification.
describe("TI-685 network/material decisions", () => {
  it.each<[NetworkCode, MaterialCode, string]>([
    ["GAZ", "pehd", "Ø 32"], ["EUG", "pvc", "Ø 110"],
    ["EF", "acier-galvanise", "DN 50"], ["EFA", "acier-galvanise", "DN 50"],
    ["EF", "pehd", "Ø 32"], ["EFA", "pehd", "Ø 32"], ["COND", "cuivre", "Ø 22"],
    ["RIA", "pehd", "Ø 32"], ["GLY", "multicouche", "Ø 26"],
    ["GLY-S", "multicouche", "Ø 26"], ["GLY-R", "multicouche", "Ø 26"],
  ])("requires justification for %s / %s", (network, material, dn) => {
    expect(checkNetworkDiameter(network, material, dn).status).toBe("requires_justification");
  });

  it.each<MaterialCode>(["inox", "inox-304l", "inox-316l"])("uses only drainage sizes for %s in every drainage network", (material) => {
    for (const network of ["EU", "EV", "EUV", "EUG", "EP", "VP"] as const) {
      for (const dn of ["DN 100", "Ø 110"]) {
        expect(checkNetworkDiameter(network, material, dn).status).toBe("requires_justification");
      }
      expect(checkNetworkDiameter(network, material, "Ø 108").status).toBe("dn_not_in_series");
      expect(checkNetworkDiameter(network, material, "Ø 114,3").status).toBe("dn_not_in_series");
    }
    expect(checkNetworkDiameter("EF", material, "Ø 110").status).toBe("dn_not_in_series");
    expect(findDiameterEntries("Ø 110", material)).toEqual([]);
    expect(checkNetworkDiameter("COND", material, "Ø 22").status).toBe("compatible");
  });

  it("blocks gas multilayer, keeps the agreed copper/PER decisions, and adds no unlocalized WC minimum", () => {
    expect(checkNetworkDiameter("GAZ", "multicouche", "Ø 26").status).toBe("blocked");
    expect(checkNetworkDiameter("GLY", "cuivre", "Ø 22").status).toBe("compatible");
    expect(checkNetworkDiameter("RECS", "per", "Ø 20").status).toBe("compatible");
    expect(checkNetworkDiameter("EV", "pvc", "Ø 32").status).toBe("compatible");
  });

  it("never makes blocked gas acceptable by V", () => {
    const line: RuleLine = { id: "gas", job_id: "job", page_key: null, designation: "GAZ multicouche Ø 26", unit: "ml",
      quantity: 5, is_excluded: false, frozen: false, geometry: null,
      inputs: { version: 1, source: "designation", kind: "network", network: "GAZ", material: "multicouche",
        dn: "Ø 26", non_observable: null, model_quantity: 5 } };
    const result = evaluateTakeoffRules({ pages: [], lines: [line] }).results.get("gas");
    expect(result?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "fail", acceptable: false });
    for (const dn of [null, "DN 23"]) {
      const pe = { ...line, inputs: { ...line.inputs!, material: "pehd" as const, dn } };
      expect(requiresGasPeReason(evaluateTakeoffRules({ pages: [], lines: [pe] }).results.get("gas"))).toBe(true);
    }
    const inox = { ...line, inputs: { ...line.inputs!, source: "vector" as const, network: "EU" as const,
      material: "inox" as const, dn: "DN 110" } };
    expect(evaluateTakeoffRules({ pages: [], lines: [inox] }).results.get("gas")?.find((entry) => entry.rule === "dn_network"))
      .toMatchObject({ code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION" });
  });

  it("requires a structured system reference for a technical acceptance", () => {
    const currentItem = { updated_at: "2026-11-07T10:00:00Z", is_verified: false, evidence: "Plan p1", source_page: 1,
      rule_results: [{ rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_NOT_ALLOWED", version: 2,
        acceptable: true, reason: "À justifier" }], rules_stale: false };
    const plan = prepareTakeoffItemPatch({ currentItem: currentItem as never, level: "B", userId: "user",
      updatedAt: "2026-11-07T10:01:00Z", entry: { item_id: "item", updated_at: currentItem.updated_at, fields: { is_verified: true } } });
    expect(plan.success).toBe(false);
    expect(takeoffItemBatchPatchSchema.safeParse({ items: [{ item_id: "9d000000-0000-4000-8000-000000000401",
      updated_at: currentItem.updated_at, fields: { is_verified: true,
        verification_justification: { reason_code: "system_documented", system_reference: "Fabricant fictif, gamme G, certificat C" } } }] }).success).toBe(true);
  });
});

/** The dn_network result of one designation line with these inputs. */
function dnNetwork(inputs: Pick<TakeoffRuleInputs, "network" | "material" | "dn">) {
  const line: RuleLine = { id: "line", job_id: "job", page_key: null, designation: "Ligne fictive", unit: "ml", quantity: 5,
    is_excluded: false, frozen: false, geometry: null,
    inputs: { version: 1, source: "designation", kind: "network", non_observable: null, model_quantity: 5, ...inputs } };
  return evaluateTakeoffRules({ pages: [], lines: [line] }).results.get("line")?.find((entry) => entry.rule === "dn_network");
}

// TI-684, written before implementation (conformity review of 9 Nov.): the DN rule read stainless drainage through
// NF EN 1124, but the duplicate detection and the DPGF identity still read it through the pressure series. One
// stainless EU pipe printed « DN 100 » and « Ø 110 » was two sizes there, and « DN 100 » met « Ø 108 ».
describe("TI-684 one stainless series per network everywhere", () => {
  const comparable = (left: string, right: string) => [
    haveComparableQuantities({ designation: left, unit: "ml", quantity: 10 }, { designation: right, unit: "ml", quantity: 10 }),
    haveComparableQuantities({ designation: right, unit: "ml", quantity: 10 }, { designation: left, unit: "ml", quantity: 10 }),
  ];

  it("reads a stainless drainage DPGF identity through NF EN 1124", () => {
    expect(comparable("EU inox DN 100", "EU inox Ø 110")).toEqual([true, true]);
    expect(comparable("EU inox 316L DN 100", "EU inox 316L Ø 110")).toEqual([true, true]);
    expect(comparable("EU inox DN 100", "EU inox Ø 108")).toEqual([false, false]);
  });

  it("keeps the pressure series for stainless outside drainage", () => {
    for (const material of ["inox", "inox-304l", "inox-316l"] as const) {
      expect(checkNetworkDiameter("EF", material, "Ø 108").status).toBe("compatible");
      // TI-683: under pressure « DN 100 » names the Ø 108 press-fit tube or the Ø 114,3 welded one, never the Ø 110.
      expect(checkNetworkDiameter("EF", material, "DN 100")).toMatchObject({ status: "dn_ambiguous",
        candidates: [{ od_mm: 108 }, { od_mm: 114.3 }] });
    }
    expect(comparable("EF inox DN 100", "EF inox Ø 108")).toEqual([true, true]);
    expect(comparable("EF inox DN 100", "EF inox Ø 110")).toEqual([false, false]);
  });

  // D18c, written before the fix: the designation reader still read every printed stainless size through the pressure
  // series, whatever the network. « EU inox DN 100 / Ø 108 » (the 110 mm drainage DN beside the 108 mm press-fit tube)
  // passed as one size, « EU inox DN 100 / Ø 125 » (two drainage sizes) as the one Ø 125 the pressure series lacks, and
  // « EU inox DN 100 / Ø 110 » as an unknown Ø 110. The reader must treat them as it treats copper pairs today.
  describe("in the designation reader (D18c)", () => {
    const read = (designation: string) => {
      const inputs = ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 });
      return { dn: inputs.dn, code: dnNetwork(inputs)?.code };
    };

    it("reads one drainage size printed two ways as that size, as copper reads « DN 20 / Ø 22 »", () => {
      expect(read("EF cuivre DN 20 / Ø 22")).toEqual({ dn: "DN 20", code: "DN_NETWORK_COMPATIBLE" });
      for (const designation of ["EU inox DN 100 / Ø 110", "EP inox 316L DN 100 / Ø 110", "EUG inox DN 150 / Ø 160"]) {
        expect(read(designation), designation).toEqual({ dn: designation.match(/DN \d+/)?.[0],
          code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION" });
      }
    });

    it("keeps a size the drainage series lacks as printed beside a known DN, as copper keeps « Ø 23 » beside « DN 22 »", () => {
      expect(read("EF cuivre DN 22 / Ø 23")).toEqual({ dn: "Ø 23", code: "DN_NETWORK_DN_NOT_IN_SERIES" });
      expect(read("EU fonte DN 100 / Ø 108")).toEqual({ dn: "Ø 108", code: "DN_NETWORK_DN_NOT_IN_SERIES" });
      for (const material of ["inox", "inox 304L", "inox 316L"]) {
        const designation = `EU ${material} DN 100 / Ø 108`;
        expect(read(designation), designation).toEqual({ dn: "Ø 108", code: "DN_NETWORK_DN_NOT_IN_SERIES" });
      }
    });

    it("reads two different drainage sizes as none, as copper reads « DN 22 / Ø 28 »", () => {
      expect(read("EF cuivre DN 22 / Ø 28")).toEqual({ dn: null, code: "DN_NETWORK_DN_MISSING" });
      expect(read("EU inox DN 100 / Ø 125")).toEqual({ dn: null, code: "DN_NETWORK_DN_MISSING" });
    });

    // TI-683: « DN 100 » alone names two pressure tubes (three in condensates); printed beside its outer diameter, the
    // size is kept by the text that names one tube.
    it("keeps the pressure series outside drainage, and reads both in condensates (D18a)", () => {
      expect(read("EF inox DN 100 / Ø 108")).toEqual({ dn: "Ø 108", code: "DN_NETWORK_COMPATIBLE" });
      expect(read("EF inox DN 100 / Ø 110")).toEqual({ dn: "Ø 110", code: "DN_NETWORK_DN_NOT_IN_SERIES" });
      expect(read("COND inox DN 100 / Ø 108")).toEqual({ dn: "Ø 108", code: "DN_NETWORK_COMPATIBLE" });
      expect(read("COND inox DN 100 / Ø 110")).toEqual({ dn: "Ø 110", code: "DN_NETWORK_COMPATIBLE" });
      expect(read("EF inox DN 100")).toEqual({ dn: "DN 100", code: "DN_NETWORK_DN_MISSING" });
    });

    it("never takes two contradictory stainless drainage sizes for the DPGF quantity of one", () => {
      expect(comparable("EU inox DN 100 / Ø 108", "EU inox DN 100")).toEqual([false, false]);
      expect(comparable("EU inox DN 100 / Ø 110", "EU inox DN 100")).toEqual([true, true]);
      expect(comparable("EU inox DN 100 / Ø 110", "EU inox Ø 110")).toEqual([true, true]);
    });
  });
});

// TI-685 D18a, written before implementation: a condensate line may be pumped or gravity, so stainless reads both its
// pressure series and the provisional drainage series there. No size outside every table is added.
describe("TI-685 D18a stainless condensates", () => {
  it.each<MaterialCode>(["inox", "inox-304l", "inox-316l"])("admits %s condensates in pressure and drainage sizes", (material) => {
    for (const dn of ["Ø 22", "Ø 40", "Ø 50"]) expect(checkNetworkDiameter("COND", material, dn).status, dn).toBe("compatible");
    expect(checkNetworkDiameter("COND", material, "Ø 32").status).toBe("dn_not_in_series");
  });

  it("keeps copper condensates under justification", () => {
    expect(checkNetworkDiameter("COND", "cuivre", "Ø 22").status).toBe("requires_justification");
    expect(checkNetworkDiameter("COND", "cuivre", "Ø 40").status).toBe("dn_not_in_series");
  });
});

// TI-685 D18b, written before implementation: a missing or out-of-series DN hid the couple's condition, so the
// reviewer never saw what the material needed. Codes and acceptability stay as they were, and the reason is no part of
// a failure key. The keys still change, but with the table version (v3, NETWORK_DIAMETER_TABLE_VERSION), not the reason.
describe("TI-685 D18b couple condition beside a DN failure", () => {
  it.each<[NetworkCode, MaterialCode, string, string]>([
    ["EUG", "pvc", "Ø 105", "Eaux grasses : justifier un système PVC-C ou haute température."],
    ["EF", "acier-galvanise", "DN 23", "Certification NF, analyse d’eau et absence de cuivre en amont à justifier."],
    ["EFA", "pehd", "Ø 33", "Gamme eau potable et pose intérieure à justifier."],
    ["COND", "cuivre", "Ø 40", "Justifier des condensats de climatisation."],
    ["RIA", "pehd", "Ø 33", "Système PEHD pour RIA à justifier ; matériaux admis à vérifier."],
    ["GLY", "multicouche", "Ø 23", "Gamme antigel et pourcentage de glycol à justifier."],
    ["EU", "inox", "Ø 108", "Inox d’évacuation NF EN 1124 : gamme et série à justifier (table provisoire)."],
  ])("shows the %s / %s condition with a missing or out-of-series DN", (network, material, outside, condition) => {
    const missing = dnNetwork({ network, material, dn: null });
    expect(missing).toMatchObject({ status: "fail", code: "DN_NETWORK_DN_MISSING", acceptable: true });
    expect(missing?.reason).toContain("DN non lu");
    expect(missing?.reason).toContain(condition);
    const notInSeries = dnNetwork({ network, material, dn: outside });
    expect(notInSeries).toMatchObject({ status: "fail", code: "DN_NETWORK_DN_NOT_IN_SERIES", acceptable: true });
    expect(notInSeries?.reason).toContain(`${outside} n’existe pas`);
    expect(notInSeries?.reason).toContain(condition);
  });

  it("adds nothing to a couple without condition", () => {
    expect(dnNetwork({ network: "EF", material: "cuivre", dn: null })?.reason).toBe("DN non lu (aucun ou deux) pour le réseau EF (eau froide).");
  });

  it("keeps PE gas on its own code and reason", () => {
    for (const [dn, diameter] of [[null, "Diamètre non lu : système à préciser."], ["DN 23", "Diamètre hors série : système à justifier."]] as const) {
      expect(dnNetwork({ network: "GAZ", material: "pehd", dn })).toMatchObject({ status: "fail", acceptable: true,
        code: "DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION",
        reason: `PE gaz : justifier une pose enterrée à l’extérieur hors emprise du bâtiment, ou une remontée en façade jusqu’au raccord métal/plastique. ${diameter}` });
    }
  });
});

describe("TI-685 gas multilayer wording", () => {
  // TI-686 D10: the override that exists asks each forced line for a coded reason and a written justification.
  it("promises only the administrator override that exists", () => {
    expect(dnNetwork({ network: "GAZ", material: "multicouche", dn: "Ø 26" })).toMatchObject({ status: "fail", acceptable: false,
      code: "DN_NETWORK_MATERIAL_BLOCKED",
      reason: "Multicouche en gaz : interdit, ne s’accepte pas en relecture. Seul un administrateur peut forcer l’application, "
        + "avec un motif codé et une justification écrite." });
  });
});
