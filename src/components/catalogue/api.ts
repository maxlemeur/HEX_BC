function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

async function extractErrorMessage(response: Response, fallback: string) {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const record = asRecord(payload);
  const errorRecord = asRecord(record?.error);

  const detailsRecord = asRecord(errorRecord?.details);
  if (detailsRecord && Array.isArray(detailsRecord.issues)) {
    const issues = detailsRecord.issues as Array<{ path?: string; message?: string }>;
    const formatted = issues
      .filter((i) => typeof i.message === "string" && i.message.length > 0)
      .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message!));
    if (formatted.length > 0) {
      return formatted.join(" | ");
    }
  }

  const nestedMessage =
    errorRecord && typeof errorRecord.message === "string"
      ? errorRecord.message
      : null;

  const topLevelMessage =
    record && typeof record.message === "string" ? record.message : null;

  return nestedMessage ?? topLevelMessage ?? `${fallback} (HTTP ${response.status})`;
}

export async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Requete API en echec."));
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);

  if (!record || record.ok !== true) {
    const errorRecord = asRecord(record?.error);
    const message =
      errorRecord && typeof errorRecord.message === "string"
        ? errorRecord.message
        : "Reponse API invalide.";

    throw new Error(message);
  }

  return record.data as T;
}
