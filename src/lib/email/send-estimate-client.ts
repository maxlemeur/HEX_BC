import {
  ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE,
  parseEstimateEmailSendResponse,
  type EstimateEmailRequestIdentity,
} from "@/lib/email/send-estimate-contract";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import type { SendEstimateInput } from "@/lib/estimates/schemas";

export class EstimateEmailSendError extends Error {
  constructor(message: string, readonly canStartNewRequest = false, readonly requiresDraftReview = false) {
    super(message);
    this.name = "EstimateEmailSendError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export async function sendEstimateEmailRequest(input: EstimateEmailRequestIdentity & {
  payload: SendEstimateInput;
  concurrencyToken?: string;
  draftLockSessionId?: string;
}) {
  let response: Response;
  try {
    response = await fetch(`/api/estimates/${input.versionId}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.requestId,
        ...(input.concurrencyToken ? { "If-Match": input.concurrencyToken } : {}),
        ...(input.draftLockSessionId ? {
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: input.draftLockSessionId,
        } : {}),
      },
      body: JSON.stringify(input.payload),
    });
  } catch {
    throw new EstimateEmailSendError(ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const root = record(body);
    const error = record(root?.error);
    const confirmedError = root?.ok === false && !("data" in root) &&
      typeof error?.message === "string" && error.message.trim().length > 0;
    const canStartNewRequest =
      confirmedError && (
      error.code === "ESTIMATE_EMAIL_PROVIDER_REJECTED" ||
      error?.code === "ESTIMATE_EMAIL_PDF_UNAVAILABLE" ||
      error?.code === "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST");
    // A conflict is not proof that another attempt with this identity is absent.
    // Keep its key and payload; only a reread draft may supply a new token.
    const requiresDraftReview = confirmedError && response.status === 409 && error?.code === "VERSION_CONFLICT";
    const message = typeof error?.message === "string" && error.message.trim()
      ? error.message : typeof root?.error === "string" && root.error.trim()
        ? root.error : ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE;
    throw new EstimateEmailSendError(message, canStartNewRequest, requiresDraftReview);
  }
  try {
    return parseEstimateEmailSendResponse(body, input);
  } catch {
    throw new EstimateEmailSendError(ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE);
  }
}
