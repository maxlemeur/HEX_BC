export const LABOR_SPLIT_FEATURE_FLAG_KEY = "EST_031_LABOR_SPLIT";

export function normalizeFeatureFlagKey(value: string) {
  return value.trim().toUpperCase();
}
