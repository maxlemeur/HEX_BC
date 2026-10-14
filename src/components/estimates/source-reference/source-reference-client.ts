import { z } from "zod";

import {
  sourceReferenceErrorResponseSchema,
  sourceReferenceVerifiedCopySchema,
} from "@/lib/estimates/source-reference-contracts";

export class SourceReferenceRequestError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export async function sourceReferenceJson<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const failure = sourceReferenceErrorResponseSchema.safeParse(value);
    if (failure.success) throw new SourceReferenceRequestError(failure.data.error.code, failure.data.error.message);
    throw new Error("La réponse du serveur est illisible. Réessayez avec la même intention.");
  }
  const result = z.strictObject({ ok: z.literal(true), data: schema }).safeParse(value);
  if (!result.success) throw new Error("La réponse du serveur est incohérente. Aucune confirmation n’est déduite de cette réponse.");
  return result.data.data;
}

export async function readSourceReferencePdf(
  versionId: string,
  copy: z.infer<typeof sourceReferenceVerifiedCopySchema>,
  signal: AbortSignal
): Promise<Blob> {
  const response = await fetch(`/api/estimates/${versionId}/source-review/copies/${copy.copyId}/content`, {
    cache: "no-store", credentials: "same-origin", redirect: "error", signal,
  });
  if (!response.ok) {
    let value: unknown;
    try { value = await response.json(); } catch { value = null; }
    const failure = sourceReferenceErrorResponseSchema.safeParse(value);
    if (failure.success) throw new SourceReferenceRequestError(failure.data.error.code, failure.data.error.message);
    throw new Error("Source indisponible. La copie conservée n’a pas pu être consultée.");
  }
  if (response.status !== 200 || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/pdf" ||
    response.headers.get("Content-Length") !== String(copy.byteSize) || response.headers.get("X-Source-Reference-Sha256") !== copy.sha256) {
    throw new Error("Source indisponible. Les informations du document reçu ne correspondent pas à la copie conservée.");
  }
  const bytes = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException("Consultation annulée", "AbortError");
  if (bytes.byteLength !== copy.byteSize) throw new Error("Source indisponible. Le document reçu est incomplet.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== copy.sha256) throw new Error("Source indisponible. L’empreinte du document reçu ne correspond pas à la copie conservée.");
  return new Blob([bytes], { type: "application/pdf" });
}
