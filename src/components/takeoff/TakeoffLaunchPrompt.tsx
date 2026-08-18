"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  launchTakeoffFromPlanSet,
} from "@/app/dashboard/affaires/_actions/takeoff";
import { useToast } from "@/components/ui/Toast";
import { duplicateEstimateVersion } from "@/lib/estimates/client";
import {
  TAKEOFF_LEVEL_BUSINESS_LABELS,
  getTakeoffSelectionWarning,
  isTakeoffLevelCompatible,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";
import type { TakeoffLevel } from "@/lib/takeoff/types";

type PlanSetTakeoffLevel = Extract<TakeoffLevel, "B" | "C">;

function isPlanSetTakeoffLevel(level: TakeoffLevel | null | undefined): level is PlanSetTakeoffLevel {
  return level === "B" || level === "C";
}

const RECENT_PROMPT_WINDOW_MS = 24 * 60 * 60 * 1000;

type PromptLaunchMode = "existing_draft" | "create_draft_from_current";

export function shouldShowTakeoffPrompt(input: {
  takeoffEnabled: boolean;
  planFileCount: number;
  defaultPlanSetId: string | null;
  defaultPlanSetUpdatedAt: string | null;
  latestJob:
    | {
        status: string;
        planSetId: string | null;
        estimateVersionId?: string | null;
        createdAt: string;
      }
    | null;
  targetVersionId: string | null;
  hasLaunchableVersionTarget: boolean;
  permanentlyDismissed: boolean;
  temporarilyDismissed: boolean;
}): boolean {
  if (!input.takeoffEnabled) return false;
  if (input.planFileCount === 0) return false;
  if (!input.defaultPlanSetId) return false;
  if (!input.hasLaunchableVersionTarget) return false;
  if (input.permanentlyDismissed) return false;
  if (input.temporarilyDismissed) return false;
  if (!input.latestJob) return true;
  if (input.latestJob.planSetId !== input.defaultPlanSetId) return true;
  if (
    input.latestJob.status === "action_required" ||
    input.latestJob.status === "failed" ||
    input.latestJob.status === "canceled"
  ) {
    return true;
  }

  const createdAt = new Date(input.latestJob.createdAt);
  if (Number.isNaN(createdAt.getTime())) return true;

  const planSetWasUpdatedAfterJob =
    typeof input.defaultPlanSetUpdatedAt === "string" &&
    input.defaultPlanSetUpdatedAt.localeCompare(input.latestJob.createdAt) > 0;
  if (planSetWasUpdatedAfterJob) {
    return true;
  }

  if (
    input.targetVersionId &&
    input.latestJob.estimateVersionId &&
    input.latestJob.estimateVersionId !== input.targetVersionId
  ) {
    return true;
  }

  const ageMs = Date.now() - createdAt.getTime();
  return ageMs > RECENT_PROMPT_WINDOW_MS;
}

type TakeoffLaunchPromptProps = {
  projectId: string;
  versionId?: string | null;
  versionLabel?: string;
  sourceVersionId?: string | null;
  sourceVersionLabel?: string;
  planSetId: string;
  planSetName?: string | null;
  planFileCount: number;
  launchRecommendation: TakeoffDocumentRecommendation;
  onLaunched?: (jobId: string, versionId: string) => void;
  onDismissTemporary?: () => void;
  onDismissPermanent?: () => void;
  compact?: boolean;
  resultsHref?: string;
  title?: string;
};

type PromptState = "idle" | "launching" | "success" | "error";

function resolveLaunchMode(input: {
  versionId?: string | null;
  sourceVersionId?: string | null;
}): PromptLaunchMode | null {
  if (input.versionId) {
    return "existing_draft";
  }

  if (input.sourceVersionId) {
    return "create_draft_from_current";
  }

  return null;
}

function getLaunchableLevels(recommendation: TakeoffDocumentRecommendation) {
  return recommendation.compatibleLevels.filter(
    (level): level is PlanSetTakeoffLevel => level === "B" || level === "C",
  );
}

export function TakeoffLaunchPrompt({
  projectId,
  versionId,
  versionLabel,
  sourceVersionId,
  sourceVersionLabel,
  planSetId,
  planSetName,
  planFileCount,
  launchRecommendation,
  onLaunched,
  onDismissTemporary,
  onDismissPermanent,
  compact,
  resultsHref,
  title,
}: TakeoffLaunchPromptProps) {
  const toast = useToast();
  const launchMode = resolveLaunchMode({ versionId, sourceVersionId });
  const [state, setState] = useState<PromptState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [queuedForRecovery, setQueuedForRecovery] = useState(false);
  const [recoveryUnconfirmed, setRecoveryUnconfirmed] = useState(false);
  const [launchedVersionLabel, setLaunchedVersionLabel] = useState<string | null>(null);
  const [pendingDraftVersionId, setPendingDraftVersionId] = useState<string | null>(null);
  const launchableLevels = useMemo(
    () => getLaunchableLevels(launchRecommendation),
    [launchRecommendation],
  );
  const [selectedLevel, setSelectedLevel] = useState<PlanSetTakeoffLevel | null>(
    isPlanSetTakeoffLevel(launchRecommendation.recommendedLevel) &&
      launchableLevels.includes(launchRecommendation.recommendedLevel)
      ? launchRecommendation.recommendedLevel
      : launchableLevels[0] ?? null,
  );

  const resolvedVersionLabel =
    typeof versionLabel === "string" && versionLabel.trim().length > 0
      ? versionLabel.trim()
      : launchMode === "create_draft_from_current" &&
          typeof sourceVersionLabel === "string" &&
          sourceVersionLabel.trim().length > 0
        ? `Nouveau brouillon depuis ${sourceVersionLabel.trim()}`
        : "Brouillon en cours";

  const levelWarning = getTakeoffSelectionWarning({
    recommendation: launchRecommendation,
    selectedLevel,
  });

  useEffect(() => {
    if (
      isPlanSetTakeoffLevel(launchRecommendation.recommendedLevel) &&
      launchableLevels.includes(launchRecommendation.recommendedLevel)
    ) {
      setSelectedLevel(launchRecommendation.recommendedLevel);
      return;
    }

    setSelectedLevel(launchableLevels[0] ?? null);
  }, [launchRecommendation, launchableLevels]);

  useEffect(() => {
    setPendingDraftVersionId(null);
  }, [planSetId, projectId, sourceVersionId, versionId]);

  const handleLaunch = useCallback(async () => {
    if (!selectedLevel || !launchMode) {
      return;
    }

    if (!isTakeoffLevelCompatible(launchRecommendation, selectedLevel)) {
      return;
    }

    setState("launching");
    setErrorMessage(null);

    try {
      let resolvedVersionId = versionId ?? pendingDraftVersionId ?? null;
      let resolvedVersionLabelForLaunch = resolvedVersionLabel;
      let createdJobIdForLaunch: string | null = null;

      if (launchMode === "create_draft_from_current") {
        if (!sourceVersionId) {
          throw new Error("Impossible de créer un brouillon cible.");
        }

        if (!resolvedVersionId) {
          resolvedVersionId = await duplicateEstimateVersion(sourceVersionId);
          setPendingDraftVersionId(resolvedVersionId);
        }
        resolvedVersionLabelForLaunch = resolvedVersionLabel;
      }

      if (!resolvedVersionId) {
        throw new Error("Aucune version cible n'est disponible.");
      }

      const result = await launchTakeoffFromPlanSet({
        projectId,
        planSetId,
        versionId: resolvedVersionId,
        level: selectedLevel,
      });
      createdJobIdForLaunch = result.jobId;
      const launchQueuedForRecovery =
        result.dispatch?.status === "queued_for_recovery";
      const launchRecoveryUnconfirmed =
        result.dispatch?.status === "persistence_unconfirmed";

      if (!resolvedVersionId || !createdJobIdForLaunch) {
        throw new Error("Impossible de lancer l'analyse.");
      }

      setCreatedJobId(createdJobIdForLaunch);
      setQueuedForRecovery(launchQueuedForRecovery);
      setRecoveryUnconfirmed(launchRecoveryUnconfirmed);
      setLaunchedVersionLabel(resolvedVersionLabelForLaunch);
      setState("success");
      const toastPayload = {
        title: launchRecoveryUnconfirmed
          ? "Analyse créée, reprise à vérifier"
          : launchQueuedForRecovery
            ? "Analyse enregistrée, démarrage en attente"
            : "Analyse transmise au traitement",
        description: launchRecoveryUnconfirmed
          ? `${resolvedVersionLabelForLaunch} — ni le démarrage immédiat ni la reprise automatique n'ont pu être confirmés. Ouvrez le centre d'activité pour réessayer.`
          : launchQueuedForRecovery
            ? `${resolvedVersionLabelForLaunch} — la demande est conservée et sera reprise automatiquement.`
            : `${resolvedVersionLabelForLaunch} — ${planFileCount} plan${planFileCount > 1 ? "s" : ""} pris en compte. Prochaine étape : suivre l'analyse dans le centre d'activité des métrés.`,
      };
      if (launchQueuedForRecovery || launchRecoveryUnconfirmed) {
        toast.warning(toastPayload);
      } else {
        toast.success(toastPayload);
      }
      onLaunched?.(createdJobIdForLaunch, resolvedVersionId);
    } catch (err) {
      setState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Impossible de lancer l'analyse.",
      );
    }
  }, [
    launchMode,
    launchRecommendation,
    onLaunched,
    planFileCount,
    planSetId,
    projectId,
    resolvedVersionLabel,
    selectedLevel,
    sourceVersionId,
    toast,
    versionId,
    pendingDraftVersionId,
  ]);

  const handleRetry = useCallback(() => {
    void handleLaunch();
  }, [handleLaunch]);

  const primaryActionLabel =
    launchMode === "create_draft_from_current"
      ? "Créer un brouillon et analyser"
      : "Analyser maintenant";

  const promptTitle = title ?? "Lancer une première analyse";
  const resolvedResultsHref =
    resultsHref ?? `/dashboard/affaires/${projectId}/takeoff`;

  return (
    <div
      role="region"
      aria-label="Proposition d'analyse automatique"
      className={`rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 ${compact ? "px-4 py-3" : "px-5 py-4"}`}
    >
      <div aria-live="polite">
        {state === "launching" && (
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin text-[var(--brand-blue)]"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-xs font-medium text-[var(--brand-blue)]">
              {launchMode === "create_draft_from_current"
                ? "Création du brouillon et lancement de l'analyse..."
                : "Lancement de l'analyse..."}
            </span>
          </div>
        )}

        {state === "success" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-[var(--success)]"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-xs font-medium text-[var(--success)]">
                {recoveryUnconfirmed
                  ? "Analyse créée, reprise à vérifier"
                  : queuedForRecovery
                    ? "Analyse enregistrée, démarrage en attente"
                    : "Analyse transmise au traitement"}
              </span>
            </div>
            <p className="text-xs text-[var(--slate-600)]">
              {launchedVersionLabel ?? resolvedVersionLabel} — {planFileCount} fichier
              {planFileCount > 1 ? "s" : ""} concerné
              {planFileCount > 1 ? "s" : ""}.
              {recoveryUnconfirmed
                ? " La reprise automatique n'a pas pu être confirmée : ouvrez le suivi pour réessayer."
                : queuedForRecovery
                  ? " La demande sera reprise automatiquement."
                  : " Le traitement a accepté la demande."}
            </p>
            {createdJobId && (
              <Link
                href={resolvedResultsHref}
                className="inline-flex rounded-sm text-xs text-[var(--brand-blue)] underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
              >
                Suivre l&apos;avancement
              </Link>
            )}
          </div>
        )}

        {state === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded border border-[var(--error)]/20 bg-[var(--error)]/5 px-3 py-2">
              <span className="text-xs text-[var(--error)]">
                {errorMessage ?? "Une erreur est survenue."}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={handleRetry}
            >
              Réessayer
            </button>
          </div>
        )}
      </div>

      {state === "idle" && (
        <>
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-[var(--brand-blue)]"
              aria-hidden="true"
            >
              <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span className="text-sm font-semibold text-[var(--slate-800)]">
              {promptTitle}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            {planSetName ? (
              <p className="text-xs text-[var(--slate-600)]">
                Jeu de plans :{" "}
                <span className="font-medium text-[var(--slate-800)]">
                  {planSetName}
                </span>{" "}
                ({planFileCount} fichier{planFileCount > 1 ? "s" : ""})
              </p>
            ) : (
              <p className="text-xs text-[var(--slate-600)]">
                {planFileCount} fichier{planFileCount > 1 ? "s" : ""} seront analysés.
              </p>
            )}
            <p className="text-xs text-[var(--slate-600)]">
              Niveau recommandé :{" "}
              <span className="inline-flex items-center rounded-full bg-[var(--brand-blue)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--brand-blue)]">
                {launchRecommendation.recommendedLevel
                  ? TAKEOFF_LEVEL_BUSINESS_LABELS[launchRecommendation.recommendedLevel]
                  : "Choix manuel"}
              </span>
            </p>
            <p className="text-xs text-[var(--slate-600)]">
              Version cible :{" "}
              <span className="inline-flex items-center rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--slate-700)]">
                {resolvedVersionLabel}
              </span>
            </p>
            <p className="text-xs text-[var(--slate-500)]">
              Résultats disponibles dans le centre d&apos;activité des métrés après lancement.
            </p>
            <p className="text-xs text-[var(--slate-500)]">
              Bénéfice attendu : les quantités seront extraites de vos plans pour alimenter le chiffrage.
            </p>
            <fieldset className="pt-1">
              <legend className="text-xs font-medium text-[var(--slate-600)]">
                Niveau à lancer
              </legend>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
                {launchableLevels.map((level) => (
                  <label
                    key={level}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                      selectedLevel === level
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                        : "border-[var(--slate-200)] bg-white text-[var(--slate-700)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`takeoff-prompt-level-${planSetId}`}
                      checked={selectedLevel === level}
                      onChange={() => setSelectedLevel(level)}
                    />
                    {TAKEOFF_LEVEL_BUSINESS_LABELS[level]}
                  </label>
                ))}
              </div>
            </fieldset>
            {levelWarning ? (
              <div
                className={`rounded border px-3 py-2 text-xs ${
                  levelWarning.severity === "critical"
                    ? "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]"
                    : "border-[var(--brand-blue)]/15 bg-white/80 text-[var(--slate-700)]"
                }`}
                role={levelWarning.severity === "critical" ? "alert" : "status"}
              >
                {levelWarning.message}
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={() => void handleLaunch()}
              disabled={!selectedLevel || !launchMode}
            >
              {primaryActionLabel}
            </button>
            {onDismissTemporary && (
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={onDismissTemporary}
              >
                Me rappeler plus tard
              </button>
            )}
            {onDismissPermanent && (
              <button
                type="button"
                className="rounded-sm text-xs text-[var(--slate-400)] underline underline-offset-2 hover:text-[var(--slate-600)] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
                onClick={onDismissPermanent}
              >
                Ne pas proposer pour cette affaire
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
