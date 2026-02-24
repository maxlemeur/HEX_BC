export const ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE = 56;
export const ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN = 8;
export const ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD = 800;

export const ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY =
  "EST_264_EDITOR_VIRTUALIZATION_MODE";
export const ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY =
  "EST_264_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD";

export type EstimateEditorVirtualizationMode = "off" | "on" | "auto";

export type EstimateEditorVirtualizationEnv = {
  enabled?: string;
  mode?: string;
  autoThreshold?: string;
  rowEstimate?: string;
  overscan?: string;
  maxHeight?: string;
};

export type EstimateEditorVirtualizationRuntimeConfig = {
  enabled: boolean;
  mode: EstimateEditorVirtualizationMode;
  autoThreshold: number;
  rowEstimate: number;
  overscan: number;
  maxHeight?: number;
};

export type EstimateEditorVirtualizationRuntimeFlag = {
  enabled: boolean;
  value: string | null;
};

export function parseBooleanFeatureFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parseEstimateEditorVirtualizationMode(
  value: string | undefined | null
): EstimateEditorVirtualizationMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "on" ||
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "enabled"
  ) {
    return "on";
  }

  if (
    normalized === "off" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "disabled"
  ) {
    return "off";
  }

  if (normalized === "auto") {
    return "auto";
  }

  return null;
}

function resolveEstimateEditorVirtualizationModeFromEnv(
  env: EstimateEditorVirtualizationEnv
): EstimateEditorVirtualizationMode {
  return (
    parseEstimateEditorVirtualizationMode(env.mode) ??
    (parseBooleanFeatureFlag(env.enabled) ? "on" : "off")
  );
}

export function resolveEstimateEditorVirtualizationConfig(
  env: EstimateEditorVirtualizationEnv
): EstimateEditorVirtualizationRuntimeConfig {
  const mode = resolveEstimateEditorVirtualizationModeFromEnv(env);
  const autoThreshold =
    parsePositiveInteger(env.autoThreshold) ??
    ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_AUTO_THRESHOLD;
  const rowEstimate =
    parsePositiveInteger(env.rowEstimate) ??
    ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE;
  const overscan =
    parsePositiveInteger(env.overscan) ??
    ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN;
  const maxHeight = parsePositiveInteger(env.maxHeight);

  const config: EstimateEditorVirtualizationRuntimeConfig = {
    enabled: mode === "on",
    mode,
    autoThreshold,
    rowEstimate,
    overscan,
  };
  if (maxHeight !== null) {
    config.maxHeight = maxHeight;
  }
  return config;
}

export function resolveEstimateEditorVirtualizationRuntimeConfig(input: {
  env?: EstimateEditorVirtualizationEnv;
  baseConfig?: EstimateEditorVirtualizationRuntimeConfig;
  modeFlag?: Partial<EstimateEditorVirtualizationRuntimeFlag> | null;
  autoThresholdFlag?: Pick<
    Partial<EstimateEditorVirtualizationRuntimeFlag>,
    "value"
  > | null;
}): EstimateEditorVirtualizationRuntimeConfig {
  const envConfig =
    input.baseConfig ?? resolveEstimateEditorVirtualizationConfig(input.env ?? {});
  const runtimeMode = parseEstimateEditorVirtualizationMode(input.modeFlag?.value);
  const mode = runtimeMode ?? (input.modeFlag?.enabled === true ? "on" : envConfig.mode);
  const autoThreshold =
    parsePositiveInteger(input.autoThresholdFlag?.value ?? undefined) ??
    envConfig.autoThreshold;

  return {
    ...envConfig,
    mode,
    autoThreshold,
    enabled: mode === "on",
  };
}

export function isEstimateEditorVirtualizationEnabled(
  config: Pick<EstimateEditorVirtualizationRuntimeConfig, "enabled" | "mode" | "autoThreshold">,
  itemCount: number
): boolean {
  if (config.mode === "on") return true;
  if (config.mode === "off") return false;
  const normalizedItemCount =
    Number.isFinite(itemCount) && itemCount > 0 ? Math.trunc(itemCount) : 0;
  return normalizedItemCount >= config.autoThreshold;
}
