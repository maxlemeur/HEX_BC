"use client";

import { resolveEstimateLineTruth } from "@/lib/estimates/line-truth";
import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";

type Tone = "neutral" | "warning" | "danger" | "success";

const TONE_SEVERITY: Record<Tone, number> = {
  success: 0,
  neutral: 1,
  warning: 2,
  danger: 3,
};

function getToneClassName(tone: Tone) {
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
      return "Ouvrage";
    case "mixed":
      return "Mixte";
    default:
      return "Source ?";
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

  const qtyTone = getQtyTone(lineTruth);
  const confidenceTone = getConfidenceTone(lineTruth);
  const tone =
    TONE_SEVERITY[qtyTone] >= TONE_SEVERITY[confidenceTone]
      ? qtyTone
      : confidenceTone;
  const confidenceLabel = `Confiance ${lineTruth.confidence.label}`;
  const fullLabel = `${lineTruth.source.label} — ${lineTruth.qtyStatus.label} — ${confidenceLabel}`;
  const tooltip = [
    lineTruth.source.detail ?? lineTruth.source.label,
    lineTruth.qtyStatus.detail ?? lineTruth.qtyStatus.label,
    lineTruth.confidence.detail ?? confidenceLabel,
  ].join("\n");

  return (
    <div
      className="estimate-line-truth"
      data-testid="estimate-line-truth"
    >
      <span
        className={`estimate-line-truth__badge inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getToneClassName(tone)}`}
        title={tooltip}
      >
        <span className="sr-only">{fullLabel}</span>
        <span aria-hidden="true">{getCompactSourceLabel(lineTruth)}</span>
      </span>
    </div>
  );
}
