import type { ItemAnswerView } from "@/lib/takeoff/item-table";
import { formatItemQuantity } from "@/lib/takeoff/item-table-labels";
import { describeStoredPosteReason } from "@/lib/takeoff/poste-aggregation";
import { MEASUREMENT_UNITS, normalizeMeasurementUnit } from "@/lib/units/normalize";

export const MISSING_ITEM_REASON = "Motif non conservé dans cette lecture";

export function describeItemUncertainty(answer: ItemAnswerView, expectedUnit: string | null, canReview: boolean) {
  const reasons = answer.uncertainty?.reasons.length ? answer.uncertainty.reasons : answer.reasonCode || answer.reasonText
    ? [{ code: answer.reasonCode ?? "", text: answer.reasonText, by: "model" as const, page: null }] : [];
  const has = (code: string) => reasons.some((reason) => reason.code === code);
  // Where a figure disappeared, put the mismatch beside the model's explanation.
  const obstacle = !answer.candidate ? reasons.find(({ by, code }) => by === "worker" && code !== "PAGES_UNREADABLE") : undefined;
  const primary = obstacle ?? reasons[0];
  const textOf = ({ code, text }: (typeof reasons)[number]) => text?.trim() || describeStoredPosteReason(code);
  const texts = [...new Set([primary, ...reasons].flatMap((reason) => reason ? textOf(reason) ?? [] : []))];
  const partial = answer.uncertainty?.partial || has("PARTIAL_QUANTITY") || answer.unreadablePages.length > 0;
  const candidate = answer.candidate ? `Quantité provisoire${partial ? " partielle" : ""} · ${formatItemQuantity(answer.candidate.quantity,
    answer.candidate.unit)}` : null;
  const scale = reasons.find(({ code }) => code === "SCALE_UNKNOWN");
  const qualifier = reasons.find(({ code }) => code === "QUALIFIER_UNREADABLE");
  const page = scale?.page ?? qualifier?.page ?? primary?.page ?? answer.unreadablePages[0]
    ?? answer.observations.find((entry) => entry.page !== null)?.page ?? null;
  const { unitCode } = normalizeMeasurementUnit(answer.candidate?.unit ?? expectedUnit);
  const count = MEASUREMENT_UNITS.some((unit) => unit.code === unitCode && unit.dimension === "count")
    && (answer.observations.some(({ method }) => method === "symbol_count") || has("NON_INTEGER_COUNT"));
  const action = canReview && has("NOT_OBSERVABLE") ? "enter" : canReview && scale ? "prepare"
    : canReview && !qualifier && !scale && count && answer.unreadablePages.length === 0 ? "count" : "check";
  const pageLabel = page === null ? "" : ` · page ${page}`;
  return { candidate, obstacle: texts[0] ?? MISSING_ITEM_REASON, reasons: texts, page, action,
    label: action === "enter" ? "Saisir une quantité justifiée" : action === "prepare" ? "Renseigner une échelle ou une cote"
      : action === "count" ? `Compter les repères${pageLabel}` : `Vérifier le plan${pageLabel}` };
}

export const itemScalePreparationHref = (projectId: string) => `/dashboard/affaires/${projectId}/takeoff?launch=1`;
