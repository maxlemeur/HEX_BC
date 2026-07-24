import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALC_ENGINE_VERSION,
  resolveCalcEngineVersion,
} from "@/lib/estimates/calc-engine-version";

describe("DEFAULT_CALC_ENGINE_VERSION", () => {
  it("is the legacy engine", () => {
    expect(DEFAULT_CALC_ENGINE_VERSION).toBe(1);
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
