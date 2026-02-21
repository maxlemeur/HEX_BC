import { describe, expect, it } from "vitest";

import {
  ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
  ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
  parseBooleanFeatureFlag,
  parsePositiveInteger,
  resolveEstimateEditorVirtualizationConfig,
} from "@/lib/estimate-editor-virtualization";

describe("parseBooleanFeatureFlag", () => {
  it("returns true for accepted truthy flags", () => {
    expect(parseBooleanFeatureFlag("true")).toBe(true);
    expect(parseBooleanFeatureFlag("TRUE")).toBe(true);
    expect(parseBooleanFeatureFlag("1")).toBe(true);
    expect(parseBooleanFeatureFlag("yes")).toBe(true);
    expect(parseBooleanFeatureFlag("on")).toBe(true);
  });

  it("returns false for missing and falsy values", () => {
    expect(parseBooleanFeatureFlag(undefined)).toBe(false);
    expect(parseBooleanFeatureFlag("")).toBe(false);
    expect(parseBooleanFeatureFlag("0")).toBe(false);
    expect(parseBooleanFeatureFlag("false")).toBe(false);
  });
});

describe("parsePositiveInteger", () => {
  it("parses positive integers", () => {
    expect(parsePositiveInteger("1")).toBe(1);
    expect(parsePositiveInteger("56")).toBe(56);
    expect(parsePositiveInteger("08")).toBe(8);
  });

  it("returns null for invalid values", () => {
    expect(parsePositiveInteger(undefined)).toBeNull();
    expect(parsePositiveInteger("")).toBeNull();
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("-7")).toBeNull();
    expect(parsePositiveInteger("NaN")).toBeNull();
  });
});

describe("resolveEstimateEditorVirtualizationConfig", () => {
  it("uses defaults when env values are invalid or missing", () => {
    expect(
      resolveEstimateEditorVirtualizationConfig({
        enabled: undefined,
        rowEstimate: "0",
        overscan: "-1",
      })
    ).toEqual({
      enabled: false,
      rowEstimate: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
      overscan: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
    });
  });

  it("builds config from valid env values", () => {
    expect(
      resolveEstimateEditorVirtualizationConfig({
        enabled: "true",
        rowEstimate: "64",
        overscan: "10",
        maxHeight: "720",
      })
    ).toEqual({
      enabled: true,
      rowEstimate: 64,
      overscan: 10,
      maxHeight: 720,
    });
  });
});
