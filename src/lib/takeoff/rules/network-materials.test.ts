import { describe, expect, it } from "vitest";

import { findDiameterEntries } from "@/lib/takeoff/bench/diameters";
import { takeoffItemBatchPatchSchema, prepareTakeoffItemPatch } from "@/lib/takeoff/item-patch-preparation";
import { requiresGasPeReason } from "@/lib/takeoff/rules/verification";
import { evaluateTakeoffRules, type RuleLine } from "@/lib/takeoff/rules/evaluate";
import { checkNetworkDiameter } from "@/lib/takeoff/rules/network-diameters";
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
