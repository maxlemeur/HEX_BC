import { describe, expect, it } from "vitest";

import { computeEstimateBreakdown, type EstimateComputationInput } from "@/lib/estimate-calculations";
import { computeVersionBreakdown } from "@/lib/estimates/engine/compute";
import { computeEstimateV3Breakdown } from "@/lib/estimates/engine-v3";
import { oracleInput } from "@/lib/estimates/engine-v3/oracle.fixtures";

// Lot 2, sous-lot 2.1 (docs/testing/estimate-engine-v3-2.1.md, F-TS-03). Isolation justifiée :
// la façade est le seul aiguillage entre moteurs. Un aiguillage `>= 2` ou un repli
// silencieux enverrait une v3 dans le moteur v2 (ou v1) et produirait des montants faux,
// sans aucun écart visible tant qu'aucune v3 n'existe en E2E.
const line = {
  id: "11111111-1111-4111-8111-111111111111",
  item_type: "line",
  parent_id: "22222222-2222-4222-8222-222222222222",
  position: 1,
  quantity: 3,
  unit_price_ht_cents: 1234,
  tax_rate_bp: 2000,
  k_fo: 1.1,
  h_mo: 1.5,
  h_mo_majoration: 1,
  k_mo: 1,
  labor_role_id: "33333333-3333-4333-8333-333333333333",
} as unknown as EstimateComputationInput["items"][number];
const section = {
  id: "22222222-2222-4222-8222-222222222222",
  item_type: "section",
  parent_id: null,
  position: 1,
} as unknown as EstimateComputationInput["items"][number];

const baseInput: Omit<EstimateComputationInput, "calcEngineVersion"> = {
  items: [section, line],
  marginMultiplier: 1.25,
  marginMode: "fixed",
  marginTiers: [],
  globalCoefficient: 1,
  discountMode: "simple",
  discountCents: 101,
  discountStepsBp: [],
  taxRateBp: 2000,
  roundingMode: "none",
  roundingStepCents: 1,
  isLaborSplitEnabled: false,
  laborRateById: new Map([["33333333-3333-4333-8333-333333333333", 4000]]),
  laborRateAtelierById: new Map(),
  laborRateChantierById: new Map(),
};

function thrownBy(read: () => unknown) {
  try {
    read();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("computeVersionBreakdown", () => {
  it("refuses a historical-shaped call for engine 3 with a named, displayable error", () => {
    // 2.4 : un appelant non adapté (entrée v1/v2 sans entrée v3) échoue fermé, par son nom.
    const error = thrownBy(() =>
      computeVersionBreakdown({ ...baseInput, calcEngineVersion: 3 } as never)
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "EstimateEngineUnavailableError",
      code: "ESTIMATE_ENGINE_UNAVAILABLE",
      engineVersion: 3,
      status: 409,
      message: "Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.",
    });
  });

  it.each([0, 4, Number.NaN])("refuses the unknown engine %s instead of computing it as engine 1", (engine) => {
    expect(
      thrownBy(() => computeVersionBreakdown({ ...baseInput, calcEngineVersion: engine } as never))
    ).toMatchObject({ code: "ESTIMATE_CALC_ENGINE_UNSUPPORTED" });
  });

  it("routes engines 1 and 2 to their own historical computation", () => {
    const v1 = computeVersionBreakdown({ ...baseInput, calcEngineVersion: 1 });
    const v2 = computeVersionBreakdown({ ...baseInput, calcEngineVersion: 2 });

    expect(v1).toEqual(computeEstimateBreakdown({ ...baseInput, calcEngineVersion: 1 }));
    expect(v2).toEqual(computeEstimateBreakdown({ ...baseInput, calcEngineVersion: 2 }));
    // The two engines differ on this input: a mis-routed engine cannot pass both checks.
    expect(v1).not.toEqual(v2);
  });

  it("routes engine 3 to the v3 engine and returns its own breakdown type (2.4)", () => {
    const input = oracleInput({ discount_amount_cents: 101 });
    const result = computeVersionBreakdown({ calcEngineVersion: 3, v3: input });

    expect(result).toEqual(computeEstimateV3Breakdown(input));
    expect(result.engine).toBe(3);
    expect(result.totals.total_ht_cents).toBe(6_905_355);
    // Jamais converti en EstimateBreakdown v2 : aucune structure v2 dans le résultat.
    expect(result).not.toHaveProperty("lineById");
    expect(result).not.toHaveProperty("sectionById");
  });

  it("keeps engines 1 and 2 byte-identical to the historical engine (2.4)", () => {
    const serialize = (value: unknown) =>
      JSON.stringify(value, (_key, inner) => (inner instanceof Map ? [...inner.entries()] : inner));
    for (const engine of [1, 2] as const) {
      const viaFacade = computeVersionBreakdown({ ...baseInput, calcEngineVersion: engine });
      const direct = computeEstimateBreakdown({ ...baseInput, calcEngineVersion: engine });
      expect(serialize(viaFacade)).toBe(serialize(direct));
    }
  });
});
