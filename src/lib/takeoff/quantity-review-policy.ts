import { toUnitToken } from "@/lib/takeoff/units";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

/** Explicit quantity warnings; technical restrictions and unknown rules retain their protection. */
const QUANTITY_WARNING_CODES = new Set([
  "DN_NETWORK_NETWORK_MISSING", "DN_NETWORK_MATERIAL_MISSING", "DN_NETWORK_DN_MISSING", "DN_NETWORK_DN_NOT_IN_SERIES",
  "ZONE_OVERLAP_DUPLICATE", "ZONE_OVERLAP_UNREGISTERED", "ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN", "SCALE_DIMENSION_MISMATCH", "AREA_PRINTED_MISMATCH",
  "ROOM_OVERLAP", "CLOSED_BOX_LABEL", "CLOSED_BOX_SHAPE", "NON_OBSERVABLE_TO_ENTER",
]);

export function isQuantityWarning(code: string): boolean {
  return QUANTITY_WARNING_CODES.has(code);
}

/** Stored alternative readings are evidence; their difference always stays a recommendation. */
export function quantitySourceComparison(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const source = (metadata as Record<string, unknown>).quantity_source;
  if (!source || typeof source !== "object") return null;
  const value = source as Record<string, unknown>;
  const comparison = value.comparison;
  if (typeof value.group !== "string" || !comparison || typeof comparison !== "object") return null;
  const result = comparison as Record<string, unknown>;
  if (typeof result.vector_quantity !== "number" || !Number.isFinite(result.vector_quantity)
    || typeof result.model_quantity !== "number" || !Number.isFinite(result.model_quantity) || typeof result.unit !== "string") return null;
  return { group: value.group, vector: result.vector_quantity, model: result.model_quantity,
    delta: Math.round((result.vector_quantity - result.model_quantity) * 1000) / 1000, unit: result.unit };
}

/** TI-681: cents, with the relative threshold taken from this post's lot. */
export function financialReviewRecommended(postCents: number | null, lotCents: number | null): boolean | null {
  if (postCents === null || !Number.isSafeInteger(postCents) || postCents < 0) return null;
  if (postCents >= 100_000) return true;
  if (lotCents === null || !Number.isSafeInteger(lotCents) || lotCents <= 0) return null;
  return BigInt(postCents) * BigInt(100) >= BigInt(lotCents);
}

const METRES_PER_UNIT: Record<string, number> = { m: 1, ml: 1, metre: 1, metres: 1, metrelineaire: 1, metreslineaires: 1,
  cm: 0.01, mm: 0.001, km: 1000 };

/** Call on the raw total of one estimate line, never on its separate runs. */
export function commercialLengthQuantity(total: number, unit: string): number {
  if (!Number.isFinite(total) || total < 0) throw new Error("Quantité de longueur invalide.");
  const factor = METRES_PER_UNIT[normalizeMeasurementUnit(unit).unitCode ?? toUnitToken(unit)];
  return factor ? Math.ceil(total * factor) / factor : total;
}

export function quantityConfidence(score: number | null, reasons: readonly string[]): "high" | "medium" | "low" {
  if (score === null || score < 0.5 || reasons.some(reason => /illisible|peu lisible|non observable/i.test(reason))) return "low";
  return score < 0.8 || reasons.length > 0 ? "medium" : "high";
}
