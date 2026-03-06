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
] as const;

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractActivityCenterLotLabel(
  metadata: unknown
): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  for (const key of LOT_LABEL_METADATA_KEYS) {
    const label = toTrimmedString(metadata[key]);
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
    toTrimmedString(planSet.name)
  );
}
