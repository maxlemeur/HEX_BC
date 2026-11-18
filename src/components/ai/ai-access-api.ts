"use client";

import type {
  ApiKeyAccessState, ApiKeyModelsResult, ApiKeySaveResult, ApiKeyTestResult,
} from "@/lib/ai/access/contracts";

// The browser side of « Mon profil › Clé API ». The key is sent once, in the
// body of a same-origin PUT; no response, URL, cookie or storage carries it back.

const ROOT = "/api/ai-access/api-key";

export class AiAccessApiError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
    this.name = "AiAccessApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, {
    cache: "no-store", ...init, headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !body?.ok) {
    throw new AiAccessApiError(body?.error?.message ?? "La demande n’a pas abouti. Réessayez.", body?.error?.code ?? null, response.status);
  }
  return body.data as T;
}

export const aiAccessApi = {
  state: () => request<ApiKeyAccessState>(""),
  save: (key: string, testModel: string | null = null) => request<ApiKeySaveResult>("", {
    method: "PUT", body: JSON.stringify({ provider: "openai", key, testModel }),
  }),
  models: () => request<ApiKeyModelsResult>("/models"),
  test: (model: string) => request<ApiKeyTestResult>("/test", { method: "POST", body: JSON.stringify({ provider: "openai", model }) }),
  remove: () => request<ApiKeyAccessState>("", { method: "DELETE" }),
};

export function aiAccessErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "La demande n’a pas abouti. Réessayez.";
}

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** « 18/11/2026 14:32 ». */
export function formatAccessDate(iso: string) {
  return dateTime.format(new Date(iso));
}
