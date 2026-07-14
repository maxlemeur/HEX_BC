"use client";

import type {
  EstimateChecklistCriterion,
  EstimateChecklistResult,
  EstimateChecklistStatus,
} from "@/lib/estimates/checklist";

type EstimateChecklistProps = {
  checklist: EstimateChecklistResult;
  isCollapsed: boolean;
  anomalyCount: number;
  affectedLineCount: number;
  onToggleCollapsed: () => void;
  onCriterionClick: (criterion: EstimateChecklistCriterion) => void;
  onShowAnomalies: () => void;
};

const STATUS_BADGE_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-orange-200 bg-orange-50 text-orange-700",
  blocking: "border-rose-200 bg-rose-50 text-rose-700",
};

const PROGRESS_BAR_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "bg-emerald-500",
  warning: "bg-orange-500",
  blocking: "bg-rose-500",
};

const STATUS_LABEL: Record<EstimateChecklistStatus, string> = {
  complete: "Critères complétés",
  warning: "À vérifier",
  blocking: "Action requise",
};

function getCriterionCounterLabel(criterion: EstimateChecklistCriterion) {
  if (criterion.totalCount <= 0) return "0";
  if (criterion.isComplete) {
    return `${criterion.totalCount}/${criterion.totalCount}`;
  }
  return `${criterion.missingCount}/${criterion.totalCount}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function EstimateChecklist({
  checklist,
  isCollapsed,
  anomalyCount,
  affectedLineCount,
  onToggleCollapsed,
  onCriterionClick,
  onShowAnomalies,
}: EstimateChecklistProps) {
  const statusBadgeClassName = STATUS_BADGE_CLASSNAME[checklist.status];
  const progressBarClassName = PROGRESS_BAR_CLASSNAME[checklist.status];
  const primaryIssue =
    checklist.criteria.find((criterion) => criterion.status === "blocking") ??
    checklist.criteria.find((criterion) => criterion.status === "warning") ??
    null;

  return (
    <aside
      className="h-fit w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4"
      data-testid="estimate-checklist"
      aria-labelledby="estimate-finalization-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="estimate-finalization-title"
            className="text-base font-semibold text-foreground"
          >
            Finalisation
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Les points à traiter avant l’envoi du devis.
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadgeClassName}`}
        >
          {STATUS_LABEL[checklist.status]}
        </span>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          {checklist.completedCount}/{checklist.totalCount} critères validés
        </p>
        <span className="text-xs text-muted-foreground">
          {checklist.progressPercent}%
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Progression des critères de finalisation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={checklist.progressPercent}
      >
        <div
          className={`h-full rounded-full transition-all ${progressBarClassName}`}
          style={{ width: `${checklist.progressPercent}%` }}
        />
      </div>

      {checklist.blockingCount > 0 ? (
        <p className="mt-2 text-xs font-semibold text-rose-700">
          {checklist.blockingCount}{" "}
          {pluralize(
            checklist.blockingCount,
            "critère bloquant",
            "critères bloquants",
          )}
        </p>
      ) : checklist.warningCount > 0 ? (
        <p className="mt-2 text-xs font-semibold text-orange-700">
          {checklist.warningCount}{" "}
          {pluralize(
            checklist.warningCount,
            "point à vérifier",
            "points à vérifier",
          )}
        </p>
      ) : null}

      {primaryIssue ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">
            Priorité
          </p>
          <p className="mt-1 text-sm font-semibold text-rose-900">
            {primaryIssue.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-rose-800">
            {primaryIssue.description}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3 min-h-11 w-full"
            onClick={() => onCriterionClick(primaryIssue)}
          >
            {primaryIssue.targetItemId
              ? "Afficher la première ligne concernée"
              : "Ouvrir le paramétrage"}
          </button>
        </div>
      ) : null}

      {anomalyCount > 0 ? (
        <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-orange-900">
              {anomalyCount} {pluralize(anomalyCount, "anomalie")}
            </p>
            <span className="text-xs text-orange-800">
              {affectedLineCount}{" "}
              {pluralize(
                affectedLineCount,
                "ligne concernée",
                "lignes concernées",
              )}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3 min-h-11 w-full"
            onClick={onShowAnomalies}
          >
            Afficher les lignes concernées
          </button>
        </div>
      ) : null}

      <p className="mt-4 rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted-foreground">
        Le contrôle complet sera relancé lors de l’envoi.
      </p>

      <button
        type="button"
        className="btn btn-ghost btn-sm mt-3 min-h-11 w-full justify-between"
        onClick={onToggleCollapsed}
        aria-expanded={!isCollapsed}
        aria-controls="estimate-finalization-criteria"
      >
        {isCollapsed ? "Voir les critères" : "Masquer les critères"}
        <span className="text-xs text-muted-foreground">
          {checklist.totalCount}
        </span>
      </button>

      {!isCollapsed ? (
        <div id="estimate-finalization-criteria" className="mt-2 space-y-2">
          {checklist.criteria.map((criterion) => {
            const criterionStatusClassName =
              STATUS_BADGE_CLASSNAME[criterion.status];
            return (
              <div
                key={criterion.key}
                className={`rounded-lg border px-3 py-2 ${criterionStatusClassName}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{criterion.label}</p>
                    <p className="mt-0.5 text-xs leading-5 opacity-90">
                      {criterion.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium">
                    {getCriterionCounterLabel(criterion)}
                  </span>
                </div>
                {!criterion.isComplete ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-2 min-h-10 w-full"
                    onClick={() => onCriterionClick(criterion)}
                  >
                    {criterion.targetItemId
                      ? "Afficher la ligne"
                      : "Ouvrir le paramétrage"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
