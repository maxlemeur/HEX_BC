"use client";

import { useMemo } from "react";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConfidenceHeaderProps = {
  globalConfidence: number | null;
  items: ReviewItem[];
};

type ConfidenceBucket = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfidenceColor(pct: number): string {
  if (pct >= 80) return "var(--success)";
  if (pct >= 50) return "var(--warning)";
  return "var(--danger)";
}

function getConfidenceLabel(pct: number | null): string {
  if (pct === null) {
    return "Score global non calculé. Traitez les résultats comme non évalués.";
  }
  if (pct >= 80) {
    return "Score d’extraction élevé. Contrôlez tout de même les preuves avant application.";
  }
  if (pct >= 50) {
    return "Score d’extraction moyen. Vérifiez en priorité les lignes signalées.";
  }
  return "Score d’extraction faible. Une revue humaine approfondie est requise.";
}

function bucketItem(confidence: number | null): ConfidenceBucket {
  if (confidence === null) return "low";
  const pct = confidence * 100;
  if (pct >= 80) return "high";
  if (pct >= 50) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// SVG Circular Gauge
// ---------------------------------------------------------------------------

function CircularGauge({ value }: { value: number | null }) {
  const radius = 36;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const progress = value === null ? 0 : (value / 100) * circumference;
  const color = value === null ? "var(--slate-400)" : getConfidenceColor(value);

  return (
    <svg
      width={92}
      height={92}
      viewBox="0 0 92 92"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      {/* Background circle */}
      <circle
        cx={46}
        cy={46}
        r={radius}
        fill="none"
        stroke="var(--slate-200)"
        strokeWidth={stroke}
      />
      {/* Progress arc */}
      <circle
        cx={46}
        cy={46}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${circumference - progress}`}
        strokeDashoffset={circumference * 0.25}
        className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
      />
      {/* Percentage text */}
      <text
        x={46}
        y={46}
        textAnchor="middle"
        dominantBaseline="central"
        className="text-lg font-bold"
        fill={color}
      >
        {value === null ? "—" : `${value}%`}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Distribution Bar
// ---------------------------------------------------------------------------

function DistributionBar({
  high,
  medium,
  low,
  total,
}: {
  high: number;
  medium: number;
  low: number;
  total: number;
}) {
  if (total === 0) return null;

  const highPct = (high / total) * 100;
  const mediumPct = (medium / total) * 100;
  const lowPct = (low / total) * 100;

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--slate-100)]"
        role="img"
        aria-label={`Distribution des items inclus : ${high} à confiance élevée, ${medium} à confiance moyenne, ${low} à confiance faible ou non évaluée`}
      >
        {highPct > 0 && (
          <div
            className="h-full bg-[var(--success)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${highPct}%` }}
          />
        )}
        {mediumPct > 0 && (
          <div
            className="h-full bg-[var(--warning)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${mediumPct}%` }}
          />
        )}
        {lowPct > 0 && (
          <div
            className="h-full bg-[var(--danger)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${lowPct}%` }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--success)]"
          />
          <span className="font-medium text-[var(--slate-700)]">{high}</span>{" "}
          <span className="text-[var(--slate-500)]">Élevée</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--warning)]"
          />
          <span className="font-medium text-[var(--slate-700)]">{medium}</span>{" "}
          <span className="text-[var(--slate-500)]">Moyenne</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--danger)]"
          />
          <span className="font-medium text-[var(--slate-700)]">{low}</span>{" "}
          <span className="text-[var(--slate-500)]">
            Faible ou non évaluée
          </span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConfidenceHeader({ globalConfidence, items }: ConfidenceHeaderProps) {
  const pct = globalConfidence !== null ? Math.round(globalConfidence * 100) : null;
  const includedItems = useMemo(
    () => items.filter((item) => !item.is_excluded),
    [items]
  );

  const buckets = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const item of includedItems) {
      const b = bucketItem(item.confidence);
      if (b === "high") high++;
      else if (b === "medium") medium++;
      else low++;
    }
    return { high, medium, low, total: includedItems.length };
  }, [includedItems]);

  const trustSummary = useMemo(() => {
    let localizedProofs = 0;
    let verified = 0;
    let needsAttention = 0;

    for (const item of includedItems) {
      const hasLocalizedProof =
        Boolean(item.evidence?.trim()) &&
        typeof item.source_page === "number" &&
        item.source_page > 0;
      if (hasLocalizedProof) localizedProofs++;
      if (item.is_verified) verified++;
      if (
        !hasLocalizedProof ||
        (!item.is_verified &&
          (item.confidence === null || item.confidence < 0.5))
      ) {
        needsAttention++;
      }
    }

    return {
      localizedProofs,
      verified,
      needsAttention,
      total: includedItems.length,
    };
  }, [includedItems]);

  const label = getConfidenceLabel(pct);

  return (
    <div
      role="region"
      aria-label="Indicateurs de confiance du métré"
      className="animate-fade-in rounded-lg border border-[var(--border)] bg-white px-5 py-4"
    >
      {/* Screen-reader full description */}
      <span className="sr-only">
        Confiance automatique : {pct === null ? "non calculée" : `${pct}%`}.{" "}
        {label} {trustSummary.localizedProofs} preuves localisées et{" "}
        {trustSummary.verified} validations humaines sur {trustSummary.total} items
        inclus. {trustSummary.needsAttention} items à traiter.
      </span>

      <div className="flex flex-col items-start gap-5 sm:flex-row">
        {/* Gauge */}
        <CircularGauge value={pct} />

        {/* Text + distribution */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)] text-pretty">
              Confiance estimée de l’analyse
            </h2>
            <p className="mt-0.5 text-sm text-[var(--slate-600)]">{label}</p>
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Ce score provient de l’analyse automatique. Il ne prouve ni la
              présence d’une source localisable ni une validation humaine.
            </p>
          </div>

          <DistributionBar
            high={buckets.high}
            medium={buckets.medium}
            low={buckets.low}
            total={buckets.total}
          />

          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-md bg-[var(--slate-50)] px-3 py-2">
              <dt className="text-[var(--slate-500)]">Preuves localisées</dt>
              <dd className="mt-0.5 font-semibold text-[var(--slate-800)] tabular-nums">
                {trustSummary.localizedProofs}/{trustSummary.total}
              </dd>
            </div>
            <div className="rounded-md bg-[var(--slate-50)] px-3 py-2">
              <dt className="text-[var(--slate-500)]">Validés humainement</dt>
              <dd className="mt-0.5 font-semibold text-[var(--slate-800)] tabular-nums">
                {trustSummary.verified}/{trustSummary.total}
              </dd>
            </div>
            <div className="rounded-md bg-[var(--slate-50)] px-3 py-2">
              <dt className="text-[var(--slate-500)]">À traiter</dt>
              <dd
                className={`mt-0.5 font-semibold tabular-nums ${
                  trustSummary.needsAttention > 0
                    ? "text-[var(--danger)]"
                    : "text-[var(--success)]"
                }`}
              >
                {trustSummary.needsAttention}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
