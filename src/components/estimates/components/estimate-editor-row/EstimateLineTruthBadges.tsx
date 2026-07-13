"use client";

import { resolveEstimateLineTruth } from "@/lib/estimates/line-truth";
import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";

function getToneClassName(
  tone: "neutral" | "warning" | "danger" | "success"
) {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function getQtyTone(item: NonNullable<ReturnType<typeof resolveEstimateLineTruth>>) {
  switch (item.qtyStatus.code) {
    case "measured":
      return "success" as const;
    case "missing":
    case "to_confirm":
      return "danger" as const;
    default:
      return "warning" as const;
  }
}

function getConfidenceTone(item: NonNullable<ReturnType<typeof resolveEstimateLineTruth>>) {
  switch (item.confidence.label) {
    case "forte":
      return "success" as const;
    case "faible":
      return "danger" as const;
    default:
      return "warning" as const;
  }
}

function getCompactSourceLabel(
  item: NonNullable<ReturnType<typeof resolveEstimateLineTruth>>
) {
  switch (item.source.kind) {
    case "manual":
      return "Manuelle";
    case "dpgf":
      return "DPGF";
    case "plan":
      return "Métré";
    case "brief":
      return "Brief";
    case "cctp":
      return "CCTP";
    case "assembly":
      return "Assemblage";
    case "mixed":
      return "Mixte";
    default:
      return "Source ?";
  }
}

function getCompactQtyLabel(
  item: NonNullable<ReturnType<typeof resolveEstimateLineTruth>>
) {
  switch (item.qtyStatus.code) {
    case "imported_unverified":
      return "Qté import.";
    case "measured":
      return "Qté métré";
    case "assumed":
      return "Qté supp.";
    case "provisional":
      return "Qté provis.";
    case "to_confirm":
      return "À confirmer";
    default:
      return "Qté absente";
  }
}

type EstimateLineTruthBadgesProps = {
  item: EstimateItem;
};

export function EstimateLineTruthBadges({
  item,
}: EstimateLineTruthBadgesProps) {
  const lineTruth = resolveEstimateLineTruth(item);
  if (!lineTruth) {
    return null;
  }

  const confidenceLabel = `Confiance ${lineTruth.confidence.label}`;

  return (
    <div
      className="estimate-line-truth"
      data-testid="estimate-line-truth"
    >
      <span
        className={`estimate-line-truth__badge inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName("neutral")}`}
        title={lineTruth.source.detail ?? lineTruth.source.label}
      >
        <span className="sr-only">{lineTruth.source.label}</span>
        <span className="estimate-line-truth__label-full" aria-hidden="true">
          {lineTruth.source.label}
        </span>
        <span className="estimate-line-truth__label-compact" aria-hidden="true">
          {getCompactSourceLabel(lineTruth)}
        </span>
      </span>
      <span
        className={`estimate-line-truth__badge inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName(getQtyTone(lineTruth))}`}
        title={lineTruth.qtyStatus.detail ?? lineTruth.qtyStatus.label}
      >
        <span className="sr-only">{lineTruth.qtyStatus.label}</span>
        <span className="estimate-line-truth__label-full" aria-hidden="true">
          {lineTruth.qtyStatus.label}
        </span>
        <span className="estimate-line-truth__label-compact" aria-hidden="true">
          {getCompactQtyLabel(lineTruth)}
        </span>
      </span>
      <span
        className={`estimate-line-truth__badge inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName(getConfidenceTone(lineTruth))}`}
        title={lineTruth.confidence.detail ?? confidenceLabel}
      >
        <span className="sr-only">{confidenceLabel}</span>
        <span className="estimate-line-truth__label-full" aria-hidden="true">
          {confidenceLabel}
        </span>
        <span className="estimate-line-truth__label-compact" aria-hidden="true">
          Conf. {lineTruth.confidence.label === "moyenne" ? "moy." : lineTruth.confidence.label}
        </span>
      </span>
    </div>
  );
}
