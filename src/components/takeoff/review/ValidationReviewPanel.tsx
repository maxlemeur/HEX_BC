"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  detectAnomalies,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import type { TakeoffDpgfComparisonSummary } from "@/lib/takeoff/types";

type ValidationReviewPanelProps = {
  items: ReviewItem[];
  dpgfSummary?: TakeoffDpgfComparisonSummary | null;
  dpgfLoading?: boolean;
  dpgfError?: string | null;
  hasDirtyOrSaving?: boolean;
  hasSaveErrors?: boolean;
  onOpenEvidencePanel?: (itemId: string) => void;
  onVerifyItem?: (itemId: string) => void;
  onExcludeItem?: (itemId: string) => void;
  onIncludeItem?: (itemId: string) => void;
  onOpenDpgfExceptions?: () => void;
  onOpenDetailedReview?: () => void;
};

type ValidationFilter =
  | "priority"
  | "all"
  | "low_confidence"
  | "missing_evidence"
  | "anomalies"
  | "unverified"
  | "open_hypotheses"
  | "missing_source_context";

const FILTER_OPTIONS: Array<{ value: ValidationFilter; label: string }> = [
  { value: "priority", label: "A traiter d'abord" },
  { value: "all", label: "Tous les signaux" },
  { value: "low_confidence", label: "Confiance faible" },
  { value: "missing_evidence", label: "Sans preuve" },
  { value: "missing_source_context", label: "Source incomplete" },
  { value: "anomalies", label: "Anomalies" },
  { value: "unverified", label: "Non verifies" },
  { value: "open_hypotheses", label: "Hypotheses ouvertes" },
];

const ISSUE_LABELS: Record<string, string> = {
  low_confidence: "Confiance faible",
  missing_evidence: "Aucune preuve liee",
  missing_source_context: "Source ou page manquante",
  zero_quantity: "Quantite nulle",
  empty_designation: "Designation manquante",
  unverified: "Validation manuelle requise",
  open_hypotheses: "Hypothese ouverte",
};

const PRIORITY_ISSUES = new Set<string>([
  "missing_evidence",
  "missing_source_context",
  "low_confidence",
  "zero_quantity",
  "empty_designation",
]);

const ISSUE_PRIORITY: Record<string, number> = {
  missing_evidence: 0,
  missing_source_context: 1,
  low_confidence: 2,
  zero_quantity: 3,
  empty_designation: 4,
  unverified: 5,
  open_hypotheses: 6,
};

type FlaggedItem = {
  item: ReviewItem;
  issues: string[];
  priorityScore: number;
};

function hasMissingSourceContext(item: ReviewItem) {
  return !item.source_file_name || item.source_page === null;
}

function computePriorityScore(input: { issues: string[]; item: ReviewItem }) {
  const topIssueRank = input.issues.reduce((best, issue) => {
    const rank = ISSUE_PRIORITY[issue] ?? 99;
    return Math.min(best, rank);
  }, 99);
  const confidenceScore =
    input.item.confidence === null ? 0 : Math.round(input.item.confidence * 100);

  return topIssueRank * 1_000 + confidenceScore;
}

function flagItems(items: ReviewItem[]): FlaggedItem[] {
  const result: FlaggedItem[] = [];

  for (const item of items) {
    if (item.is_excluded) continue;

    const issues: string[] = [...detectAnomalies(item)];

    if (!item.is_verified) {
      issues.push("unverified");
    }

    if (hasMissingSourceContext(item)) {
      issues.push("missing_source_context");
    }

    if (
      item.evidence !== null &&
      !item.is_verified &&
      (item.confidence === null || item.confidence < 0.8)
    ) {
      issues.push("open_hypotheses");
    }

    if (issues.length > 0) {
      result.push({
        item,
        issues: Array.from(new Set(issues)),
        priorityScore: computePriorityScore({ issues, item }),
      });
    }
  }

  return result;
}

function matchesFilter(flagged: FlaggedItem, filter: ValidationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "priority") {
    return flagged.issues.some((issue) => PRIORITY_ISSUES.has(issue));
  }
  if (filter === "low_confidence") return flagged.issues.includes("low_confidence");
  if (filter === "missing_evidence") return flagged.issues.includes("missing_evidence");
  if (filter === "missing_source_context") {
    return flagged.issues.includes("missing_source_context");
  }
  if (filter === "unverified") return flagged.issues.includes("unverified");
  if (filter === "anomalies") {
    return flagged.issues.some(
      (issue) => issue === "zero_quantity" || issue === "empty_designation"
    );
  }
  if (filter === "open_hypotheses") return flagged.issues.includes("open_hypotheses");
  return true;
}

function getConfidenceBadgeVariant(
  confidence: number | null
): "success" | "warning" | "error" | "neutral" {
  if (confidence === null) return "neutral";
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "error";
}

function formatConfidenceLabel(confidence: number | null) {
  if (confidence === null) return "Confiance inconnue";
  return `Confiance ${Math.round(confidence * 100)} %`;
}

function buildStatusMessage(input: {
  hasDirtyOrSaving: boolean;
  hasSaveErrors: boolean;
  summary: {
    priorityCount: number;
    flaggedCount: number;
  };
  dpgfSummary: TakeoffDpgfComparisonSummary | null;
}) {
  if (input.hasDirtyOrSaving) {
    return "Sauvegarde en cours. Attendez la confirmation avant de passer a l'apply.";
  }

  if (input.hasSaveErrors) {
    return "Certaines decisions ne sont pas encore enregistrees. Reprenez les lignes en erreur avant de continuer.";
  }

  if (
    input.dpgfSummary &&
    (input.dpgfSummary.lines_without_proof > 0 ||
      input.dpgfSummary.unused_takeoff_items > 0 ||
      input.dpgfSummary.forced_manual > 0)
  ) {
    return "Des rapprochements DPGF restent a trancher. Ouvrez la revue detaillee pour finaliser les liens manuels.";
  }

  if (input.summary.priorityCount > 0) {
    return "Commencez par les exceptions critiques: preuves manquantes, source incomplete et faible confiance.";
  }

  if (input.summary.flaggedCount > 0) {
    return "Les exceptions principales sont levees. Finalisez les validations humaines restantes.";
  }

  return "La revue est propre. Vous pouvez passer a l'etape suivante sans dispersion.";
}

export function ValidationReviewPanel({
  items,
  dpgfSummary = null,
  dpgfLoading = false,
  dpgfError = null,
  hasDirtyOrSaving = false,
  hasSaveErrors = false,
  onOpenEvidencePanel,
  onVerifyItem,
  onExcludeItem,
  onIncludeItem,
  onOpenDpgfExceptions,
  onOpenDetailedReview,
}: ValidationReviewPanelProps) {
  const [filter, setFilter] = useState<ValidationFilter>("priority");

  const includedItems = useMemo(() => items.filter((item) => !item.is_excluded), [items]);
  const flaggedItems = useMemo(
    () =>
      [...flagItems(items)].sort((left, right) => {
        if (left.priorityScore !== right.priorityScore) {
          return left.priorityScore - right.priorityScore;
        }
        return left.item.designation.localeCompare(right.item.designation, "fr");
      }),
    [items]
  );
  const filteredItems = useMemo(
    () => flaggedItems.filter((flagged) => matchesFilter(flagged, filter)),
    [flaggedItems, filter]
  );

  const summary = useMemo(() => {
    const total = includedItems.length;
    const lowConfidence = includedItems.filter(
      (item) => item.confidence !== null && item.confidence < 0.5
    ).length;
    const missingEvidence = includedItems.filter((item) => !item.evidence).length;
    const missingSourceContext = includedItems.filter(hasMissingSourceContext).length;
    const withAnomalies = includedItems.filter((item) =>
      detectAnomalies(item).some(
        (issue) => issue === "zero_quantity" || issue === "empty_designation"
      )
    ).length;
    const unverified = includedItems.filter((item) => !item.is_verified).length;
    const verified = total - unverified;
    const coveragePct =
      total > 0
        ? Math.round(
            (includedItems.filter((item) => !!item.evidence).length / total) * 100
          )
        : 0;
    const openHypotheses = includedItems.filter(
      (item) =>
        item.evidence !== null &&
        !item.is_verified &&
        (item.confidence === null || item.confidence < 0.8)
    ).length;
    const priorityCount = flaggedItems.filter((flagged) =>
      flagged.issues.some((issue) => PRIORITY_ISSUES.has(issue))
    ).length;

    return {
      total,
      lowConfidence,
      missingEvidence,
      missingSourceContext,
      withAnomalies,
      unverified,
      verified,
      coveragePct,
      openHypotheses,
      flaggedCount: flaggedItems.length,
      cleanCount: total - flaggedItems.length,
      priorityCount,
    };
  }, [flaggedItems, includedItems]);

  const statusMessage = useMemo(
    () =>
      buildStatusMessage({
        hasDirtyOrSaving,
        hasSaveErrors,
        summary,
        dpgfSummary,
      }),
    [dpgfSummary, hasDirtyOrSaving, hasSaveErrors, summary]
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-7 w-7"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        }
        title="Aucun item a valider"
        description="Le releve ne contient aucun item."
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--warning)]">
              Priorite de revue
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
              Traitez d&apos;abord les exceptions qui peuvent biaiser le chiffrage
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--slate-700)]">
              {statusMessage}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenDpgfExceptions ? (
              <Button variant="secondary" size="sm" onClick={onOpenDpgfExceptions}>
                Revoir les ecarts DPGF
              </Button>
            ) : null}
            {onOpenDetailedReview ? (
              <Button variant="ghost" size="sm" onClick={onOpenDetailedReview}>
                Vue detaillee
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PriorityCard
            label="A traiter d'abord"
            value={summary.priorityCount}
            tone={summary.priorityCount > 0 ? "warning" : "success"}
            hint="preuves manquantes, faible confiance, source incomplete"
          />
          <PriorityCard
            label="Sans preuve"
            value={summary.missingEvidence}
            tone={summary.missingEvidence > 0 ? "warning" : "success"}
            hint="items a documenter avant arbitrage"
          />
          <PriorityCard
            label="Source incomplete"
            value={summary.missingSourceContext}
            tone={summary.missingSourceContext > 0 ? "warning" : "success"}
            hint="fichier ou page non consultable"
          />
          <PriorityCard
            label="Confiance faible"
            value={summary.lowConfidence}
            tone={summary.lowConfidence > 0 ? "error" : "success"}
            hint="validation humaine requise"
          />
        </div>
      </section>

      {(hasDirtyOrSaving || hasSaveErrors) && (
        <section
          className={`rounded-lg border px-4 py-3 text-sm ${
            hasSaveErrors
              ? "border-[var(--danger)]/20 bg-[var(--danger)]/5 text-[var(--danger)]"
              : "border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 text-[var(--slate-700)]"
          }`}
          role="status"
        >
          {hasSaveErrors
            ? "Certaines decisions n'ont pas pu etre sauvegardees. Reprenez les lignes en erreur avant de continuer."
            : "Sauvegarde automatique en cours. Les decisions seront confirmees dans quelques instants."}
        </section>
      )}

      {(dpgfLoading || dpgfSummary || dpgfError) && (
        <section className="rounded-lg border border-[var(--border)] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--slate-800)]">
                Rapprochement DPGF
              </h2>
              <p className="mt-1 text-sm text-[var(--slate-600)]">
                Gardez les cas simples hors du chemin. Ouvrez seulement les lignes sans preuve, a confirmer ou a lier manuellement.
              </p>
            </div>
            {onOpenDpgfExceptions ? (
              <Button variant="secondary" size="sm" onClick={onOpenDpgfExceptions}>
                Ouvrir les exceptions DPGF
              </Button>
            ) : null}
          </div>

          {dpgfLoading ? (
            <p className="mt-3 text-sm text-[var(--slate-500)]">Chargement des ecarts DPGF...</p>
          ) : dpgfError ? (
            <p className="mt-3 text-sm text-[var(--danger)]">{dpgfError}</p>
          ) : dpgfSummary ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PriorityCard
                label="Sans preuve"
                value={dpgfSummary.lines_without_proof}
                tone={dpgfSummary.lines_without_proof > 0 ? "warning" : "success"}
                hint="lignes DPGF sans rapprochement fiable"
              />
              <PriorityCard
                label="Items orphelins"
                value={dpgfSummary.unused_takeoff_items}
                tone={dpgfSummary.unused_takeoff_items > 0 ? "warning" : "success"}
                hint="items takeoff sans ligne cible"
              />
              <PriorityCard
                label="Revue manuelle"
                value={dpgfSummary.forced_manual}
                tone={dpgfSummary.forced_manual > 0 ? "warning" : "success"}
                hint="cas qui demandent un arbitrage humain"
              />
              <PriorityCard
                label="A confirmer"
                value={dpgfSummary.to_confirm + dpgfSummary.significant_gaps}
                tone={
                  dpgfSummary.to_confirm + dpgfSummary.significant_gaps > 0
                    ? "warning"
                    : "success"
                }
                hint="ecarts forts ou rapprochements fragiles"
              />
            </div>
          ) : null}
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
          Resume de validation
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
          <SummaryCard label="Items inclus" value={summary.total} variant="neutral" />
          <SummaryCard
            label="Couverture preuve"
            value={`${summary.coveragePct} %`}
            variant={
              summary.coveragePct >= 80
                ? "success"
                : summary.coveragePct >= 50
                  ? "warning"
                  : "error"
            }
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
            label="Valides"
            value={`${summary.verified} / ${summary.total}`}
            variant={summary.unverified === 0 ? "success" : "neutral"}
          />
        </div>

        {summary.total === 0 ? (
          <p className="mt-3 text-sm text-[var(--slate-600)]" role="status">
            Tous les items sont exclus. Reintegrez au moins un item pour pouvoir appliquer l&apos;extraction.
          </p>
        ) : summary.flaggedCount === 0 ? (
          <p className="mt-3 text-sm font-medium text-[var(--success)]" role="status">
            Tous les items sont conformes. La revue peut passer a l&apos;etape suivante.
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--slate-600)]" role="status">
            {summary.flaggedCount} item{summary.flaggedCount > 1 ? "s" : ""} necessite{summary.flaggedCount > 1 ? "nt" : ""} une verification,
            dont {summary.priorityCount} prioritaire{summary.priorityCount > 1 ? "s" : ""}.
          </p>
        )}
      </section>

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

      {filteredItems.length > 0 ? (
        <div className="space-y-2" aria-live="polite">
          {filteredItems.map(({ item, issues }) => (
            <ValidationItemRow
              key={item.id}
              item={item}
              issues={issues}
              onOpenEvidencePanel={onOpenEvidencePanel}
              onVerifyItem={onVerifyItem}
              onExcludeItem={onExcludeItem}
              onIncludeItem={onIncludeItem}
            />
          ))}
        </div>
      ) : flaggedItems.length > 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--slate-500)]">
          Aucun item ne correspond au filtre selectionne.
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--slate-600)]">
            Prochaine etape :{" "}
            <span className="font-medium text-[var(--slate-800)]">{statusMessage}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {onOpenDpgfExceptions ? (
              <Button variant="secondary" size="sm" onClick={onOpenDpgfExceptions}>
                Ecarts DPGF
              </Button>
            ) : null}
            {onOpenDetailedReview ? (
              <Button variant="ghost" size="sm" onClick={onOpenDetailedReview}>
                Revue detaillee
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function PriorityCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "success" | "warning" | "error";
}) {
  const toneClass =
    tone === "success"
      ? "border-[var(--success)]/15 bg-[var(--success)]/5 text-[var(--success)]"
      : tone === "error"
        ? "border-[var(--danger)]/15 bg-[var(--danger)]/5 text-[var(--danger)]"
        : "border-[var(--warning)]/15 bg-[var(--warning)]/5 text-[var(--warning)]";

  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs opacity-80">{hint}</p>
    </div>
  );
}

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
      <p className={`text-lg font-semibold ${colorMap[variant]}`}>{value}</p>
    </div>
  );
}

function ValidationItemRow({
  item,
  issues,
  onOpenEvidencePanel,
  onVerifyItem,
  onExcludeItem,
  onIncludeItem,
}: {
  item: ReviewItem;
  issues: string[];
  onOpenEvidencePanel?: (itemId: string) => void;
  onVerifyItem?: (itemId: string) => void;
  onExcludeItem?: (itemId: string) => void;
  onIncludeItem?: (itemId: string) => void;
}) {
  const hasProof = Boolean(item.evidence || item.source_file_name || item.source_page !== null);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getConfidenceBadgeVariant(item.confidence)} size="sm">
              {formatConfidenceLabel(item.confidence)}
            </Badge>
            {!item.is_verified ? (
              <Badge variant="warning" size="sm">
                Verification requise
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                Verifie
              </Badge>
            )}
          </div>

          <p className="mt-3 text-sm font-semibold text-[var(--slate-900)]">
            {item.designation || "(sans designation)"}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--slate-500)]">
            <span>
              <span className="font-medium text-[var(--slate-700)]">{item.quantity}</span>{" "}
              {item.unit}
            </span>
            {item.source_file_name ? (
              <span>
                {item.source_file_name}
                {item.source_page !== null ? ` · page ${item.source_page}` : ""}
              </span>
            ) : item.source_page !== null ? (
              <span>page {item.source_page}</span>
            ) : (
              <span>Source non localisee</span>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2 text-sm text-[var(--slate-700)]">
            {item.evidence ? item.evidence : "Aucune preuve textuelle n'est renseignee pour cet item."}
          </div>

          {(item._saving || item._error) && (
            <p
              className={`mt-2 text-xs ${
                item._error ? "text-[var(--danger)]" : "text-[var(--slate-500)]"
              }`}
              role="status"
            >
              {item._error ? item._error : "Sauvegarde en cours..."}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap gap-1">
          {issues.map((issue) => (
            <Badge
              key={issue}
              variant={PRIORITY_ISSUES.has(issue) ? "error" : "warning"}
              size="sm"
            >
              {ISSUE_LABELS[issue] ?? issue}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpenEvidencePanel?.(item.id)}
          disabled={!onOpenEvidencePanel}
        >
          {hasProof ? "Ouvrir les preuves" : "Ajouter une preuve"}
        </Button>
        {!item.is_verified && onVerifyItem ? (
          <Button variant="ghost" size="sm" onClick={() => onVerifyItem(item.id)}>
            Valider cet item
          </Button>
        ) : null}
        {item.is_excluded ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onIncludeItem?.(item.id)}
            disabled={!onIncludeItem}
          >
            Reintegrer
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExcludeItem?.(item.id)}
            disabled={!onExcludeItem}
          >
            Exclure
          </Button>
        )}
      </div>
    </div>
  );
}
