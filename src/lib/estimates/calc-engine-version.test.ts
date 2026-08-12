import { describe, expect, it } from "vitest";

import {
  hasFreshEstimateV2Snapshot,
  NEW_ESTIMATE_CALC_ENGINE_VERSION,
  resolveCalcEngineVersion,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";

describe("NEW_ESTIMATE_CALC_ENGINE_VERSION", () => {
  it("selects the unified engine for newly created versions", () => {
    expect(NEW_ESTIMATE_CALC_ENGINE_VERSION).toBe(2);
  });
});

describe("resolveCalcEngineVersion", () => {
  it("falls back to the default engine when the version is null", () => {
    expect(resolveCalcEngineVersion(null)).toBe(1);
  });

  it("falls back to the default engine when the version is undefined", () => {
    expect(resolveCalcEngineVersion(undefined)).toBe(1);
  });

  it("falls back to the default engine when the column is absent", () => {
    expect(resolveCalcEngineVersion({})).toBe(1);
  });

  it("falls back to the default engine when the column is null", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: null })).toBe(1);
  });

  it("returns the legacy engine for 1", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: 1 })).toBe(1);
  });

  it("returns the unified engine for 2", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: 2 })).toBe(2);
  });

  it("falls back to the default engine for 0", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: 0 })).toBe(1);
  });

  it("falls back to the default engine for a negative value", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: -1 })).toBe(1);
  });

  it("falls back to the default engine for an unsupported future engine", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: 3 })).toBe(1);
  });

  it("falls back to the default engine for NaN", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: NaN })).toBe(1);
  });

  it("falls back to the default engine for Infinity", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: Infinity })).toBe(1);
  });

  it("falls back to the default engine for -Infinity", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: -Infinity })).toBe(1);
  });

  it("truncates a fractional value towards zero before matching", () => {
    expect(resolveCalcEngineVersion({ calc_engine_version: 1.9 })).toBe(1);
    expect(resolveCalcEngineVersion({ calc_engine_version: 2.9 })).toBe(2);
    expect(resolveCalcEngineVersion({ calc_engine_version: 0.9 })).toBe(1);
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
