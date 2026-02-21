export const ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE = 56;
export const ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN = 8;

export type EstimateEditorVirtualizationEnv = {
  enabled?: string;
  rowEstimate?: string;
  overscan?: string;
  maxHeight?: string;
};

export type EstimateEditorVirtualizationRuntimeConfig = {
  enabled: boolean;
  rowEstimate: number;
  overscan: number;
  maxHeight?: number;
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

export function resolveEstimateEditorVirtualizationConfig(
  env: EstimateEditorVirtualizationEnv
): EstimateEditorVirtualizationRuntimeConfig {
  const rowEstimate =
    parsePositiveInteger(env.rowEstimate) ??
    ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_ROW_ESTIMATE;
  const overscan =
    parsePositiveInteger(env.overscan) ??
    ESTIMATE_EDITOR_VIRTUALIZATION_DEFAULT_OVERSCAN;
  const maxHeight = parsePositiveInteger(env.maxHeight);

  const config: EstimateEditorVirtualizationRuntimeConfig = {
    enabled: parseBooleanFeatureFlag(env.enabled),
    rowEstimate,
    overscan,
  };
  if (maxHeight !== null) {
    config.maxHeight = maxHeight;
  }
  return config;
}
