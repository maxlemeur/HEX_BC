import {
  isEstimateEditorVirtualizationEnabled,
  resolveEstimateEditorVirtualizationConfig,
  resolveEstimateEditorVirtualizationRuntimeConfig,
} from "@/lib/estimate-editor-virtualization";

const ESTIMATE_EDITOR_VIRTUALIZATION_ENV_CONFIG =
  resolveEstimateEditorVirtualizationConfig({
    enabled: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ENABLED,
    mode: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_MODE,
    autoThreshold: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD,
    rowEstimate: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ROW_ESTIMATE,
    overscan: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_OVERSCAN,
    maxHeight: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_CONTAINER_HEIGHT,
  });

export function buildEstimateEditorTableVirtualization(input: {
  isVirtualizationModeFlagEnabled: boolean;
  virtualizationModeFlagValue: string | null | undefined;
  virtualizationAutoThresholdFlagValue: string | null | undefined;
  itemCount: number;
}) {
  const runtimeConfig = resolveEstimateEditorVirtualizationRuntimeConfig({
    baseConfig: ESTIMATE_EDITOR_VIRTUALIZATION_ENV_CONFIG,
    modeFlag: {
      enabled: input.isVirtualizationModeFlagEnabled,
      value: input.virtualizationModeFlagValue,
    },
    autoThresholdFlag: {
      value: input.virtualizationAutoThresholdFlagValue,
    },
  });
  return {
    enabled: isEstimateEditorVirtualizationEnabled(runtimeConfig, input.itemCount),
    rowEstimate: runtimeConfig.rowEstimate,
    overscan: runtimeConfig.overscan,
    ...(runtimeConfig.maxHeight !== undefined
      ? { maxHeight: runtimeConfig.maxHeight }
      : {}),
  };
}
