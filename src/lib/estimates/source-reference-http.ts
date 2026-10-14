import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, type SupabaseErrorLike } from "@/lib/estimates/errors";
import { sourceReferenceErrorCodeSchema } from "@/lib/estimates/source-reference-contracts";
import { SourceReferencePdfError } from "@/lib/estimates/source-reference-pdf";
import { SourceReferenceStorageError } from "@/lib/estimates/source-reference-storage";

type ErrorCode = z.infer<typeof sourceReferenceErrorCodeSchema>;
const ERRORS: Record<ErrorCode, [ApiError["status"], string]> = {
  UNAUTHORIZED: [401, "Authentification requise."],
  SOURCE_REVIEW_ACCESS_DENIED: [404, "Revue documentaire inaccessible."],
  SOURCE_REVIEW_INVALID_INPUT: [400, "Paramètres de revue documentaire invalides."],
  SOURCE_REVIEW_WRITE_FORBIDDEN: [403, "Cette écriture documentaire n'est pas autorisée."],
  SOURCE_REVIEW_PAYLOAD_TOO_LARGE: [413, "La demande dépasse la limite de 8 Kio."],
  SOURCE_REVIEW_INVALID_SOURCE: [422, "Le document doit être un PDF CCTP valide et non protégé."],
  SOURCE_REVIEW_PDF_LIMIT_EXCEEDED: [422, "Le PDF doit contenir au plus 200 pages et 50 Mio."],
  SOURCE_REVIEW_STALE: [409, "La revue a changé. Rechargez-la avant une nouvelle décision."],
  SOURCE_REVIEW_BUSY: [409, "La revue est en cours de modification. Réessayez la même demande."],
  SOURCE_REVIEW_COPY_NOT_VERIFIED: [409, "La copie doit être vérifiée avant confirmation."],
  SOURCE_REVIEW_REFERENCE_UNCHANGED: [409, "Cette copie est déjà la référence active."],
  SOURCE_REVIEW_IDEMPOTENCY_CONFLICT: [409, "Cette clé correspond à une autre demande."],
  SOURCE_REVIEW_SOURCE_UNAVAILABLE: [409, "La copie conservée est indisponible ou ne correspond plus à sa vérification."],
  SOURCE_REVIEW_REVISION_OVERFLOW: [409, "La limite de révision de cette revue est atteinte."],
  SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE: [503, "La revue documentaire est temporairement indisponible. Réessayez la même demande."],
  INTERNAL_ERROR: [500, "Impossible de traiter la revue documentaire."],
};

export const SOURCE_REFERENCE_HEADERS = { "Cache-Control": "private, no-store" };
export function sourceReferenceError(code: ErrorCode): ApiError {
  const [status, message] = ERRORS[code];
  return new ApiError({ status, code, message });
}

export function mapSourceReferenceRpcError(error: SupabaseErrorLike): ApiError {
  const known = sourceReferenceErrorCodeSchema.safeParse(error.message);
  if (known.success && known.data.startsWith("SOURCE_REVIEW_") && ["42501", "22023", "P0001"].includes(error.code)) return sourceReferenceError(known.data);
  if (error.code === "" || /^08/.test(error.code) || ["PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRST202", "53300", "57014", "57P01", "57P02", "57P03"].includes(error.code)) return sourceReferenceError("SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE");
  return sourceReferenceError("INTERNAL_ERROR");
}

export function normalizeSourceReferenceError(error: unknown, conserved = false): ApiError {
  if (error instanceof ApiError) {
    const code = sourceReferenceErrorCodeSchema.safeParse(error.code);
    if (code.success) return sourceReferenceError(code.data);
    if (error.code === "FORBIDDEN") return sourceReferenceError("SOURCE_REVIEW_ACCESS_DENIED");
  }
  if (error instanceof SourceReferencePdfError) {
    if (["PDF_TIMEOUT", "PDF_ABORTED", "PDF_WORKER_FAILURE"].includes(error.code)) return sourceReferenceError("SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE");
    if (error.code === "PDF_WORKER_PROTOCOL") return sourceReferenceError("INTERNAL_ERROR");
    if (conserved) return sourceReferenceError("SOURCE_REVIEW_SOURCE_UNAVAILABLE");
    return sourceReferenceError(["PDF_TOO_LARGE", "PDF_PAGE_LIMIT"].includes(error.code) ? "SOURCE_REVIEW_PDF_LIMIT_EXCEEDED" : "SOURCE_REVIEW_INVALID_SOURCE");
  }
  if (error instanceof SourceReferenceStorageError) {
    if (error.code === "STORAGE_ACCESS_DENIED") return sourceReferenceError("SOURCE_REVIEW_ACCESS_DENIED");
    if (error.code === "STORAGE_SOURCE_UNAVAILABLE") return sourceReferenceError("SOURCE_REVIEW_SOURCE_UNAVAILABLE");
    if (error.code === "STORAGE_TOO_LARGE") return sourceReferenceError(conserved ? "SOURCE_REVIEW_SOURCE_UNAVAILABLE" : "SOURCE_REVIEW_PDF_LIMIT_EXCEEDED");
    if (error.code === "STORAGE_INVALID_SCOPE") return sourceReferenceError("INTERNAL_ERROR");
    return sourceReferenceError("SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE");
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return sourceReferenceError("SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE");
  return sourceReferenceError("INTERNAL_ERROR");
}

export function assertSourceReferenceQueryEmpty(request: Request) {
  if (new URL(request.url).searchParams.size) throw sourceReferenceError("SOURCE_REVIEW_INVALID_INPUT");
}

export function createSourceReferenceDeadline(request: Request, milliseconds: number) {
  const controller = new AbortController();
  const deadline = performance.now() + milliseconds;
  const timer = setTimeout(() => controller.abort(), milliseconds);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const check = () => {
    if (signal.aborted || performance.now() >= deadline) throw sourceReferenceError("SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE");
  };
  async function wait<T>(task: PromiseLike<T>): Promise<T> {
    check();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(sourceReferenceError("SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      Promise.resolve(task).then((value) => {
        try { check(); resolve(value); } catch (error) { reject(error); }
      }, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
  return { signal, check, wait, dispose: () => { clearTimeout(timer); controller.abort(); } };
}
export type SourceReferenceDeadline = ReturnType<typeof createSourceReferenceDeadline>;

export async function readSourceReferenceJson<T extends z.ZodType>(request: Request, schema: T, budget: SourceReferenceDeadline): Promise<z.output<T>> {
  const origin = request.headers.get("origin");
  const sameOrigin = origin === new URL(request.url).origin;
  if (!sameOrigin) throw sourceReferenceError("SOURCE_REVIEW_WRITE_FORBIDDEN");
  assertSourceReferenceQueryEmpty(request);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) throw sourceReferenceError("SOURCE_REVIEW_INVALID_INPUT");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(8192);
  let length = 0;
  try {
    while (true) {
      const part = await budget.wait(reader.read());
      if (part.done) break;
      if (part.value.byteLength > bytes.length - length) throw sourceReferenceError("SOURCE_REVIEW_PAYLOAD_TOO_LARGE");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw sourceReferenceError("SOURCE_REVIEW_INVALID_INPUT"); }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw sourceReferenceError("SOURCE_REVIEW_INVALID_INPUT");
    budget.check();
    return parsed.data;
  } finally {
    // Cancel immediately, but never wait for an untrusted sender to acknowledge.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function sourceReferenceFailure(error: unknown) {
  const failure = normalizeSourceReferenceError(error);
  return NextResponse.json({ ok: false, error: { code: failure.code, message: failure.message } }, { status: failure.status, headers: SOURCE_REFERENCE_HEADERS });
}

export function sourceReferencePdfDisposition(fileName: string) {
  const safeName = fileName.replace(/[\r\n\x00-\x1f\x7f]/g, "").toWellFormed().slice(0, 180).toWellFormed();
  const ascii = safeName.replace(/[^a-zA-Z0-9._ -]/g, "_") || "reference.pdf";
  const encoded = encodeURIComponent(safeName || "reference.pdf").replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
