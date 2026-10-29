import { describe, expect, it } from "vitest";

import { requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";

// Lot 2, sous-lot 2.1 (docs/testing/estimate-engine-v3-2.1.md, F-TS-02). Isolation justifiée :
// requireEstimateEngineVersion est l'analyseur strict de tous les chemins contractuels (gel,
// sceau, envoi, document, export, réglages, règles). Une liste `select` qui oublie la colonne
// ou une valeur hors domaine ne doit jamais devenir un moteur par défaut ; aucun parcours E2E
// ne fabrique ces lignes incomplètes.
function thrownBy(read: () => unknown) {
  try {
    read();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("requireEstimateEngineVersion", () => {
  it("refuses a row whose select list omitted calc_engine_version", () => {
    expect(thrownBy(() => requireEstimateEngineVersion({ id: "version" }))).toMatchObject({
      code: "ESTIMATE_CALC_ENGINE_MISSING",
    });
  });

  it("refuses an inherited calc_engine_version that the row itself does not carry", () => {
    const row = Object.create({ calc_engine_version: 2 }) as { calc_engine_version?: number };
    expect(thrownBy(() => requireEstimateEngineVersion(row))).toMatchObject({
      code: "ESTIMATE_CALC_ENGINE_MISSING",
    });
  });

  it.each([null, undefined])("refuses a missing row (%s)", (row) => {
    expect(thrownBy(() => requireEstimateEngineVersion(row))).toMatchObject({
      code: "ESTIMATE_CALC_ENGINE_MISSING",
    });
  });

  it.each([
    null,
    undefined,
    0,
    -1,
    4,
    1.5,
    2.9,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "2",
  ])("refuses the out-of-domain stored value %s instead of defaulting", (value) => {
    expect(
      thrownBy(() => requireEstimateEngineVersion({ calc_engine_version: value } as never))
    ).toMatchObject({ code: "ESTIMATE_CALC_ENGINE_UNSUPPORTED" });
  });
});
