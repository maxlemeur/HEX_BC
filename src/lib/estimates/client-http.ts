import { EstimateApiError, toErrorMessage, extractErrorDetails, extractErrorCode } from "@/lib/estimates/client-errors";
import { hasOwnProperty, toBooleanValue } from "@/lib/estimates/client-json";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import { getEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

export const ESTIMATE_VERSION_API_PATH_PATTERN =
  /^\/api\/estimates\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?]|$)/i;

export function withEstimateDraftLockSessionHeader(
  path: string,
  init: RequestInit
): RequestInit {
  const versionId = path.match(ESTIMATE_VERSION_API_PATH_PATTERN)?.[1];
  if (!versionId) return init;

  const headers: Record<string, string> =
    init.headers instanceof Headers || Array.isArray(init.headers)
      ? Object.fromEntries(new Headers(init.headers).entries())
      : { ...(init.headers ?? {}) };
  headers[ESTIMATE_DRAFT_LOCK_SESSION_HEADER] ??=
    getEstimateDraftLockSessionId(versionId);

  return {
    ...init,
    headers,
  };
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function unwrapSuccessfulEnvelopePayload(
  payload: unknown,
  fallbackMessage: string
): unknown {
  if (!isRecord(payload)) return payload;

  const hasOk = hasOwnProperty(payload, "ok");
  const isOk = toBooleanValue(payload.ok);
  if (hasOk && isOk === false) {
    throw new EstimateApiError(
      toErrorMessage(payload, fallbackMessage),
      200,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  if (hasOwnProperty(payload, "data")) {
    return payload.data;
  }

  return payload;
}

export async function requestJsonUncoordinated<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
  strictEnvelope = false
): Promise<T> {
  const requestInit = withEstimateDraftLockSessionHeader(path, init);
  const response = await fetch(path, {
    credentials: "same-origin",
    ...requestInit,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new EstimateApiError(
      toErrorMessage(payload, fallbackMessage),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  if (strictEnvelope && (!isRecord(payload) || payload.ok !== true || !hasOwnProperty(payload, "data"))) {
    throw new EstimateApiError(fallbackMessage, 503, undefined,
      (init.method ?? "GET") === "GET" ? "ESTIMATE_BATCH_READ_UNAVAILABLE" : "BATCH_OUTCOME_UNKNOWN");
  }

  const root = unwrapSuccessfulEnvelopePayload(payload, fallbackMessage);
  return root as T;
}

export function extractFilenameFromContentDisposition(
  contentDisposition: string | null
): string | null {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1]);
      return toNonEmptyString(decoded);
    } catch {
      return toNonEmptyString(utf8Match[1]);
    }
  }

  const asciiMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (!asciiMatch?.[1]) return null;
  return toNonEmptyString(asciiMatch[1]);
}
