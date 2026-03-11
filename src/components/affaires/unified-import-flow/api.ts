function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `Requete API en echec (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      const record = asRecord(payload);
      const nested = asRecord(record?.error);
      message =
        (nested && typeof nested.message === "string" ? nested.message : null) ??
        (record && typeof record.message === "string" ? record.message : null) ??
        message;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  if (!record || record.ok !== true) {
    const nested = asRecord(record?.error);
    const message =
      nested && typeof nested.message === "string"
        ? nested.message
        : "Reponse API invalide.";
    throw new Error(message);
  }

  return record.data as T;
}
