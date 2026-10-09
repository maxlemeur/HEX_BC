"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  launchTakeoffFromPlanSet,
} from "@/app/dashboard/affaires/_actions/takeoff";
import { useToast } from "@/components/ui-legacy/Toast";
import { duplicateEstimateVersion } from "@/lib/estimates/client";
import {
  TAKEOFF_LEVEL_BUSINESS_LABELS,
  getTakeoffSelectionWarning,
  isTakeoffLevelCompatible,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";
import type { TakeoffLevel } from "@/lib/takeoff/types";
import { CheckIcon, FileTextIcon, LoaderCircleIcon } from "lucide-react";

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
      className={`rounded-lg border border-primary/20 bg-primary/5 ${compact ? "px-4 py-3" : "px-5 py-4"}`}
    >
      <div aria-live="polite">
        {state === "launching" && (
          <div className="flex items-center gap-2">
            <LoaderCircleIcon className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            <span className="text-xs font-medium text-primary">
              {launchMode === "create_draft_from_current"
                ? "Création du brouillon et lancement de l'analyse..."
                : "Lancement de l'analyse..."}
            </span>
          </div>
        )}

        {state === "success" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckIcon strokeWidth="2.5" className="shrink-0 text-success" aria-hidden="true" size={14} />
              <span className="text-xs font-medium text-success">
                {recoveryUnconfirmed
                  ? "Analyse créée, reprise à vérifier"
                  : queuedForRecovery
                    ? "Analyse enregistrée, démarrage en attente"
                    : "Analyse transmise au traitement"}
              </span>
            </div>
            <p className="text-xs text-slate-600">
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
                className="inline-flex rounded-sm text-xs text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Suivre l&apos;avancement
              </Link>
            )}
          </div>
        )}

        {state === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded border border-danger/20 bg-danger/5 px-3 py-2">
              <span className="text-xs text-danger">
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
            <FileTextIcon className="shrink-0 text-primary" aria-hidden="true" size={16} />
            <span className="text-sm font-semibold text-slate-800">
              {promptTitle}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            {planSetName ? (
              <p className="text-xs text-slate-600">
                Jeu de plans :{" "}
                <span className="font-medium text-slate-800">
                  {planSetName}
                </span>{" "}
                ({planFileCount} fichier{planFileCount > 1 ? "s" : ""})
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                {planFileCount} fichier{planFileCount > 1 ? "s" : ""} seront analysés.
              </p>
            )}
            <p className="text-xs text-slate-600">
              Niveau recommandé :{" "}
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {launchRecommendation.recommendedLevel
                  ? TAKEOFF_LEVEL_BUSINESS_LABELS[launchRecommendation.recommendedLevel]
                  : "Choix manuel"}
              </span>
            </p>
            <p className="text-xs text-slate-600">
              Version cible :{" "}
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground-secondary">
                {resolvedVersionLabel}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Résultats disponibles dans le centre d&apos;activité des métrés après lancement.
            </p>
            <p className="text-xs text-muted-foreground">
              Bénéfice attendu : les quantités seront extraites de vos plans pour alimenter le chiffrage.
            </p>
            <fieldset className="pt-1">
              <legend className="text-xs font-medium text-slate-600">
                Niveau à lancer
              </legend>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
                {launchableLevels.map((level) => (
                  <label
                    key={level}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                      selectedLevel === level
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface text-foreground-secondary"
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
                    ? "border-warning/30 bg-warning/10 text-warning"
                    : "border-primary/15 bg-surface/80 text-foreground-secondary"
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
                className="rounded-sm text-xs text-subtle-foreground underline underline-offset-2 hover:text-slate-600 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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
