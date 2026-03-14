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

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="estimate-line-truth"
    >
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName("neutral")}`}
        title={lineTruth.source.detail ?? lineTruth.source.label}
      >
        {lineTruth.source.label}
      </span>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName(getQtyTone(lineTruth))}`}
        title={lineTruth.qtyStatus.detail ?? lineTruth.qtyStatus.label}
      >
        {lineTruth.qtyStatus.label}
      </span>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName(getConfidenceTone(lineTruth))}`}
        title={lineTruth.confidence.detail ?? `Confiance ${lineTruth.confidence.label}`}
      >
        Confiance {lineTruth.confidence.label}
      </span>
    </div>
  );
}
