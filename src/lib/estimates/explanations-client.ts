import { z } from "zod";

import {
  estimateExplanationResponseSchema,
  type EstimateExplanationSnapshot,
} from "@/lib/estimates/explanation-schemas";
import { EstimateApiError } from "@/lib/estimates/client";

type JsonRecord = Record<string, unknown>;

const successEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: estimateExplanationResponseSchema,
});

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function requestExplanation(
  url: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<EstimateExplanationSnapshot> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    let message = fallbackMessage;
    let code: string | null = null;
    let details: unknown = null;

    if (isRecord(payload)) {
      if (isRecord(payload.error)) {
        message = toStringValue(payload.error.message) ?? fallbackMessage;
        code = toStringValue(payload.error.code);
        details = payload.error.details ?? null;
      } else {
        message = toStringValue(payload.message) ?? fallbackMessage;
        code = toStringValue(payload.code);
        details = payload.details ?? null;
      }
    }

    throw new EstimateApiError(message, response.status, details, code);
  }

  const parsed = successEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Reponse explication invalide.");
  }

  return parsed.data.data.explanation;
}

export async function fetchEstimateLineExplanation(
  versionId: string,
  lineId: string,
  options?: {
    detail?: boolean;
    signal?: AbortSignal;
  }
) {
  const query = new URLSearchParams();
  if (options?.detail) {
    query.set("detail", "1");
  }

  const suffix = query.toString();
  return requestExplanation(
    `/api/estimates/${versionId}/lines/${lineId}/explanation${suffix ? `?${suffix}` : ""}`,
    {
      method: "GET",
      signal: options?.signal,
    },
    "Impossible de charger l'explication de prix."
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

  return requestExplanation(
    `/api/estimates/${versionId}/delta-explanation?${query.toString()}`,
    {
      method: "GET",
      signal: options?.signal,
    },
    "Impossible de charger l'explication de delta."
  );
}
