import { isRecord, toNonEmptyString } from "@/lib/value-guards";

type PlanSetLike = {
  name: string | null | undefined;
  metadata?: Record<string, unknown> | null;
};

const LOT_LABEL_METADATA_KEYS = [
  "lotLabel",
  "lot_label",
  "lot",
  "lotName",
  "lot_name",
  "tradeLabel",
  "trade_label",
  "scopeLabel",
  "scope_label",
] as const;export function extractActivityCenterLotLabel(
  metadata: unknown
): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  for (const key of LOT_LABEL_METADATA_KEYS) {
    const label = toNonEmptyString(metadata[key]);
    if (label) {
      return label;
    }
  }

  return null;
}

export function resolveActivityCenterLotLabel(
  planSet: PlanSetLike
): string | null {
  return (
    extractActivityCenterLotLabel(planSet.metadata) ??
    toNonEmptyString(planSet.name)
  );
}
