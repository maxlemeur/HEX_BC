import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];

export const ESTIMATE_OUTLIER_FLAG_KEYS = [
  "price_outlier",
  "quantity_outlier",
] as const;

export type EstimateOutlierFlagKey = (typeof ESTIMATE_OUTLIER_FLAG_KEYS)[number];

export type EstimateOutlierMethod = "iqr" | "zscore";

export type EstimateOutlierDetectionConfig = {
  method: EstimateOutlierMethod;
  threshold: number;
  groupByCategory: boolean;
};

export type EstimateOutlierFlagsByItemId = Record<
  string,
  EstimateOutlierFlagKey[]
>;

const DEFAULT_THRESHOLD_BY_METHOD: Record<EstimateOutlierMethod, number> = {
  iqr: 1.5,
  zscore: 3,
};

function parseOutlierMethod(
  value: string | undefined | null
): EstimateOutlierMethod | null {
  if (value === "iqr" || value === "zscore") return value;
  return null;
}

function parsePositiveNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

const DEFAULT_METHOD_FROM_ENV =
  parseOutlierMethod(process.env.NEXT_PUBLIC_ESTIMATE_OUTLIER_METHOD) ?? "iqr";
const DEFAULT_THRESHOLD_FROM_ENV =
  parsePositiveNumber(process.env.NEXT_PUBLIC_ESTIMATE_OUTLIER_THRESHOLD) ??
  parsePositiveNumber(
    DEFAULT_METHOD_FROM_ENV === "iqr"
      ? process.env.NEXT_PUBLIC_ESTIMATE_OUTLIER_IQR_FACTOR
      : process.env.NEXT_PUBLIC_ESTIMATE_OUTLIER_ZSCORE_THRESHOLD
  );
const DEFAULT_GROUP_BY_CATEGORY_FROM_ENV =
  process.env.NEXT_PUBLIC_ESTIMATE_OUTLIER_GROUP_BY_CATEGORY === "false"
    ? false
    : true;

export const DEFAULT_ESTIMATE_OUTLIER_CONFIG: EstimateOutlierDetectionConfig = {
  method: DEFAULT_METHOD_FROM_ENV,
  threshold:
    DEFAULT_THRESHOLD_FROM_ENV ??
    DEFAULT_THRESHOLD_BY_METHOD[DEFAULT_METHOD_FROM_ENV],
  groupByCategory: DEFAULT_GROUP_BY_CATEGORY_FROM_ENV,
};

function toPositiveFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return value;
}

function quantile(sortedValues: number[], q: number) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const clampedQ = Math.min(Math.max(q, 0), 1);
  const index = (sortedValues.length - 1) * clampedQ;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0];
  const upper = sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1];

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const ratio = index - lowerIndex;
  return lower + (upper - lower) * ratio;
}

function normalizeConfig(
  config?: Partial<EstimateOutlierDetectionConfig>
): EstimateOutlierDetectionConfig {
  const method: EstimateOutlierMethod =
    config?.method === "zscore" ? "zscore" : "iqr";

  const fallbackThreshold = DEFAULT_THRESHOLD_BY_METHOD[method];
  const threshold =
    typeof config?.threshold === "number" &&
    Number.isFinite(config.threshold) &&
    config.threshold > 0
      ? config.threshold
      : fallbackThreshold;

  return {
    method,
    threshold,
    groupByCategory: config?.groupByCategory ?? DEFAULT_ESTIMATE_OUTLIER_CONFIG.groupByCategory,
  };
}

function isOutlierByIqr(value: number, values: number[], factor: number) {
  if (values.length < 4) return false;

  const sorted = [...values].sort((left, right) => left - right);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);

  if (q1 === null || q3 === null) return false;

  const iqr = q3 - q1;
  const lowerBound = q1 - factor * iqr;
  const upperBound = q3 + factor * iqr;

  return value < lowerBound || value > upperBound;
}

function isOutlierByZScore(value: number, values: number[], threshold: number) {
  if (values.length < 3) return false;

  const mean = values.reduce((sum, current) => sum + current, 0) / values.length;
  const variance =
    values.reduce((sum, current) => {
      const delta = current - mean;
      return sum + delta * delta;
    }, 0) / values.length;

  if (variance <= 0) return false;

  const stdDeviation = Math.sqrt(variance);
  if (!Number.isFinite(stdDeviation) || stdDeviation === 0) return false;

  const zScore = Math.abs((value - mean) / stdDeviation);
  return zScore > threshold;
}

function buildLineGroups(
  items: EstimateItem[],
  shouldGroupByCategory: boolean,
  hasCategories: boolean
) {
  const groups = new Map<string, EstimateItem[]>();
  const useCategoryGrouping = shouldGroupByCategory && hasCategories;

  items.forEach((item) => {
    if (item.item_type !== "line") return;

    const key = useCategoryGrouping
      ? (item.category_id ?? "__uncategorized__")
      : "__all__";

    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });

  return groups;
}

function appendFlag(
  result: EstimateOutlierFlagsByItemId,
  itemId: string,
  flag: EstimateOutlierFlagKey
) {
  const current = result[itemId] ?? [];
  if (current.includes(flag)) return;

  result[itemId] = [...current, flag];
}

export function detectEstimateOutliers(input: {
  items: EstimateItem[];
  categories?: EstimateCategory[];
  config?: Partial<EstimateOutlierDetectionConfig>;
}): EstimateOutlierFlagsByItemId {
  const config = normalizeConfig(input.config);
  const groups = buildLineGroups(
    input.items,
    config.groupByCategory,
    (input.categories?.length ?? 0) > 0
  );

  const flagsByItemId: EstimateOutlierFlagsByItemId = {};

  groups.forEach((groupItems) => {
    const unitPriceValues = groupItems
      .map((item) => ({
        itemId: item.id,
        value: toPositiveFiniteNumber(item.unit_price_ht_cents),
      }))
      .filter(
        (
          entry
        ): entry is {
          itemId: string;
          value: number;
        } => entry.value !== null
      );

    const quantityValues = groupItems
      .map((item) => ({
        itemId: item.id,
        value: toPositiveFiniteNumber(item.quantity),
      }))
      .filter(
        (
          entry
        ): entry is {
          itemId: string;
          value: number;
        } => entry.value !== null
      );

    const priceSample = unitPriceValues.map((entry) => entry.value);
    const quantitySample = quantityValues.map((entry) => entry.value);

    unitPriceValues.forEach((entry) => {
      const isOutlier =
        config.method === "iqr"
          ? isOutlierByIqr(entry.value, priceSample, config.threshold)
          : isOutlierByZScore(entry.value, priceSample, config.threshold);

      if (!isOutlier) return;
      appendFlag(flagsByItemId, entry.itemId, "price_outlier");
    });

    quantityValues.forEach((entry) => {
      const isOutlier =
        config.method === "iqr"
          ? isOutlierByIqr(entry.value, quantitySample, config.threshold)
          : isOutlierByZScore(entry.value, quantitySample, config.threshold);

      if (!isOutlier) return;
      appendFlag(flagsByItemId, entry.itemId, "quantity_outlier");
    });
  });

  return flagsByItemId;
}

export function withOutlierFlagDismissals(input: {
  detectedOutliersByItemId: EstimateOutlierFlagsByItemId;
  dismissedOutliersByItemId: EstimateOutlierFlagsByItemId;
}): EstimateOutlierFlagsByItemId {
  const result: EstimateOutlierFlagsByItemId = {};

  Object.entries(input.detectedOutliersByItemId).forEach(([itemId, flags]) => {
    const dismissed = new Set(input.dismissedOutliersByItemId[itemId] ?? []);
    const activeFlags = flags.filter((flag) => !dismissed.has(flag));
    if (activeFlags.length === 0) return;
    result[itemId] = activeFlags;
  });

  return result;
}

export function normalizeOutlierDismissedFlags(
  input: EstimateOutlierFlagsByItemId
): EstimateOutlierFlagsByItemId {
  const result: EstimateOutlierFlagsByItemId = {};

  Object.entries(input).forEach(([itemId, flags]) => {
    const normalized = flags.filter((flag, index) => {
      return ESTIMATE_OUTLIER_FLAG_KEYS.includes(flag) && flags.indexOf(flag) === index;
    });

    if (normalized.length === 0) return;
    result[itemId] = normalized;
  });

  return result;
}
