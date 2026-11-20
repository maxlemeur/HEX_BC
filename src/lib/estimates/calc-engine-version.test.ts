import { describe, expect, it } from "vitest";

import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";

// Lot 2, sous-lot 2.1 (docs/testing/estimate-engine-v3-2.1.md, F-TS-01) : une v3 ne doit jamais
// être relue comme une v1. Isolation justifiée : le résolveur est appelé par tous les chemins
// contractuels ; un repli silencieux sur 1 corromprait un montant sans signal E2E.
function thrownBy(read: () => unknown) {
  try {
    read();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("resolveCalcEngineVersion", () => {
  it("refuses engine 3 with EstimateEngineUnavailableError instead of reading it as engine 1", () => {
    expect(thrownBy(() => resolveCalcEngineVersion({ calc_engine_version: 3 }))).toMatchObject({
      name: "EstimateEngineUnavailableError",
      code: "ESTIMATE_ENGINE_UNAVAILABLE",
      engineVersion: 3,
    });
    expect(thrownBy(() => resolveCalcEngineVersion({ calc_engine_version: 3.9 }))).toMatchObject({
      code: "ESTIMATE_ENGINE_UNAVAILABLE",
    });
  });

  it("refuses engines above 3 as unsupported instead of reading them as engine 1", () => {
    for (const calc_engine_version of [4, 7]) {
      expect(thrownBy(() => resolveCalcEngineVersion({ calc_engine_version }))).toMatchObject({
        code: "ESTIMATE_CALC_ENGINE_UNSUPPORTED",
      });
    }
  });
});
