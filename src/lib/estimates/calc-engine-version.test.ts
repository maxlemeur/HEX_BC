import { describe, expect, it } from "vitest";

import { hasFreshEstimateV2Snapshot, resolveCalcEngineVersion, shouldPreserveStoredEstimateV2Snapshot } from "@/lib/estimates/calc-engine-version";

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

describe("hasFreshEstimateV2Snapshot", () => {
  it("recognizes a frozen v2 draft independently from its workflow status", () => {
    expect(
      hasFreshEstimateV2Snapshot({
        calc_engine_version: 2,
        content_revision: 7,
        calc_snapshot_content_revision: 7,
      })
    ).toBe(true);
  });

  it.each([
    { calc_engine_version: 1, content_revision: 7, calc_snapshot_content_revision: 7 },
    { calc_engine_version: 2, content_revision: 7, calc_snapshot_content_revision: null },
    { calc_engine_version: 2, content_revision: 8, calc_snapshot_content_revision: 7 },
    { calc_engine_version: 2 },
  ])("rejects a legacy, absent, or stale snapshot: %o", (version) => {
    expect(hasFreshEstimateV2Snapshot(version)).toBe(false);
  });
});

describe("shouldPreserveStoredEstimateV2Snapshot", () => {
  it("uses a fresh snapshot for a draft under review", () => {
    expect(
      shouldPreserveStoredEstimateV2Snapshot({
        calc_engine_version: 2,
        status: "draft",
        content_revision: 4,
        calc_snapshot_content_revision: 4,
      })
    ).toBe(true);
  });

  it("keeps finalized legacy v2 versions independent from live inputs", () => {
    expect(
      shouldPreserveStoredEstimateV2Snapshot({
        calc_engine_version: 2,
        status: "sent",
        content_revision: 4,
        calc_snapshot_content_revision: null,
      })
    ).toBe(true);
  });

  it("keeps a stale v2 draft on live calculation until it is frozen again", () => {
    expect(
      shouldPreserveStoredEstimateV2Snapshot({
        calc_engine_version: 2,
        status: "draft",
        content_revision: 5,
        calc_snapshot_content_revision: 4,
      })
    ).toBe(false);
  });
});
