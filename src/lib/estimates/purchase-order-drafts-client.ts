import { hasOwnProperty } from "@/lib/estimates/client-json";
import { EstimateApiError, toErrorMessage, extractErrorDetails, extractErrorCode } from "@/lib/estimates/client-errors";
import { jsonRequest } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import type { EstimatePurchaseOrderDraftPreparation, CreateEstimatePurchaseOrderDraftsInput, EstimatePurchaseOrderDraftCreationResult } from "@/lib/estimates/purchase-order-draft-contracts";
import { isRecord } from "@/lib/value-guards";

export async function fetchEstimatePurchaseOrderDraftPreparation(
  versionId: string
): Promise<EstimatePurchaseOrderDraftPreparation> {
  const { parseEstimatePurchaseOrderDraftPreparation } = await import("@/lib/estimates/purchase-order-draft-contracts");
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/purchase-order-drafts`,
    {
      method: "GET",
    },
    "Impossible de préparer les brouillons de commandes."
  );

  const parsed = parseEstimatePurchaseOrderDraftPreparation(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la préparation des brouillons de commandes.");
  }

  return parsed;
}

export async function createEstimatePurchaseOrderDrafts(
  versionId: string,
  input: CreateEstimatePurchaseOrderDraftsInput
): Promise<EstimatePurchaseOrderDraftCreationResult> {
  const { parseEstimatePurchaseOrderDraftCreationResult } = await import("@/lib/estimates/purchase-order-draft-contracts");
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/purchase-order-drafts`,
    jsonRequest("POST", {
      idempotency_key: input.idempotencyKey,
      reviewed_lines: input.reviewedLines.map((line) => ({
        item_id: line.itemId,
        review_fingerprint: line.reviewFingerprint,
      })),
      groups: input.groups.map((group) => ({
        supplier_id: group.supplierId,
        delivery_site_id: group.deliverySiteId,
        delivery_site_updated_at: group.deliverySiteUpdatedAt,
        item_ids: group.itemIds,
        expected_delivery_date: group.expectedDeliveryDate ?? null,
        notes: group.notes ?? null,
      })),
    }),
    "Impossible de créer les brouillons de commandes."
  );

  const parsed = parseEstimatePurchaseOrderDraftCreationResult(payload);
  if (!parsed || parsed.sourceVersionId !== versionId || parsed.idempotencyKey !== input.idempotencyKey) {
    throw new Error("Impossible de lire le résultat de création des brouillons.");
  }

  return parsed;
}

export async function fetchEstimatePurchaseOrderDraftReceipt(
  versionId: string,
  idempotencyKey: string
): Promise<EstimatePurchaseOrderDraftCreationResult | null> {
  const { parseEstimatePurchaseOrderDraftCreationResult } = await import("@/lib/estimates/purchase-order-draft-contracts");
  const query = new URLSearchParams({ idempotency_key: idempotencyKey });
  const response = await fetch(
    `/api/estimates/${versionId}/purchase-order-drafts?${query.toString()}`,
    { method: "GET", cache: "no-store", credentials: "same-origin" }
  );
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("La réponse de vérification est illisible. Vérifiez à nouveau la préparation.");
  }
  if (!response.ok) {
    throw new EstimateApiError(
      toErrorMessage(envelope, "Impossible de vérifier le résultat de la préparation."),
      response.status,
      extractErrorDetails(envelope),
      extractErrorCode(envelope)
    );
  }
  if (!isRecord(envelope) || envelope.ok !== true || !hasOwnProperty(envelope, "data")) {
    throw new Error("La réponse de vérification est illisible. Vérifiez à nouveau la préparation.");
  }
  const payload = envelope.data;
  if (payload === null) return null;
  const parsed = parseEstimatePurchaseOrderDraftCreationResult(payload);
  if (!parsed || parsed.sourceVersionId !== versionId || parsed.idempotencyKey !== idempotencyKey) {
    throw new Error("Impossible de lire le reçu de la préparation.");
  }
  return parsed;
}
