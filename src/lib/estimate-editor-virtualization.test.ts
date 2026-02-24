import { describe, expect, it } from "vitest";

import {
  ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
  ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
  ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
  isEstimateEditorVirtualizationEnabled,
  parseEstimateEditorVirtualizationMode,
  parseBooleanFeatureFlag,
  parsePositiveInteger,
  resolveEstimateEditorVirtualizationConfig,
  resolveEstimateEditorVirtualizationRuntimeConfig,
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

describe("parseEstimateEditorVirtualizationMode", () => {
  it("parses supported mode aliases", () => {
    expect(parseEstimateEditorVirtualizationMode("on")).toBe("on");
    expect(parseEstimateEditorVirtualizationMode("true")).toBe("on");
    expect(parseEstimateEditorVirtualizationMode("enabled")).toBe("on");
    expect(parseEstimateEditorVirtualizationMode("off")).toBe("off");
    expect(parseEstimateEditorVirtualizationMode("false")).toBe("off");
    expect(parseEstimateEditorVirtualizationMode("disabled")).toBe("off");
    expect(parseEstimateEditorVirtualizationMode("auto")).toBe("auto");
  });

  it("returns null for unsupported values", () => {
    expect(parseEstimateEditorVirtualizationMode(undefined)).toBeNull();
    expect(parseEstimateEditorVirtualizationMode("")).toBeNull();
    expect(parseEstimateEditorVirtualizationMode("sometimes")).toBeNull();
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
      mode: "off",
      autoThreshold: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
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
      mode: "on",
      autoThreshold: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
      rowEstimate: 64,
      overscan: 10,
      maxHeight: 720,
    });
  });

  it("supports explicit auto mode and threshold from env", () => {
    expect(
      resolveEstimateEditorVirtualizationConfig({
        enabled: "false",
        mode: "auto",
        autoThreshold: "1200",
      })
    ).toEqual({
      enabled: false,
      mode: "auto",
      autoThreshold: 1200,
      rowEstimate: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
      overscan: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
    });
  });
});

describe("resolveEstimateEditorVirtualizationRuntimeConfig", () => {
  it("keeps env config when no runtime override is provided", () => {
    expect(
      resolveEstimateEditorVirtualizationRuntimeConfig({
        env: {
          enabled: "true",
          rowEstimate: "64",
          overscan: "10",
        },
      })
    ).toEqual({
      enabled: true,
      mode: "on",
      autoThreshold: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
      rowEstimate: 64,
      overscan: 10,
    });
  });

  it("forces on when runtime mode flag is enabled without value", () => {
    expect(
      resolveEstimateEditorVirtualizationRuntimeConfig({
        env: {
          enabled: "false",
        },
        modeFlag: {
          enabled: true,
          value: null,
        },
      })
    ).toEqual({
      enabled: true,
      mode: "on",
      autoThreshold: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
      rowEstimate: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
      overscan: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
    });
  });

  it("applies runtime mode and threshold value when provided", () => {
    expect(
      resolveEstimateEditorVirtualizationRuntimeConfig({
        env: {
          enabled: "true",
          autoThreshold: "800",
        },
        modeFlag: {
          enabled: true,
          value: "auto",
        },
        autoThresholdFlag: {
          value: "1300",
        },
      })
    ).toEqual({
      enabled: false,
      mode: "auto",
      autoThreshold: 1300,
      rowEstimate: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
      overscan: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
    });
  });

  it("applies runtime mode value even when the toggle is disabled", () => {
    expect(
      resolveEstimateEditorVirtualizationRuntimeConfig({
        env: {
          enabled: "true",
        },
        modeFlag: {
          enabled: false,
          value: "off",
        },
      })
    ).toEqual({
      enabled: false,
      mode: "off",
      autoThreshold: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
      rowEstimate: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE,
      overscan: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN,
    });
  });
});

describe("isEstimateEditorVirtualizationEnabled", () => {
  it("resolves enabled from mode on/off", () => {
    expect(
      isEstimateEditorVirtualizationEnabled(
        {
          enabled: false,
          mode: "off",
          autoThreshold: 500,
        },
        5000
      )
    ).toBe(false);

    expect(
      isEstimateEditorVirtualizationEnabled(
        {
          enabled: true,
          mode: "on",
          autoThreshold: 500,
        },
        1
      )
    ).toBe(true);
  });

  it("enables auto mode only above threshold", () => {
    const config = {
      enabled: false,
      mode: "auto" as const,
      autoThreshold: 600,
    };

    expect(isEstimateEditorVirtualizationEnabled(config, 599)).toBe(false);
    expect(isEstimateEditorVirtualizationEnabled(config, 600)).toBe(true);
    expect(isEstimateEditorVirtualizationEnabled(config, 1200)).toBe(true);
  });
});
