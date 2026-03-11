import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
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
  countPrioritizedFinishLineBlockers,
  type AffairePilotageCurrentVersion,
  type AffairePilotageWorkspace,
  type FinishLineCard,
  type PilotageAction,
  type PilotageExceptionSeverity,
  type PilotageStep,
  type PilotageStepStatus,
} from "./AffairePilotagePanel.logic";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

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
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  takeoffEnabled?: boolean;
  onOpenSurface?: (surfaceId: CockpitSurfaceId) => void;
  ghost?: boolean;
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
      return "Termine";
    case "in_progress":
      return "En cours";
    case "blocked":
      return "Bloque";
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
      return "Priorite";
    case "warning":
      return "A verifier";
    case "info":
      return "A preparer";
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
      return "Pret";
    case "blocked":
      return "Bloque";
    case "warning":
      return "A surveiller";
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
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
      >
        {action.label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
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
      className="inline-flex items-center gap-1.5 text-left text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
    >
      {action.label}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </button>
  );
}

const GHOST_STEPS: PilotageStep[] = [
  {
    key: "dossier",
    label: "Dossier",
    status: "waiting",
    summary: "Deposez les pieces du dossier pour lancer le cadrage.",
  },
  {
    key: "brief",
    label: "Brief",
    status: "waiting",
    summary: "Le brief apparait une fois les pieces deposees.",
  },
  {
    key: "devis",
    label: "Structure devis",
    status: "waiting",
    summary: "Importez le DPGF pour materialiser la base du devis.",
  },
  {
    key: "metre",
    label: "Metre & preuves",
    status: "waiting",
    summary: "Le metre assiste s'active apres import.",
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
  finishLineSummary,
  takeoffEnabled = false,
  onOpenSurface,
  ghost = false,
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
      });
  const finishLineCards = ghost
    ? []
    : buildFinishLineCards({
        projectId,
        currentVersion,
        finishLineSummary,
      });
  const prioritizedBlockerCount = ghost
    ? 0
    : exceptions.length +
      countPrioritizedFinishLineBlockers({
        finishLineCards,
        finishLineSummary,
        exceptions,
      });

  return (
    <section className={`dashboard-card p-5 animate-fade-in${ghost ? " relative" : ""}`}>
      {ghost && (
        <div className="absolute inset-x-0 top-0 z-10 rounded-t-xl bg-[var(--slate-100)] px-4 py-2 text-center text-xs font-medium text-[var(--slate-500)]">
          Ce panneau s&apos;activera une fois l&apos;affaire creee
        </div>
      )}
      <div className={ghost ? "pointer-events-none pt-6 opacity-60" : ""}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Pilotage de l&apos;affaire
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              La vue par defaut remonte ce qui bloque vraiment et indique ou reprendre.
            </p>
          </div>
          <Badge
            variant={ghost ? "neutral" : prioritizedBlockerCount > 0 ? "warning" : "success"}
            size="sm"
            withDot
            className="self-start"
          >
            {ghost
              ? "En attente"
              : prioritizedBlockerCount > 0
                ? `${prioritizedBlockerCount} point${prioritizedBlockerCount > 1 ? "s" : ""} a traiter`
                : "Aucun blocage prioritaire"}
          </Badge>
        </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {finishLineCards.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl border border-[var(--slate-200)] bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
                  Finish line
                </p>
                <h3 className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
                  {card.label}
                </h3>
              </div>
              <Badge variant={getFinishLineBadgeVariant(card.status)} size="sm" withDot>
                {getFinishLineBadgeLabel(card.status)}
              </Badge>
            </div>

            <p className="mt-3 text-sm leading-6 text-[var(--slate-600)]">
              {card.summary}
            </p>

            <ul className="mt-3 space-y-2">
              {card.details.map((detail) => (
                <li
                  key={`${card.key}-${detail}`}
                  className="rounded-lg bg-[var(--slate-50)] px-3 py-2 text-sm text-[var(--slate-600)]"
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

      {!ghost ? (
        <AffaireFinishLineActions
          projectId={projectId}
          projectName={projectName}
          currentVersion={currentVersion}
          finishLineSummary={finishLineSummary}
        />
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Timeline du flux principal
            </h3>
            <span className="text-xs text-[var(--slate-400)]">
              Etat reconstruit depuis l&apos;affaire
            </span>
          </div>

          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${
                      step.status === "done"
                        ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
                        : step.status === "blocked"
                          ? "border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)]"
                          : step.status === "in_progress"
                            ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                            : "border-[var(--slate-200)] bg-white text-[var(--slate-400)]"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  {index < steps.length - 1 ? (
                    <span
                      className={`mt-2 h-full min-h-10 w-px ${
                        step.status === "done"
                          ? "bg-[var(--success)]/30"
                          : "bg-[var(--slate-200)]"
                      }`}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {step.label}
                    </p>
                    <Badge variant={getStepBadgeVariant(step.status)} size="sm" withDot>
                      {getStepBadgeLabel(step.status)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--slate-600)]">
                    {step.summary}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Exceptions a traiter
            </h3>
            <span className="text-xs text-[var(--slate-400)]">
              Priorise par impact
            </span>
          </div>

          {exceptions.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              }
              title="Rien d'urgent a reprendre"
              description="Le dossier peut avancer sans repasser par une revue exhaustive."
              className="border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/70 py-10"
            />
          ) : (
            <ul className="space-y-3">
              {exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={getExceptionBadgeVariant(exception.severity)}
                      size="sm"
                      withDot
                    >
                      {getExceptionBadgeLabel(exception.severity)}
                    </Badge>
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {exception.title}
                    </p>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--slate-600)]">
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
