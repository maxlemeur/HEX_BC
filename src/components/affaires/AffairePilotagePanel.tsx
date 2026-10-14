"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
} from "@/lib/affaires/server";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import type { PurchaseOrderReadiness } from "@/lib/estimates/purchase-order-readiness";
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
      return "danger";
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
      return "danger";
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
    case "prepared":
      return "success";
    case "blocked":
      return "danger";
    case "warning":
      return "warning";
    case "waiting":
    case "checking":
    case "unavailable":
      return "neutral";
  }
}

function getFinishLineBadgeLabel(card: FinishLineCard) {
  switch (card.status) {
    case "ready":
      return "Prêt";
    case "prepared":
      return "Déjà préparé";
    case "blocked":
      return "Bloqué";
    case "warning":
      return card.key === "order" ? "Partiellement prêt" : "À surveiller";
    case "waiting":
      return "En attente";
    case "checking":
      return "Vérification";
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
    summary: "Le brief apparaît une fois les pièces déposées.",
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
  const versionId = currentVersion?.id ?? null;
  const activeVersionRef = useRef(versionId);
  const [clientReadiness, setClientReadiness] = useState<{
    versionId: string;
    readiness: PurchaseOrderReadiness;
  } | null>(null);
  useLayoutEffect(() => {
    activeVersionRef.current = versionId;
  }, [versionId]);
  const onPreparationReadiness = useCallback(
    (readVersionId: string, readiness: PurchaseOrderReadiness) => {
      if (readVersionId !== activeVersionRef.current) return;
      setClientReadiness({ versionId: readVersionId, readiness });
    },
    [],
  );
  const effectiveFinishLineSummary =
    finishLineSummary && clientReadiness?.versionId === versionId
      ? { ...finishLineSummary, readyToOrder: clientReadiness.readiness }
      : finishLineSummary;
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
        finishLineSummary: effectiveFinishLineSummary,
      })
      : [];

  return (
    <section className={`rounded-lg border border-border bg-surface shadow-card p-5 animate-fade-in${ghost ? " relative" : ""}`}>
      {ghost && (
        <div className="absolute inset-x-0 top-0 z-10 rounded-t-xl bg-muted px-4 py-2 text-center text-xs font-medium text-muted-foreground">
          Ce panneau s&apos;activera une fois l&apos;affaire créée
        </div>
      )}
      <div className={ghost ? "pointer-events-none pt-6 opacity-60" : ""}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
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
                  <h3 className="mt-2 text-sm font-semibold text-foreground">
                    {card.label}
                  </h3>
                </div>
                <Badge variant={getFinishLineBadgeVariant(card.status)} dot>
                  {getFinishLineBadgeLabel(card)}
                </Badge>
              </div>

              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {card.summary}
              </p>

              <ul className="mt-3 space-y-2">
                {card.details.map((detail) => (
                  <li
                    key={`${card.key}-${detail}`}
                    className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-muted-foreground"
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
          onPreparationReadiness={onPreparationReadiness}
        />
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-border bg-surface-subtle/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
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
                          : "bg-border"
                      }`}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {step.label}
                    </p>
                    <Badge variant={getStepBadgeVariant(step.status)} dot>
                      {getStepBadgeLabel(step.status)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {step.summary}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              Exceptions à traiter
            </h3>
            <span className="text-xs text-subtle-foreground">
              Priorise par impact
            </span>
          </div>

          {exceptions.length === 0 ? (
            <EmptyState
              icon={<CircleCheckIcon aria-hidden="true" />}
              title="Rien d'urgent à reprendre"
              description="Le dossier peut avancer sans repasser par une revue exhaustive."
              headingLevel={4}
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
                      dot
                    >
                      {getExceptionBadgeLabel(exception.severity)}
                    </Badge>
                    <p className="text-sm font-semibold text-foreground">
                      {exception.title}
                    </p>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
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
