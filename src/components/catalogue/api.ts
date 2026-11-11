function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/**
 * A refused request. `code` is the server's error code (for instance PRODUCT_VALIDATION_INCOMPLETE), so a
 * screen can tell one refusal from another without reading the sentence.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function readRequestError(response: Response, fallback: string) {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const record = asRecord(payload);
  const errorRecord = asRecord(record?.error);

  const code = errorRecord && typeof errorRecord.code === "string" ? errorRecord.code : null;

  const detailsRecord = asRecord(errorRecord?.details);
  if (detailsRecord && Array.isArray(detailsRecord.issues)) {
    const issues = detailsRecord.issues as Array<{ path?: string; message?: string }>;
    const formatted = issues
      .filter((i) => typeof i.message === "string" && i.message.length > 0)
      .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message!));
    if (formatted.length > 0) {
      return new ApiRequestError(formatted.join(" | "), response.status, code);
    }
  }

  const nestedMessage =
    errorRecord && typeof errorRecord.message === "string"
      ? errorRecord.message
      : null;

  const topLevelMessage =
    record && typeof record.message === "string" ? record.message : null;

  return new ApiRequestError(
    nestedMessage ?? topLevelMessage ?? `${fallback} (HTTP ${response.status})`,
    response.status,
    code,
  );
}

export async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    throw await readRequestError(response, "Requête API en échec.");
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);

  if (!record || record.ok !== true) {
    const errorRecord = asRecord(record?.error);
    const message =
      errorRecord && typeof errorRecord.message === "string"
        ? errorRecord.message
        : "Réponse API invalide.";

    throw new Error(message);
  }

  return record.data as T;
}
