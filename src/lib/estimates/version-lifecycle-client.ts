import { toNumber, toBooleanValue, getRootPayload, pickArray } from "@/lib/estimates/client-json";
import { requestJson } from "@/lib/estimates/client-requests";
import { parseEstimateStatusResponse } from "@/lib/estimates/write-response-contracts";
import type { EstimateStatus } from "@/lib/estimates/status";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

export type EstimateSendGatingFlag = {
  key: string;
  category?:
    | "documents"
    | "register"
    | "estimate_quality"
    | "pdf"
    | "approvals";
  severity: "blocking" | "warning";
  count: number;
  itemIds: string[];
  label: string;
  description: string;
  details?: Record<string, unknown>;
};

export type EstimateSendGatingResponse = {
  canSend: boolean;
  blockingFlags: EstimateSendGatingFlag[];
  warningFlags: EstimateSendGatingFlag[];
  stalePriceDays: number;
  checkedAt: string;
};

function parseEstimateSendGatingFlag(
  value: unknown
): EstimateSendGatingFlag | null {
  if (!isRecord(value)) return null;

  const key = toNonEmptyString(value.key);
  const categoryRaw = toNonEmptyString(value.category);
  const severityRaw = toNonEmptyString(value.severity);
  const count = toNumber(value.count);
  const label = toNonEmptyString(value.label);
  const description = toNonEmptyString(value.description);
  const itemIdsRaw = pickArray(value, ["item_ids", "itemIds"]);
  const itemIds = itemIdsRaw
    .map((itemId) => toNonEmptyString(itemId))
    .filter((itemId): itemId is string => Boolean(itemId));

  if (
    !key ||
    !severityRaw ||
    (severityRaw !== "blocking" && severityRaw !== "warning") ||
    count === null ||
    !label ||
    !description
  ) {
    return null;
  }

  return {
    key,
    category:
      categoryRaw === "documents" ||
      categoryRaw === "register" ||
      categoryRaw === "estimate_quality" ||
      categoryRaw === "pdf" ||
      categoryRaw === "approvals"
        ? categoryRaw
        : undefined,
    severity: severityRaw,
    count,
    itemIds,
    label,
    description,
    details: isRecord(value.details)
      ? (value.details as Record<string, unknown>)
      : undefined,
  };
}

function parseEstimateSendGatingResponse(
  payload: unknown
): EstimateSendGatingResponse | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const canSend = toBooleanValue(root.canSend) ?? toBooleanValue(root.can_send);
  const stalePriceDays =
    toNumber(root.stalePriceDays) ?? toNumber(root.stale_price_days);
  const checkedAt =
    toNonEmptyString(root.checkedAt) ?? toNonEmptyString(root.checked_at);
  const blockingRaw = pickArray(root, ["blockingFlags", "blocking_flags"]);
  const warningRaw = pickArray(root, ["warningFlags", "warning_flags"]);

  if (canSend === null || stalePriceDays === null || !checkedAt) {
    return null;
  }

  return {
    canSend,
    stalePriceDays,
    checkedAt,
    blockingFlags: blockingRaw
      .map((entry) => parseEstimateSendGatingFlag(entry))
      .filter((entry): entry is EstimateSendGatingFlag => entry !== null),
    warningFlags: warningRaw
      .map((entry) => parseEstimateSendGatingFlag(entry))
      .filter((entry): entry is EstimateSendGatingFlag => entry !== null),
  };
}

export async function updateEstimateStatus(
  versionId: string,
  status: EstimateStatus,
  updatedAtToken: string,
  options: { force?: boolean } = {}
): Promise<EstimateVersionRow> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        status,
        updated_at: updatedAtToken,
        force: options.force === true ? true : undefined,
      }),
    },
    "Impossible de mettre à jour le statut.",
    value => parseEstimateStatusResponse(value, versionId, status),
    { mutation: { versionId: versionId, structural: false } }
  );

  return payload.version;
}

export async function fetchEstimateSendGating(
  versionId: string
): Promise<EstimateSendGatingResponse> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/gating`,
    {
      method: "GET",
    },
    "Impossible de vérifier les préconditions d'envoi."
  );

  const root = getRootPayload(payload);
  const parsed = parseEstimateSendGatingResponse(
    isRecord(root) && root.gating !== undefined ? root.gating : root
  );

  if (!parsed) {
    throw new Error("Impossible de lire les préconditions d'envoi.");
  }

  return parsed;
}
