"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  detectAnomalies,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import { hasBlockingTakeoffDpgfExceptions } from "@/lib/takeoff/dpgf-compare";
import { getTakeoffVerificationReadiness } from "@/lib/takeoff/guards";
import type { TakeoffDpgfComparisonSummary } from "@/lib/takeoff/types";
import { CircleCheckIcon } from "lucide-react";

type ValidationReviewPanelProps = {
  items: ReviewItem[];
  dpgfSummary?: TakeoffDpgfComparisonSummary | null;
  dpgfLoading?: boolean;
  dpgfError?: string | null;
  hasDirtyOrSaving?: boolean;
  hasSaveErrors?: boolean;
  requiresLocalizedProof?: boolean;
  canOpenApplyWizard?: boolean;
  applyReadinessMessage?: string | null;
  onOpenEvidencePanel?: (itemId: string) => void;
  onVerifyItem?: (itemId: string) => void;
  onExcludeItem?: (itemId: string) => void;
  onIncludeItem?: (itemId: string) => void;
  onOpenDpgfExceptions?: () => void;
  onOpenDetailedReview?: () => void;
  onOpenApplyWizard?: () => void;
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
  { value: "priority", label: "À traiter d'abord" },
  { value: "all", label: "Tous les signaux" },
  { value: "low_confidence", label: "Confiance faible" },
  { value: "missing_evidence", label: "Sans preuve" },
  { value: "missing_source_context", label: "Source incomplète" },
  { value: "anomalies", label: "Anomalies" },
  { value: "unverified", label: "Non vérifiés" },
  { value: "open_hypotheses", label: "Hypothèses ouvertes" },
];

const ISSUE_LABELS: Record<string, string> = {
  low_confidence: "Confiance faible",
  missing_evidence: "Aucune preuve liée",
  missing_source_context: "Source ou page manquante",
  zero_quantity: "Quantité nulle",
  empty_designation: "Désignation manquante",
  unverified: "Validation manuelle requise",
  open_hypotheses: "Hypothèse ouverte",
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

function hasMissingSourceContext(item: ReviewItem, requiresLocalizedProof: boolean) {
  if (requiresLocalizedProof) {
    return typeof item.source_page !== "number" || item.source_page < 1;
  }
  return !item.source_file_name && item.source_page === null;
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

function flagItems(
  items: ReviewItem[],
  requiresLocalizedProof: boolean
): FlaggedItem[] {
  const result: FlaggedItem[] = [];

  for (const item of items) {
    if (item.is_excluded) continue;

    const issues: string[] = detectAnomalies(item).filter(
      (issue) => issue !== "low_confidence" || !item.is_verified
    );

    if (!item.is_verified) {
      issues.push("unverified");
    }

    if (hasMissingSourceContext(item, requiresLocalizedProof)) {
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
): "success" | "warning" | "danger" | "neutral" {
  if (confidence === null) return "neutral";
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "danger";
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
  canOpenApplyWizard: boolean;
}) {
  if (input.hasDirtyOrSaving) {
    return "Sauvegarde en cours. Attendez la confirmation avant de passer à l'apply.";
  }

  if (input.hasSaveErrors) {
    return "Certaines décisions ne sont pas encore enregistrées. Reprenez les lignes en erreur avant de continuer.";
  }

  if (hasBlockingTakeoffDpgfExceptions(input.dpgfSummary)) {
    return "Des rapprochements DPGF restent à trancher. Ouvrez la revue détaillée pour finaliser les liens manuels.";
  }

  if (input.summary.priorityCount > 0) {
    return "Commencez par les exceptions critiques : preuves manquantes, source incomplète et faible confiance.";
  }

  if (input.summary.flaggedCount > 0) {
    if (input.canOpenApplyWizard) {
      return "Le métré peut être appliqué. Des contrôles humains restent recommandés mais ne bloquent pas cette étape.";
    }
    return "Les exceptions principales sont levées. Finalisez les validations humaines restantes.";
  }

  return "La revue est propre. Vous pouvez passer à l'étape suivante sans dispersion.";
}

export function ValidationReviewPanel({
  items,
  dpgfSummary = null,
  dpgfLoading = false,
  dpgfError = null,
  hasDirtyOrSaving = false,
  hasSaveErrors = false,
  requiresLocalizedProof = false,
  canOpenApplyWizard = false,
  applyReadinessMessage = null,
  onOpenEvidencePanel,
  onVerifyItem,
  onExcludeItem,
  onIncludeItem,
  onOpenDpgfExceptions,
  onOpenDetailedReview,
  onOpenApplyWizard,
}: ValidationReviewPanelProps) {
  const [filter, setFilter] = useState<ValidationFilter>("priority");

  const includedItems = useMemo(() => items.filter((item) => !item.is_excluded), [items]);
  const excludedItems = useMemo(() => items.filter((item) => item.is_excluded), [items]);
  const flaggedItems = useMemo(
    () =>
      [...flagItems(items, requiresLocalizedProof)].sort((left, right) => {
        if (left.priorityScore !== right.priorityScore) {
          return left.priorityScore - right.priorityScore;
        }
        return left.item.designation.localeCompare(right.item.designation, "fr");
      }),
    [items, requiresLocalizedProof]
  );
  const filteredItems = useMemo(
    () => flaggedItems.filter((flagged) => matchesFilter(flagged, filter)),
    [flaggedItems, filter]
  );

  const summary = useMemo(() => {
    const total = includedItems.length;
    const lowConfidence = includedItems.filter(
      (item) =>
        !item.is_verified && item.confidence !== null && item.confidence < 0.5
    ).length;
    const missingEvidence = includedItems.filter((item) => !item.evidence).length;
    const missingSourceContext = includedItems.filter((item) =>
      hasMissingSourceContext(item, requiresLocalizedProof)
    ).length;
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
            (includedItems.filter((item) =>
              requiresLocalizedProof
                ? getTakeoffVerificationReadiness(item).canVerify
                : Boolean(item.evidence?.trim())
            ).length /
              total) *
              100
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
  }, [flaggedItems, includedItems, requiresLocalizedProof]);

  const statusMessage = useMemo(
    () =>
      buildStatusMessage({
        hasDirtyOrSaving,
        hasSaveErrors,
        summary,
        dpgfSummary,
        canOpenApplyWizard,
      }),
    [canOpenApplyWizard, dpgfSummary, hasDirtyOrSaving, hasSaveErrors, summary]
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheckIcon aria-hidden="true" />}
        title="Aucun item à valider"
        description="Le relevé ne contient aucun item."
        headingLevel={2}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-warning-border bg-warning-subtle p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">
              Priorité de revue
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              Traitez d&apos;abord les exceptions qui peuvent biaiser le chiffrage
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-foreground-secondary">
              {statusMessage}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenDpgfExceptions ? (
              <Button variant="secondary" size="sm" onClick={onOpenDpgfExceptions}>
                Revoir les écarts DPGF
              </Button>
            ) : null}
            {onOpenDetailedReview ? (
              <Button variant="ghost" size="sm" onClick={onOpenDetailedReview}>
                Vue détaillée
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PriorityCard
            label="À traiter d'abord"
            value={summary.priorityCount}
            tone={summary.priorityCount > 0 ? "warning" : "success"}
            hint="preuves manquantes, faible confiance, source incomplète"
          />
          <PriorityCard
            label="Sans preuve"
            value={summary.missingEvidence}
            tone={summary.missingEvidence > 0 ? "warning" : "success"}
            hint="items à documenter avant arbitrage"
          />
          <PriorityCard
            label="Source incomplète"
            value={summary.missingSourceContext}
            tone={summary.missingSourceContext > 0 ? "warning" : "success"}
            hint="fichier ou page non consultable"
          />
          <PriorityCard
            label="Faible à vérifier"
            value={summary.lowConfidence}
            tone={summary.lowConfidence > 0 ? "danger" : "success"}
            hint="validation humaine requise"
          />
        </div>
      </section>

      {(hasDirtyOrSaving || hasSaveErrors) && (
        <section
          className={`rounded-lg border px-4 py-3 text-sm ${
            hasSaveErrors
              ? "border-danger-border bg-danger-subtle text-danger"
              : "border-primary/20 bg-primary/5 text-foreground-secondary"
          }`}
          role="status"
        >
          {hasSaveErrors
            ? "Certaines décisions n'ont pas pu être sauvegardées. Reprenez les lignes en erreur avant de continuer."
            : "Sauvegarde automatique en cours. Les décisions seront confirmées dans quelques instants."}
        </section>
      )}

      {(dpgfLoading || dpgfSummary || dpgfError) && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Rapprochement DPGF
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Gardez les cas simples hors du chemin. Ouvrez seulement les lignes sans preuve, à confirmer ou à lier manuellement.
              </p>
            </div>
            {onOpenDpgfExceptions ? (
              <Button variant="secondary" size="sm" onClick={onOpenDpgfExceptions}>
                Ouvrir les exceptions DPGF
              </Button>
            ) : null}
          </div>

          {dpgfLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Chargement des écarts DPGF…</p>
          ) : dpgfError ? (
            <p className="mt-3 text-sm text-danger">{dpgfError}</p>
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
                tone={
                  dpgfSummary.total_lines > 0 && dpgfSummary.unused_takeoff_items > 0
                    ? "warning"
                    : "success"
                }
                hint={
                  dpgfSummary.total_lines === 0
                    ? "aucune ligne DPGF cible, ajout au chiffrage possible"
                    : "items takeoff sans ligne cible"
                }
              />
              <PriorityCard
                label="Revue manuelle"
                value={dpgfSummary.forced_manual}
                tone={dpgfSummary.forced_manual > 0 ? "warning" : "success"}
                hint="cas qui demandent un arbitrage humain"
              />
              <PriorityCard
                label="À confirmer"
                value={dpgfSummary.to_confirm + dpgfSummary.significant_gaps}
                tone={
                  dpgfSummary.to_confirm + dpgfSummary.significant_gaps > 0
                    ? "warning"
                    : "success"
                }
                hint="écarts forts ou rapprochements fragiles"
              />
            </div>
          ) : null}
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Résumé de validation
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
          <SummaryCard label="Items inclus" value={summary.total} variant="neutral" />
          <SummaryCard
            label={requiresLocalizedProof ? "Preuves localisées" : "Couverture preuve"}
            value={`${summary.coveragePct} %`}
            variant={
              summary.coveragePct >= 80
                ? "success"
                : summary.coveragePct >= 50
                  ? "warning"
                  : "danger"
            }
          />
          <SummaryCard
            label="Confiance faible"
            value={summary.lowConfidence}
            variant={summary.lowConfidence === 0 ? "success" : "danger"}
          />
          <SummaryCard
            label="Sans preuve"
            value={summary.missingEvidence}
            variant={summary.missingEvidence === 0 ? "success" : "warning"}
          />
          <SummaryCard
            label="Anomalies"
            value={summary.withAnomalies}
            variant={summary.withAnomalies === 0 ? "success" : "danger"}
          />
          <SummaryCard
            label="Hypothèses ouvertes"
            value={summary.openHypotheses}
            variant={summary.openHypotheses === 0 ? "success" : "warning"}
          />
          <SummaryCard
            label="Validés"
            value={`${summary.verified} / ${summary.total}`}
            variant={summary.unverified === 0 ? "success" : "neutral"}
          />
        </div>

        {summary.total === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Tous les items sont exclus. Réintégrez au moins un item pour pouvoir appliquer l&apos;extraction.
          </p>
        ) : summary.flaggedCount === 0 ? (
          <p className="mt-3 text-sm font-medium text-success" role="status">
            Tous les items sont conformes. La revue peut passer à l&apos;étape suivante.
          </p>
        ) : canOpenApplyWizard && summary.priorityCount === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {summary.flaggedCount} contrôle{summary.flaggedCount > 1 ? "s" : ""} humain{summary.flaggedCount > 1 ? "s" : ""} reste{summary.flaggedCount > 1 ? "nt" : ""} recommandé{summary.flaggedCount > 1 ? "s" : ""}. L&apos;application n&apos;est pas bloquée.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {summary.flaggedCount} item{summary.flaggedCount > 1 ? "s" : ""} nécessite{summary.flaggedCount > 1 ? "nt" : ""} une vérification,
            dont {summary.priorityCount} prioritaire{summary.priorityCount > 1 ? "s" : ""}.
          </p>
        )}
      </section>

      {flaggedItems.length > 0 && (
        <div
          role="group"
          aria-labelledby="validation-filter-label"
          className="flex flex-wrap items-center gap-2"
        >
          <span id="validation-filter-label" className="text-xs font-medium text-muted-foreground">
            Filtrer :
          </span>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`min-h-11 rounded-control px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-8 ${
                filter === option.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground-secondary hover:bg-border"
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
              requiresLocalizedProof={requiresLocalizedProof}
            />
          ))}
        </div>
      ) : flaggedItems.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
          Aucun item ne correspond au filtre sélectionné.
        </div>
      ) : null}

      {excludedItems.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Items exclus
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Gardez les exclusions visibles ici pour pouvoir les réintégrer sans quitter la revue validation.
              </p>
            </div>
            <Badge variant="neutral" size="sm">
              {excludedItems.length} exclu{excludedItems.length > 1 ? "s" : ""}
            </Badge>
          </div>

          <div className="mt-4 space-y-2" aria-live="polite">
            {excludedItems.map((item) => (
              <ValidationItemRow
                key={item.id}
                item={item}
                issues={[]}
                onOpenEvidencePanel={onOpenEvidencePanel}
                onVerifyItem={onVerifyItem}
                onExcludeItem={onExcludeItem}
                onIncludeItem={onIncludeItem}
                requiresLocalizedProof={requiresLocalizedProof}
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id="validation-next-step" className="text-sm text-muted-foreground">
            Prochaine étape :{" "}
            <span className="font-medium text-foreground">
              {canOpenApplyWizard
                ? "L'apply contrôlé est prêt. Vérifiez l'impact puis confirmez."
                : (applyReadinessMessage ?? statusMessage)}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {onOpenApplyWizard ? (
              <Button
                variant="primary"
                size="sm"
                onClick={onOpenApplyWizard}
                disabled={!canOpenApplyWizard}
                aria-describedby="validation-next-step"
              >
                Ouvrir l&apos;apply contrôlé
              </Button>
            ) : null}
            {onOpenDpgfExceptions ? (
              <Button variant="secondary" size="sm" onClick={onOpenDpgfExceptions}>
                Écarts DPGF
              </Button>
            ) : null}
            {onOpenDetailedReview ? (
              <Button variant="ghost" size="sm" onClick={onOpenDetailedReview}>
                Revue détaillée
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
  tone: "success" | "warning" | "danger";
}) {
  const toneClass = {
    success: { border: "border-success-border", value: "text-success" },
    warning: { border: "border-warning-border", value: "text-warning" },
    danger: { border: "border-danger-border", value: "text-danger" },
  }[tone];

  return (
    <div className={`rounded-xl border bg-surface px-3 py-3 ${toneClass.border}`}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-foreground-secondary">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass.value}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
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
  variant: "success" | "warning" | "danger" | "neutral";
}) {
  const colorMap = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    neutral: "text-foreground",
  };

  return (
    <div className="rounded-md border border-border bg-surface-subtle px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
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
  requiresLocalizedProof,
}: {
  item: ReviewItem;
  issues: string[];
  onOpenEvidencePanel?: (itemId: string) => void;
  onVerifyItem?: (itemId: string) => void;
  onExcludeItem?: (itemId: string) => void;
  onIncludeItem?: (itemId: string) => void;
  requiresLocalizedProof: boolean;
}) {
  const hasProof = Boolean(item.evidence || item.source_file_name || item.source_page !== null);
  const verificationReadiness = getTakeoffVerificationReadiness(item);
  const mustOpenProofBeforeVerification =
    requiresLocalizedProof && !item.is_verified;
  const proofActionLabel = mustOpenProofBeforeVerification
    ? verificationReadiness.canVerify
      ? "Contrôler et valider"
      : item.evidence?.trim()
        ? "Localiser la source"
        : "Compléter la preuve"
    : hasProof
      ? "Ouvrir les preuves"
      : "Ajouter une preuve";

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getConfidenceBadgeVariant(item.confidence)} size="sm">
              {formatConfidenceLabel(item.confidence)}
            </Badge>
            {item.is_excluded ? (
              <Badge variant="neutral" size="sm">
                Exclu
              </Badge>
            ) : null}
            {!item.is_verified ? (
              <Badge variant="warning" size="sm">
                Vérification requise
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                Vérifié
              </Badge>
            )}
          </div>

          <p className="mt-3 text-sm font-semibold text-foreground">
            {item.designation || "(sans désignation)"}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground-secondary">{item.quantity}</span>{" "}
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
              <span>Source non localisée</span>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm text-foreground-secondary">
            {item.evidence ? item.evidence : "Aucune preuve textuelle n'est renseignée pour cet item."}
          </div>

          {(item._saving || item._error) && (
            <p
              className={`mt-2 text-xs ${
                item._error ? "text-danger" : "text-muted-foreground"
              }`}
              role="status"
            >
              {item._error ? item._error : "Sauvegarde en cours…"}
            </p>
          )}
        </div>

        <div className="flex w-full min-w-0 flex-wrap gap-1 sm:w-auto sm:max-w-[45%] sm:justify-end">
          {issues.map((issue) => (
            <Badge
              key={issue}
              variant={PRIORITY_ISSUES.has(issue) ? "danger" : "warning"}
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
          {proofActionLabel}
        </Button>
        {!item.is_verified && onVerifyItem && !requiresLocalizedProof ? (
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
            Réintégrer
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
