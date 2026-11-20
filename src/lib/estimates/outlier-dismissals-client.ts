import { getRootPayload } from "@/lib/estimates/client-json";
import { requestJson } from "@/lib/estimates/client-requests";
import type { EstimateOutlierFlagKey, EstimateOutlierFlagsByItemId } from "@/lib/estimates/outlier-detection";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

export type ToggleEstimateOutlierDismissPayload = {
  itemId: string;
  flagKey: EstimateOutlierFlagKey;
  dismissed: boolean;
};

function isEstimateOutlierFlagKey(value: unknown): value is EstimateOutlierFlagKey {
  return value === "price_outlier" || value === "quantity_outlier";
}

function normalizeOutlierDismissedByItemId(
  payload: unknown
): EstimateOutlierFlagsByItemId {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return {};

  const mapCandidate = root.dismissed_by_item_id ?? root.dismissedByItemId;
  if (isRecord(mapCandidate)) {
    const parsedMap: EstimateOutlierFlagsByItemId = {};
    Object.entries(mapCandidate).forEach(([itemId, value]) => {
      if (!Array.isArray(value)) return;
      const flags = value.filter((entry): entry is EstimateOutlierFlagKey =>
        isEstimateOutlierFlagKey(entry)
      );
      if (flags.length === 0) return;
      parsedMap[itemId] = flags;
    });
    return parsedMap;
  }

  const dismissals = Array.isArray(root.dismissals) ? root.dismissals : [];
  const parsedMap: EstimateOutlierFlagsByItemId = {};

  dismissals.forEach((dismissal) => {
    if (!isRecord(dismissal)) return;
    const itemId =
      toNonEmptyString(dismissal.item_id) ??
      toNonEmptyString(dismissal.itemId);
    const flagKeyRaw =
      toNonEmptyString(dismissal.flag_key) ??
      toNonEmptyString(dismissal.flagKey);

    if (!itemId || !flagKeyRaw || !isEstimateOutlierFlagKey(flagKeyRaw)) {
      return;
    }

    const current = parsedMap[itemId] ?? [];
    if (current.includes(flagKeyRaw)) return;
    parsedMap[itemId] = [...current, flagKeyRaw];
  });

  return parsedMap;
}

export async function fetchEstimateOutlierDismissedFlags(
  versionId: string
): Promise<EstimateOutlierFlagsByItemId> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/outliers`,
    {
      method: "GET",
    },
    "Impossible de charger les valeurs atypiques acceptées."
  );

  return normalizeOutlierDismissedByItemId(payload);
}

export async function toggleEstimateOutlierDismissedFlag(
  versionId: string,
  input: ToggleEstimateOutlierDismissPayload
): Promise<EstimateOutlierFlagsByItemId> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/outliers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item_id: input.itemId,
        flag_key: input.flagKey,
        dismissed: input.dismissed,
      }),
    },
    "Impossible de mettre à jour le statut d'acceptation de l'outlier."
  );

  return normalizeOutlierDismissedByItemId(payload);
}
