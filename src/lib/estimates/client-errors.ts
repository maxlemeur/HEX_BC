import { isRecord, toStringValue } from "@/lib/estimates/client-json";

export type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
  };
};

export class EstimateApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null
  ) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export function isEstimateApiError(error: unknown): error is EstimateApiError {
  return error instanceof EstimateApiError;
}

export function toErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length > 0) return trimmed;
  }

  if (!isRecord(payload)) return fallback;

  const envelope = payload as ApiEnvelope<unknown>;
  const candidates = [
    envelope.error?.message,
    envelope.error?.code,
    payload.message,
    payload.error,
    payload.details,
  ];

  for (const candidate of candidates) {
    const parsed = toStringValue(candidate);
    if (parsed) return parsed;
  }

  return fallback;
}

export function extractErrorDetails(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;

  const envelope = payload as ApiEnvelope<unknown>;

  if (envelope.error?.details !== undefined) {
    return envelope.error.details;
  }

  if (payload.details !== undefined) {
    return payload.details;
  }

  return payload;
}

export function extractErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const envelope = payload as ApiEnvelope<unknown>;
  return (
    toStringValue(envelope.error?.code) ??
    toStringValue(payload.code) ??
    null
  );
}
