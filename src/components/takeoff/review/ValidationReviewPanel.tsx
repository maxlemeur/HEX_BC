"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  detectAnomalies,
  ANOMALY_LABELS,
  type AnomalyType,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ValidationReviewPanelProps = {
  items: ReviewItem[];
};

type ValidationFilter = "all" | "low_confidence" | "missing_evidence" | "anomalies" | "unverified" | "open_hypotheses";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTER_OPTIONS: { value: ValidationFilter; label: string }[] = [
  { value: "all", label: "Tous les signaux" },
  { value: "low_confidence", label: "Confiance faible" },
  { value: "missing_evidence", label: "Sans preuve" },
  { value: "anomalies", label: "Anomalies" },
  { value: "unverified", label: "Non verifies" },
  { value: "open_hypotheses", label: "Hypotheses ouvertes" },
];

const ISSUE_LABELS: Record<string, string> = {
  low_confidence: "Confiance faible",
  missing_evidence: "Aucune preuve liee",
  zero_quantity: "Quantite nulle",
  empty_designation: "Designation manquante",
  unverified: "Non verifie",
  open_hypotheses: "Hypothese ouverte",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FlaggedItem = {
  item: ReviewItem;
  issues: string[];
};

function flagItems(items: ReviewItem[]): FlaggedItem[] {
  const result: FlaggedItem[] = [];

  for (const item of items) {
    if (item.is_excluded) continue;

    const issues: string[] = [];
    const anomalies = detectAnomalies(item);

    for (const anomaly of anomalies) {
      issues.push(anomaly);
    }

    if (!item.is_verified) {
      issues.push("unverified");
    }

    // Open hypothesis: has evidence but unverified with low confidence
    if (
      item.evidence !== null &&
      !item.is_verified &&
      (item.confidence === null || item.confidence < 0.8)
    ) {
      issues.push("open_hypotheses");
    }

    if (issues.length > 0) {
      result.push({ item, issues });
    }
  }

  return result;
}

function matchesFilter(flagged: FlaggedItem, filter: ValidationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "low_confidence") return flagged.issues.includes("low_confidence");
  if (filter === "missing_evidence") return flagged.issues.includes("missing_evidence");
  if (filter === "unverified") return flagged.issues.includes("unverified");
  if (filter === "anomalies") {
    return flagged.issues.some(
      (i) => i === "zero_quantity" || i === "empty_designation"
    );
  }
  if (filter === "open_hypotheses") return flagged.issues.includes("open_hypotheses");
  return true;
}

function getConfidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Inconnue";
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return `${pct} % - Elevee`;
  if (pct >= 50) return `${pct} % - Moyenne`;
  return `${pct} % - Faible`;
}

function getConfidenceBadgeVariant(
  confidence: number | null
): "success" | "warning" | "error" | "neutral" {
  if (confidence === null) return "neutral";
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "error";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ValidationReviewPanel({
  items,
}: ValidationReviewPanelProps) {
  const [filter, setFilter] = useState<ValidationFilter>("all");

  const includedItems = useMemo(() => items.filter((i) => !i.is_excluded), [items]);

  const flaggedItems = useMemo(() => flagItems(items), [items]);

  const filteredItems = useMemo(
    () => flaggedItems.filter((f) => matchesFilter(f, filter)),
    [flaggedItems, filter]
  );

  // Summary counters
  const summary = useMemo(() => {
    const total = includedItems.length;
    const lowConfidence = includedItems.filter(
      (i) => i.confidence !== null && i.confidence < 0.5
    ).length;
    const missingEvidence = includedItems.filter((i) => !i.evidence).length;
    const withAnomalies = includedItems.filter(
      (i) => detectAnomalies(i).some((a) => a === "zero_quantity" || a === "empty_designation")
    ).length;
    const unverified = includedItems.filter((i) => !i.is_verified).length;
    const verified = total - unverified;
    const coveragePct = total > 0
      ? Math.round((includedItems.filter((i) => !!i.evidence).length / total) * 100)
      : 0;
    const openHypotheses = includedItems.filter(
      (i) =>
        i.evidence !== null &&
        !i.is_verified &&
        (i.confidence === null || i.confidence < 0.8)
    ).length;

    return {
      total,
      lowConfidence,
      missingEvidence,
      withAnomalies,
      unverified,
      verified,
      coveragePct,
      openHypotheses,
      flaggedCount: flaggedItems.length,
      cleanCount: total - flaggedItems.length,
    };
  }, [includedItems, flaggedItems]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        title="Aucun item a valider"
        description="Le releve ne contient aucun item."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary dashboard */}
      <div className="rounded-lg border border-[var(--border)] bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
          Resume de validation
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
          <SummaryCard
            label="Items inclus"
            value={summary.total}
            variant="neutral"
          />
          <SummaryCard
            label="Couverture preuve"
            value={`${summary.coveragePct} %`}
            variant={summary.coveragePct >= 80 ? "success" : summary.coveragePct >= 50 ? "warning" : "error"}
          />
          <SummaryCard
            label="Confiance faible"
            value={summary.lowConfidence}
            variant={summary.lowConfidence === 0 ? "success" : "error"}
          />
          <SummaryCard
            label="Sans preuve"
            value={summary.missingEvidence}
            variant={summary.missingEvidence === 0 ? "success" : "warning"}
          />
          <SummaryCard
            label="Anomalies"
            value={summary.withAnomalies}
            variant={summary.withAnomalies === 0 ? "success" : "error"}
          />
          <SummaryCard
            label="Hypotheses ouvertes"
            value={summary.openHypotheses}
            variant={summary.openHypotheses === 0 ? "success" : "warning"}
          />
          <SummaryCard
            label="Verifies"
            value={`${summary.verified} / ${summary.total}`}
            variant={summary.unverified === 0 ? "success" : "neutral"}
          />
        </div>

        {summary.total === 0 ? (
          <p className="mt-3 text-sm text-[var(--slate-600)]" role="status">
            Tous les items sont exclus. Reintegrez au moins un item pour pouvoir appliquer l&apos;extraction.
          </p>
        ) : summary.flaggedCount === 0 ? (
          <p
            className="mt-3 text-sm font-medium text-[var(--success)]"
            role="status"
          >
            Tous les items sont conformes. L&apos;extraction est prete a etre appliquee.
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--slate-600)]" role="status">
            {summary.flaggedCount} item{summary.flaggedCount > 1 ? "s" : ""} necessite{summary.flaggedCount > 1 ? "nt" : ""} une attention
            &mdash; {summary.cleanCount} item{summary.cleanCount !== 1 ? "s" : ""} sans probleme.
          </p>
        )}
      </div>

      {/* Filter bar */}
      {flaggedItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--slate-500)]">Filtrer :</span>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 ${
                filter === option.value
                  ? "bg-[var(--slate-800)] text-white"
                  : "bg-[var(--slate-100)] text-[var(--slate-600)] hover:bg-[var(--slate-200)]"
              }`}
              aria-pressed={filter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* Flagged items list */}
      {filteredItems.length > 0 ? (
        <div className="space-y-2" aria-live="polite">
          {filteredItems.map(({ item, issues }) => (
            <ValidationItemRow
              key={item.id}
              item={item}
              issues={issues}
            />
          ))}
        </div>
      ) : flaggedItems.length > 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--slate-500)]">
          Aucun item ne correspond au filtre selectionne.
        </div>
      ) : null}

      {/* Bottom bar — informational only, apply is in Assisted/Production modes */}
      <div className="rounded-lg border border-[var(--border)] bg-white px-4 py-3">
        <p className="text-sm text-[var(--slate-600)]">
          {summary.cleanCount} item{summary.cleanCount !== 1 ? "s" : ""} conforme{summary.cleanCount !== 1 ? "s" : ""},
          {" "}{summary.flaggedCount} a verifier
          &mdash; basculez en mode <strong>Assiste</strong> ou <strong>Production</strong> pour appliquer.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | string;
  variant: "success" | "warning" | "error" | "neutral";
}) {
  const colorMap = {
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    error: "text-[var(--danger)]",
    neutral: "text-[var(--slate-800)]",
  };

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--slate-50)] px-3 py-2">
      <p className="text-xs text-[var(--slate-500)]">{label}</p>
      <p className={`text-lg font-semibold ${colorMap[variant]}`}>
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation item row
// ---------------------------------------------------------------------------

function ValidationItemRow({
  item,
  issues,
}: {
  item: ReviewItem;
  issues: string[];
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-white px-4 py-3">
      {/* Confidence indicator */}
      <div className="flex-shrink-0 pt-0.5">
        <Badge
          variant={getConfidenceBadgeVariant(item.confidence)}
          size="sm"
        >
          {item.confidence !== null
            ? `${Math.round(item.confidence * 100)} %`
            : "-"}
        </Badge>
      </div>

      {/* Item info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--slate-800)]">
          {item.designation || "(sans designation)"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--slate-500)]">
          <span>
            <span className="font-medium text-[var(--slate-700)]">{item.quantity}</span>{" "}
            {item.unit}
          </span>
          {item.source_file_name && (
            <span>{item.source_file_name}{item.source_page !== null ? ` p.${item.source_page}` : ""}</span>
          )}
        </div>
      </div>

      {/* Issue badges */}
      <div className="flex flex-shrink-0 flex-wrap gap-1">
        {issues.map((issue) => (
          <Badge
            key={issue}
            variant={issue === "unverified" ? "warning" : "error"}
            size="sm"
          >
            {ISSUE_LABELS[issue] ?? issue}
          </Badge>
        ))}
      </div>
    </div>
  );
}
