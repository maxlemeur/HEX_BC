"use client";

import type {
  EstimateChecklistCriterion,
  EstimateChecklistResult,
  EstimateChecklistStatus,
} from "@/lib/estimates/checklist";

type EstimateChecklistProps = {
  checklist: EstimateChecklistResult;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onCriterionClick: (criterion: EstimateChecklistCriterion) => void;
};

const STATUS_BADGE_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-orange-200 bg-orange-50 text-orange-700",
  blocking: "border-rose-200 bg-rose-50 text-rose-700",
};

const COLLAPSED_BORDER_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "border-l-4 border-l-emerald-400",
  warning: "border-l-4 border-l-orange-400",
  blocking: "border-l-4 border-l-rose-400",
};

const PROGRESS_BAR_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "bg-emerald-500",
  warning: "bg-orange-500",
  blocking: "bg-rose-500",
};

const STATUS_LABEL: Record<EstimateChecklistStatus, string> = {
  complete: "Complet",
  warning: "Warnings",
  blocking: "Bloquant",
};

function getCriterionCounterLabel(criterion: EstimateChecklistCriterion) {
  if (criterion.totalCount <= 0) return "0";
  if (criterion.isComplete) return `${criterion.totalCount}/${criterion.totalCount}`;
  return `${criterion.missingCount}/${criterion.totalCount}`;
}

export function EstimateChecklist({
  checklist,
  isCollapsed,
  onToggleCollapsed,
  onCriterionClick,
}: EstimateChecklistProps) {
  const statusBadgeClassName = STATUS_BADGE_CLASSNAME[checklist.status];
  const progressBarClassName = PROGRESS_BAR_CLASSNAME[checklist.status];

  const collapsedBorderClassName = isCollapsed
    ? COLLAPSED_BORDER_CLASSNAME[checklist.status]
    : "";

  return (
    <aside className={`dashboard-card h-fit p-4 ${collapsedBorderClassName}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Checklist complétude
          </h2>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Ouvrir la checklist" : "Replier la checklist"}
        >
          {isCollapsed ? "Afficher" : "Replier"}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClassName}`}
        >
          {STATUS_LABEL[checklist.status]}
        </span>
        <span className="text-xs text-muted-foreground">
          {checklist.completedCount}/{checklist.totalCount} criteres
        </span>
      </div>

      {!isCollapsed ? (
        <>
          <div className="mt-2 h-2 w-full rounded-full bg-slate-200">
            <div
              className={`h-2 rounded-full transition-all ${progressBarClassName}`}
              style={{ width: `${checklist.progressPercent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Progression globale: {checklist.progressPercent}%
          </p>
        </>
      ) : null}

      {!isCollapsed ? (
        <div className="mt-4 space-y-2">
          {checklist.criteria.map((criterion) => {
            const criterionStatusClassName = STATUS_BADGE_CLASSNAME[criterion.status];
            const isActionableInEditor = Boolean(criterion.targetItemId);

            return (
              <div
                key={criterion.key}
                className={`rounded-lg border px-3 py-2 ${criterionStatusClassName}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{criterion.label}</p>
                    <p className="mt-0.5 text-xs opacity-90">{criterion.description}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium">
                    {getCriterionCounterLabel(criterion)}
                  </span>
                </div>
                {!criterion.isComplete ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">
                      {criterion.status === "blocking"
                        ? "Correction bloquante"
                        : "Correction recommandee"}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onCriterionClick(criterion)}
                    >
                      {isActionableInEditor
                        ? "Aller a la ligne"
                        : "Aller au parametrage"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
