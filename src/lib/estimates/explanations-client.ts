import { z } from "zod";

import {
  estimateExplanationResponseSchema,
  priceExplanationGeneratedResponseSchema,
  priceExplanationReadResponseSchema,
  priceExplanationSettingsSchema,
  type PriceExplanationGeneration,
} from "@/lib/estimates/explanation-schemas";
import { EstimateApiError } from "@/lib/estimates/client-errors";
import { jsonRequest } from "@/lib/estimates/client-http";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

async function requestExplanation<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  fallbackMessage: string
): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    let message = fallbackMessage;
    let code: string | null = null;
    let details: unknown = null;

    if (isRecord(payload)) {
      if (isRecord(payload.error)) {
        message = toNonEmptyString(payload.error.message) ?? fallbackMessage;
        code = toNonEmptyString(payload.error.code);
        details = payload.error.details ?? null;
      } else {
        message = toNonEmptyString(payload.message) ?? fallbackMessage;
        code = toNonEmptyString(payload.code);
        details = payload.details ?? null;
      }
    }

    throw new EstimateApiError(message, response.status, details, code);
  }

  const parsed = z.object({ ok: z.literal(true), data: schema }).safeParse(payload);
  if (!parsed.success) {
    throw new Error("Réponse explication invalide.");
  }

  return parsed.data.data;
}

function priceExplanationUrl(versionId: string, lineId: string) {
  return `/api/estimates/${versionId}/lines/${lineId}/explanation`;
}

export async function fetchEstimateLineExplanation(
  versionId: string,
  lineId: string,
  options?: {
    detail?: boolean;
    signal?: AbortSignal;
  }
) {
  return requestExplanation(
    `${priceExplanationUrl(versionId, lineId)}${options?.detail ? "?detail=1" : ""}`,
    {
      method: "GET",
      cache: "no-store",
      signal: options?.signal,
    },
    priceExplanationReadResponseSchema,
    "Impossible de charger l'explication de prix."
  );
}

export function refreshEstimateLineExplanationSettings(versionId: string, lineId: string) {
  return requestExplanation(
    `${priceExplanationUrl(versionId, lineId)}/options`,
    { method: "POST" },
    priceExplanationSettingsSchema,
    "Impossible d’actualiser les modèles du forfait ChatGPT."
  );
}

export function generateEstimateLineExplanation(versionId: string, lineId: string, settings: PriceExplanationGeneration) {
  return requestExplanation(
    priceExplanationUrl(versionId, lineId),
    jsonRequest("POST", settings),
    priceExplanationGeneratedResponseSchema,
    "Impossible de générer l’explication de prix."
  );
}

export async function fetchEstimateDeltaExplanation(
  versionId: string,
  compareVersionId: string,
  options?: {
    detail?: boolean;
    signal?: AbortSignal;
  }
) {
  const query = new URLSearchParams({
    compare_version_id: compareVersionId,
  });
  if (options?.detail) {
    query.set("detail", "1");
  }

  const { explanation } = await requestExplanation(
    `/api/estimates/${versionId}/delta-explanation?${query.toString()}`,
    {
      method: "GET",
      signal: options?.signal,
    },
    estimateExplanationResponseSchema,
    "Impossible de charger l'explication de delta."
  );
  return explanation;
}
