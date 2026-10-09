"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const STATUS_BADGE_VARIANT: Record<
  EstimateChecklistStatus,
  "success" | "warning" | "danger"
> = {
  complete: "success",
  warning: "warning",
  blocking: "danger",
};

const STATUS_PANEL_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "border-success-border bg-success-subtle",
  warning: "border-warning-border bg-warning-subtle",
  blocking: "border-danger-border bg-danger-subtle",
};

const STATUS_TEXT_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "text-success",
  warning: "text-warning",
  blocking: "text-danger",
};

const PROGRESS_BAR_CLASSNAME: Record<EstimateChecklistStatus, string> = {
  complete: "bg-success",
  warning: "bg-warning",
  blocking: "bg-danger",
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
  const progressBarClassName = PROGRESS_BAR_CLASSNAME[checklist.status];
  const primaryIssue =
    checklist.criteria.find((criterion) => criterion.status === "blocking") ??
    checklist.criteria.find((criterion) => criterion.status === "warning") ??
    null;

  return (
    <aside
      className="h-fit w-full rounded-lg border border-border bg-surface p-4 shadow-card xl:sticky xl:top-4"
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
        <Badge variant={STATUS_BADGE_VARIANT[checklist.status]} size="sm">
          {STATUS_LABEL[checklist.status]}
        </Badge>
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
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progression des critères de finalisation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={checklist.progressPercent}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all motion-reduce:transition-none",
            progressBarClassName,
          )}
          style={{ width: `${checklist.progressPercent}%` }}
        />
      </div>

      {checklist.blockingCount > 0 ? (
        <p className="mt-2 text-xs font-semibold text-danger">
          {checklist.blockingCount}{" "}
          {pluralize(
            checklist.blockingCount,
            "critère bloquant",
            "critères bloquants",
          )}
        </p>
      ) : checklist.warningCount > 0 ? (
        <p className="mt-2 text-xs font-semibold text-warning">
          {checklist.warningCount}{" "}
          {pluralize(
            checklist.warningCount,
            "point à vérifier",
            "points à vérifier",
          )}
        </p>
      ) : null}

      {primaryIssue ? (
        <div
          className={cn(
            "mt-4 rounded-lg border p-3",
            STATUS_PANEL_CLASSNAME[primaryIssue.status],
          )}
        >
          <p
            className={cn(
              "text-xs font-semibold uppercase tracking-[0.12em]",
              STATUS_TEXT_CLASSNAME[primaryIssue.status],
            )}
          >
            Priorité
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {primaryIssue.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-foreground-secondary">
            {primaryIssue.description}
          </p>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="mt-3 min-h-11 w-full"
            onClick={() => onCriterionClick(primaryIssue)}
          >
            {primaryIssue.targetItemId
              ? "Afficher la première ligne concernée"
              : "Ouvrir le paramétrage"}
          </Button>
        </div>
      ) : null}

      {anomalyCount > 0 ? (
        <div className="mt-3 rounded-lg border border-warning-border bg-warning-subtle p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">
              {anomalyCount} {pluralize(anomalyCount, "anomalie")}
            </p>
            <span className="text-xs text-warning">
              {affectedLineCount}{" "}
              {pluralize(
                affectedLineCount,
                "ligne concernée",
                "lignes concernées",
              )}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="mt-3 min-h-11 w-full"
            onClick={onShowAnomalies}
          >
            Afficher les lignes concernées
          </Button>
        </div>
      ) : null}

      <p className="mt-4 rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted-foreground">
        Le contrôle complet sera relancé lors de l’envoi.
      </p>

      <Button
        type="button"
        variant="ghost"
        size="md"
        className="mt-3 min-h-11 w-full justify-between"
        onClick={onToggleCollapsed}
        aria-expanded={!isCollapsed}
        aria-controls="estimate-finalization-criteria"
      >
        {isCollapsed ? "Voir les critères" : "Masquer les critères"}
        <span className="text-xs text-muted-foreground">
          {checklist.totalCount}
        </span>
      </Button>

      {!isCollapsed ? (
        <div id="estimate-finalization-criteria" className="mt-2 space-y-2">
          {checklist.criteria.map((criterion) => (
            <div
              key={criterion.key}
              className={cn(
                "rounded-lg border px-3 py-2",
                STATUS_PANEL_CLASSNAME[criterion.status],
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      STATUS_TEXT_CLASSNAME[criterion.status],
                    )}
                  >
                    {criterion.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-foreground-secondary">
                    {criterion.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    STATUS_TEXT_CLASSNAME[criterion.status],
                  )}
                >
                  {getCriterionCounterLabel(criterion)}
                </span>
              </div>
              {!criterion.isComplete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className="mt-2 min-h-10 w-full text-foreground-secondary"
                  onClick={() => onCriterionClick(criterion)}
                >
                  {criterion.targetItemId
                    ? "Afficher la ligne"
                    : "Ouvrir le paramétrage"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
