import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, type SupabaseErrorLike } from "@/lib/estimates/errors";
import { coverageErrorCodeSchema } from "@/lib/estimates/source-coverage-contracts";
import { type SourceReferenceDeadline } from "@/lib/estimates/source-reference-http";

export const SOURCE_COVERAGE_HEADERS = { "Cache-Control": "private, no-store" };
type Code = z.infer<typeof coverageErrorCodeSchema>;
const errors: Record<Code, [ApiError["status"], string]> = {
  UNAUTHORIZED: [401, "Authentification requise."],
  SOURCE_COVERAGE_ACCESS_DENIED: [404, "Revue des exigences inaccessible."],
  SOURCE_COVERAGE_WRITE_FORBIDDEN: [403, "Cette modification de la revue n'est pas autorisée."],
  SOURCE_COVERAGE_INVALID_INPUT: [400, "Paramètres de revue des exigences invalides."],
  SOURCE_COVERAGE_PAYLOAD_TOO_LARGE: [413, "La demande dépasse la limite de 128 Kio."],
  SOURCE_COVERAGE_STALE: [409, "Les éléments examinés ont changé. Rechargez la revue avant de décider."],
  SOURCE_COVERAGE_BUSY: [409, "La revue est en cours de modification. Réessayez la même demande."],
  SOURCE_COVERAGE_IDEMPOTENCY_CONFLICT: [409, "Cette clé correspond à une autre demande."],
  SOURCE_COVERAGE_INCOMPLETE: [409, "Complétez le périmètre, les preuves et le rapprochement avant cette décision."],
  SOURCE_COVERAGE_INVALID_TARGET: [409, "Un lien ne désigne pas une prestation ou une entrée du registre utilisable."],
  SOURCE_COVERAGE_CITATION_NOT_VERIFIED: [409, "Vérifiez les passages dans la référence actuelle avant de décider."],
  SOURCE_COVERAGE_SOURCE_UNAVAILABLE: [409, "La copie conservée est indisponible ou ne correspond plus à sa vérification."],
  SOURCE_COVERAGE_REVISION_OVERFLOW: [409, "La limite de révision de cette revue est atteinte."],
  SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE: [503, "La vérification est temporairement indisponible. Réessayez la même demande."],
  INTERNAL_ERROR: [500, "Impossible de traiter la revue des exigences."],
};

export function coverageError(code: Code) {
  const [status, message] = errors[code];
  return new ApiError({ status, code, message });
}

export function mapCoverageRpcError(error: SupabaseErrorLike) {
  const code = coverageErrorCodeSchema.safeParse(error.message);
  if (code.success && code.data.startsWith("SOURCE_COVERAGE_") && ["42501", "22023", "P0001"].includes(error.code)) {
    return coverageError(code.data);
  }
  // The shared reference authorization remains authoritative within SQL.
  if (error.code === "42501" && error.message === "SOURCE_REVIEW_ACCESS_DENIED") return coverageError("SOURCE_COVERAGE_ACCESS_DENIED");
  if (["55P03", "40P01", "40001"].includes(error.code)) return coverageError("SOURCE_COVERAGE_BUSY");
  if (error.code === "" || /^08/.test(error.code) || ["PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRST202", "53300", "57014", "57P01", "57P02", "57P03"].includes(error.code)) {
    return coverageError("SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE");
  }
  return coverageError("INTERNAL_ERROR");
}

export function normalizeCoverageError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    const known = coverageErrorCodeSchema.safeParse(error.code);
    if (known.success) return coverageError(known.data);
    const mapping: Record<string, Code> = {
      FORBIDDEN: "SOURCE_COVERAGE_ACCESS_DENIED",
      SOURCE_REVIEW_ACCESS_DENIED: "SOURCE_COVERAGE_ACCESS_DENIED",
      SOURCE_REVIEW_WRITE_FORBIDDEN: "SOURCE_COVERAGE_WRITE_FORBIDDEN",
      SOURCE_REVIEW_STALE: "SOURCE_COVERAGE_STALE",
      SOURCE_REVIEW_COPY_NOT_VERIFIED: "SOURCE_COVERAGE_SOURCE_UNAVAILABLE",
      SOURCE_REVIEW_SOURCE_UNAVAILABLE: "SOURCE_COVERAGE_SOURCE_UNAVAILABLE",
      SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE: "SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE",
    };
    if (mapping[error.code]) return coverageError(mapping[error.code]);
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return coverageError("SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE");
  return coverageError("INTERNAL_ERROR");
}

export function coverageFailure(error: unknown) {
  const failure = normalizeCoverageError(error);
  return NextResponse.json({ ok: false, error: { code: failure.code, message: failure.message } }, { status: failure.status, headers: SOURCE_COVERAGE_HEADERS });
}

export function readCoverageQuery<T extends z.ZodType>(request: Request, schema: T, numericKeys: string[] = []): z.output<T> {
  const params = new URL(request.url).searchParams;
  const values: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (key in values) throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
    if (numericKeys.includes(key)) {
      if (!/^[1-9]\d*$/.test(value)) throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
      values[key] = Number(value);
    } else values[key] = value;
  }
  const result = schema.safeParse(values);
  if (!result.success) throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
  return result.data;
}

export async function readCoverageJson<T extends z.ZodType>(request: Request, schema: T, budget: SourceReferenceDeadline): Promise<z.output<T>> {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw coverageError("SOURCE_COVERAGE_WRITE_FORBIDDEN");
  if (new URL(request.url).searchParams.size || request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(128 * 1024);
  let length = 0;
  try {
    while (true) {
      const part = await budget.wait(reader.read());
      if (part.done) break;
      if (part.value.byteLength > bytes.length - length) throw coverageError("SOURCE_COVERAGE_PAYLOAD_TOO_LARGE");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw coverageError("SOURCE_COVERAGE_INVALID_INPUT"); }
    const result = schema.safeParse(body);
    if (!result.success) throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
    budget.check();
    return result.data;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
