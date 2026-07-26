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
  if (pct >= 85) return "var(--success)";
  if (pct >= 60) return "var(--warning)";
  return "var(--danger)";
}

function getConfidenceLabel(pct: number): string {
  if (pct >= 85) return "Extraction fiable";
  if (pct >= 60) return "Qualite correcte — verifier les items faibles.";
  return "Qualite insuffisante — revision manuelle recommandee.";
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

function CircularGauge({ value }: { value: number }) {
  const radius = 36;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 100) * circumference;
  const color = getConfidenceColor(value);

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
        style={{ transition: "stroke-dasharray 0.6s ease" }}
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
        {value}%
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
        aria-label={`Distribution: ${high} fiable, ${medium} a verifier, ${low} problematique`}
      >
        {highPct > 0 && (
          <div
            className="h-full bg-[var(--success)] transition-all duration-500"
            style={{ width: `${highPct}%` }}
          />
        )}
        {mediumPct > 0 && (
          <div
            className="h-full bg-[var(--warning)] transition-all duration-500"
            style={{ width: `${mediumPct}%` }}
          />
        )}
        {lowPct > 0 && (
          <div
            className="h-full bg-[var(--danger)] transition-all duration-500"
            style={{ width: `${lowPct}%` }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
          <span className="font-medium text-[var(--slate-700)]">{high}</span>{" "}
          <span className="text-[var(--slate-500)]">Fiable</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--warning)]" />
          <span className="font-medium text-[var(--slate-700)]">{medium}</span>{" "}
          <span className="text-[var(--slate-500)]">À vérifier</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
          <span className="font-medium text-[var(--slate-700)]">{low}</span>{" "}
          <span className="text-[var(--slate-500)]">Problematique</span>
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

  const buckets = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const item of items) {
      const b = bucketItem(item.confidence);
      if (b === "high") high++;
      else if (b === "medium") medium++;
      else low++;
    }
    return { high, medium, low, total: items.length };
  }, [items]);

  if (pct === null) return null;

  const label = getConfidenceLabel(pct);

  return (
    <div
      role="region"
      aria-label="Confiance globale de l'extraction"
      className="animate-fade-in rounded-lg border border-[var(--border)] bg-white px-5 py-4"
    >
      {/* Screen-reader full description */}
      <span className="sr-only">
        Confiance globale: {pct}%. {label} Distribution: {buckets.high} items
        fiables, {buckets.medium} a verifier, {buckets.low} problematiques sur{" "}
        {buckets.total} items.
      </span>

      <div className="flex items-start gap-5">
        {/* Gauge */}
        <CircularGauge value={pct} />

        {/* Text + distribution */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Confiance globale
            </h2>
            <p className="mt-0.5 text-sm text-[var(--slate-600)]">{label}</p>
          </div>

          <DistributionBar
            high={buckets.high}
            medium={buckets.medium}
            low={buckets.low}
            total={buckets.total}
          />
        </div>
      </div>
    </div>
  );
}
