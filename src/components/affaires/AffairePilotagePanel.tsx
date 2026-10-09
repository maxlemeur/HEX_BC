import Link from "next/link";

import { Badge } from "@/components/ui-legacy/Badge";
import { EmptyState } from "@/components/ui-legacy/EmptyState";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
} from "@/lib/affaires/server";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import { AffaireFinishLineActions } from "./AffaireFinishLineActions";
import {
  buildFinishLineCards,
  buildPilotageExceptions,
  buildPilotageSteps,
  type AffairePilotageCurrentVersion,
  type AffairePilotageStructureMode,
  type AffairePilotageWorkspace,
  type FinishLineCard,
  type PilotageAction,
  type PilotageExceptionSeverity,
  type PilotageStep,
  type PilotageStepStatus,
} from "./AffairePilotagePanel.logic";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";
import { ArrowRightIcon, CircleCheckIcon } from "lucide-react";

type AffairePilotagePanelProps = {
  projectId: string;
  projectName: string;
  intakeWorkspace: AffairePilotageWorkspace;
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  registerSummary: AffaireRegisterSummary | null;
  approvalSummary: EstimateApprovalSummary | null;
  currentVersion: AffairePilotageCurrentVersion;
  lineCount: number;
  structureMode?: AffairePilotageStructureMode;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  takeoffEnabled?: boolean;
  onOpenSurface?: (surfaceId: CockpitSurfaceId) => void;
  ghost?: boolean;
  hiddenExceptionIds?: string[];
};

function getStepBadgeVariant(status: PilotageStepStatus) {
  switch (status) {
    case "done":
      return "success";
    case "in_progress":
      return "info";
    case "blocked":
      return "error";
    case "waiting":
      return "neutral";
  }
}

function getStepBadgeLabel(status: PilotageStepStatus) {
  switch (status) {
    case "done":
      return "Terminé";
    case "in_progress":
      return "En cours";
    case "blocked":
      return "Bloqué";
    case "waiting":
      return "En attente";
  }
}

function getExceptionBadgeVariant(severity: PilotageExceptionSeverity) {
  switch (severity) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}

function getExceptionBadgeLabel(severity: PilotageExceptionSeverity) {
  switch (severity) {
    case "critical":
      return "Priorité";
    case "warning":
      return "À vérifier";
    case "info":
      return "À préparer";
  }
}

function getFinishLineBadgeVariant(status: FinishLineCard["status"]) {
  switch (status) {
    case "ready":
      return "success";
    case "blocked":
      return "error";
    case "warning":
      return "warning";
    case "waiting":
    case "unavailable":
      return "neutral";
  }
}

function getFinishLineBadgeLabel(status: FinishLineCard["status"]) {
  switch (status) {
    case "ready":
      return "Prêt";
    case "blocked":
      return "Bloqué";
    case "warning":
      return "À surveiller";
    case "waiting":
      return "En attente";
    case "unavailable":
      return "Indisponible";
  }
}

function ExceptionActionButton({
  action,
  onOpenSurface,
}: {
  action: PilotageAction;
  onOpenSurface?: AffairePilotagePanelProps["onOpenSurface"];
}) {
  if (action.kind === "href") {
    return (
      <Link
        href={action.href}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
      >
        {action.label}
        <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    );
  }

  if (!onOpenSurface) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenSurface(action.surfaceId)}
      className="inline-flex items-center gap-1.5 text-left text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
    >
      {action.label}
      <ArrowRightIcon aria-hidden="true" size={14} />
    </button>
  );
}

const GHOST_STEPS: PilotageStep[] = [
  {
    key: "dossier",
    label: "Dossier",
    status: "waiting",
    summary: "Déposez les pièces du dossier pour lancer le cadrage.",
  },
  {
    key: "brief",
    label: "Brief",
    status: "waiting",
    summary: "Le brief apparait une fois les pièces déposées.",
  },
  {
    key: "devis",
    label: "Structure devis",
    status: "waiting",
    summary: "Importez le DPGF pour matérialiser la base du devis.",
  },
  {
    key: "metre",
    label: "Métré & preuves",
    status: "waiting",
    summary: "Le métré assiste s'active après import.",
  },
  {
    key: "validation",
    label: "Validation & sortie",
    status: "waiting",
    summary: "La sortie se prepare quand la structure est stabilisee.",
  },
];

export function AffairePilotagePanel({
  projectId,
  projectName,
  intakeWorkspace,
  dpgfSource,
  plansSummary,
  registerSummary,
  approvalSummary,
  currentVersion,
  lineCount,
  structureMode = null,
  finishLineSummary,
  takeoffEnabled = false,
  onOpenSurface,
  ghost = false,
  hiddenExceptionIds = [],
}: AffairePilotagePanelProps) {
  const allowSurfaceActions = typeof onOpenSurface === "function";
  const steps = ghost
    ? GHOST_STEPS
    : buildPilotageSteps({
        intakeWorkspace,
        dpgfSource,
        plansSummary,
        approvalSummary,
        currentVersion,
        lineCount,
        structureMode,
        takeoffEnabled,
      });
  const exceptions = ghost
    ? []
    : buildPilotageExceptions({
        projectId,
        intakeWorkspace,
        dpgfSource,
        plansSummary,
        registerSummary,
        approvalSummary,
        allowSurfaceActions,
      }).filter((exception) => !hiddenExceptionIds.includes(exception.id));
  const hasVisibleFinishLine =
    !ghost && currentVersion !== null && finishLineSummary != null;
  const finishLineCards = ghost
    ? []
    : hasVisibleFinishLine
      ? buildFinishLineCards({
        projectId,
        currentVersion,
        finishLineSummary,
      })
      : [];

  return (
    <section className={`dashboard-card p-5 animate-fade-in${ghost ? " relative" : ""}`}>
      {ghost && (
        <div className="absolute inset-x-0 top-0 z-10 rounded-t-xl bg-muted px-4 py-2 text-center text-xs font-medium text-muted-foreground">
          Ce panneau s&apos;activera une fois l&apos;affaire créée
        </div>
      )}
      <div className={ghost ? "pointer-events-none pt-6 opacity-60" : ""}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              Pilotage de l&apos;affaire
            </h2>
          </div>
        </div>

      {finishLineCards.length > 0 ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {finishLineCards.map((card) => (
            <div
              key={card.key}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Finish line
                  </p>
                  <h3 className="mt-2 text-sm font-semibold text-slate-800">
                    {card.label}
                  </h3>
                </div>
                <Badge variant={getFinishLineBadgeVariant(card.status)} size="sm" withDot>
                  {getFinishLineBadgeLabel(card.status)}
                </Badge>
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-600">
                {card.summary}
              </p>

              <ul className="mt-3 space-y-2">
                {card.details.map((detail) => (
                  <li
                    key={`${card.key}-${detail}`}
                    className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-slate-600"
                  >
                    {detail}
                  </li>
                ))}
              </ul>

              {card.action ? (
                <div className="mt-4">
                  <ExceptionActionButton action={card.action} onOpenSurface={onOpenSurface} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {hasVisibleFinishLine ? (
        <AffaireFinishLineActions
          projectId={projectId}
          projectName={projectName}
          currentVersion={currentVersion}
          finishLineSummary={finishLineSummary}
        />
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-border bg-surface-subtle/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-800">
              Timeline du flux principal
            </h3>
            <span className="text-xs text-subtle-foreground">
              État reconstruit depuis l&apos;affaire
            </span>
          </div>

          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${
                      step.status === "done"
                        ? "border-success bg-success-subtle text-success"
                        : step.status === "blocked"
                          ? "border-danger bg-danger-subtle text-danger"
                          : step.status === "in_progress"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-surface text-subtle-foreground"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  {index < steps.length - 1 ? (
                    <span
                      className={`mt-2 h-full min-h-10 w-px ${
                        step.status === "done"
                          ? "bg-success/30"
                          : "bg-slate-200"
                      }`}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {step.label}
                    </p>
                    <Badge variant={getStepBadgeVariant(step.status)} size="sm" withDot>
                      {getStepBadgeLabel(step.status)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    {step.summary}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-800">
              Exceptions à traiter
            </h3>
            <span className="text-xs text-subtle-foreground">
              Priorise par impact
            </span>
          </div>

          {exceptions.length === 0 ? (
            <EmptyState
              icon={
                <CircleCheckIcon strokeWidth="1.5" aria-hidden="true" size={26} />
              }
              title="Rien d'urgent à reprendre"
              description="Le dossier peut avancer sans repasser par une revue exhaustive."
              className="border border-dashed border-border bg-surface-subtle/70 py-10"
            />
          ) : (
            <ul className="space-y-3">
              {exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className="rounded-xl border border-border bg-surface-subtle/70 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={getExceptionBadgeVariant(exception.severity)}
                      size="sm"
                      withDot
                    >
                      {getExceptionBadgeLabel(exception.severity)}
                    </Badge>
                    <p className="text-sm font-semibold text-slate-800">
                      {exception.title}
                    </p>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    {exception.summary}
                  </p>
                  <div className="mt-3">
                    <ExceptionActionButton
                      action={exception.action}
                      onOpenSurface={onOpenSurface}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </div>
    </section>
  );
}
