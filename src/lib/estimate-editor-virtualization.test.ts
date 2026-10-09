import { describe, expect, it } from "vitest";

import { ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD, ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN, ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE, isEstimateEditorVirtualizationEnabled, resolveEstimateEditorVirtualizationConfig, resolveEstimateEditorVirtualizationRuntimeConfig } from "@/lib/estimate-editor-virtualization";

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
      mode: "auto",
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

  it("preserves env mode when runtime mode flag is inactive", () => {
    expect(
      resolveEstimateEditorVirtualizationRuntimeConfig({
        env: {
          mode: "off",
        },
        modeFlag: {
          enabled: false,
          value: "on",
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

  it("virtualizes medium estimates with the default auto threshold", () => {
    const config = {
      enabled: false,
      mode: "auto" as const,
      autoThreshold: ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD,
    };

    expect(
      isEstimateEditorVirtualizationEnabled(
        config,
        ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD - 1
      )
    ).toBe(false);
    expect(
      isEstimateEditorVirtualizationEnabled(
        config,
        ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD
      )
    ).toBe(true);
  });
});
