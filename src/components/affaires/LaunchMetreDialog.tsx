"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import {
  launchTakeoffFromPlanSet,
  launchTakeoffFromSourceVersionPlanSet,
} from "@/app/dashboard/affaires/_actions/takeoff";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  TAKEOFF_LEVEL_BUSINESS_LABELS,
  getTakeoffSelectionWarning,
  isTakeoffLevelCompatible,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";
import {
  fetchPlanSetsForProject,
  type PlanSetListItem,
  type TakeoffLevel,
} from "@/lib/takeoff/client";

type PlanSetTakeoffLevel = Extract<TakeoffLevel, "B" | "C">;

export type LaunchMetrePlanSetOption = {
  id: string;
  name: string;
  fileCount: number;
  source?: string | null;
};

function isPlanSetTakeoffLevel(level: TakeoffLevel | null | undefined): level is PlanSetTakeoffLevel {
  return level === "B" || level === "C";
}

const ANALYSIS_LEVELS: Array<{
  level: PlanSetTakeoffLevel;
  label: string;
  description: string;
}> = [
  { level: "B", label: "Standard", description: "Analyse standard avec recoupements." },
  { level: "C", label: "Détaillé", description: "Analyse approfondie poste par poste." },
];

function getCompatibleAnalysisLevels(
  recommendation: TakeoffDocumentRecommendation | null | undefined,
) {
  if (!recommendation) {
    return ANALYSIS_LEVELS;
  }

  const compatibleLevels = new Set(
    recommendation.compatibleLevels.filter(
      (level): level is PlanSetTakeoffLevel => level === "B" || level === "C",
    ),
  );
  return ANALYSIS_LEVELS.filter(({ level }) => compatibleLevels.has(level));
}

function toLaunchPlanSetOption(planSet: PlanSetListItem): LaunchMetrePlanSetOption {
  const source =
    typeof planSet.metadata?.source === "string"
      ? planSet.metadata.source
      : null;

  return {
    id: planSet.id,
    name: planSet.name.trim() || "Jeu de plans",
    fileCount: Math.max(0, planSet.file_count),
    source,
  };
}

type LaunchMetreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunched?: (jobId: string) => void;
  projectId: string;
  currentVersion:
    | {
        id: string;
        status: string;
        versionNumber: number;
      }
    | null;
  plansContext:
    | {
        defaultPlanSetId: string | null;
        defaultPlanSetName?: string | null;
        defaultPlanSetSource?: string | null;
        defaultPlanSetFileCount?: number;
        launchRecommendation?: TakeoffDocumentRecommendation | null;
      }
    | null;
  availableVersions?: Array<{
    id: string;
    versionNumber: number;
  }>;
  availablePlanSets?: LaunchMetrePlanSetOption[];
  initialPlanSetId?: string | null;
};

type LaunchVersionOption = {
  id: string;
  versionNumber: number;
  mode: "existing_draft" | "create_draft_from_source";
  label: string;
  helper: string;
};

type LaunchVersionMode = LaunchVersionOption["mode"] | "missing";

function isIntakeSyncedPlanSet(source: string | null | undefined) {
  return source === "affaire-intake";
}

function buildVersionOptions(input: {
  currentVersion: LaunchMetreDialogProps["currentVersion"];
  availableVersions: NonNullable<LaunchMetreDialogProps["availableVersions"]>;
}) {
  const seen = new Set<string>();
  const sortedVersions = [...input.availableVersions].sort(
    (left, right) => right.versionNumber - left.versionNumber,
  );
  const options: LaunchVersionOption[] = [];

  if (input.currentVersion?.status === "draft") {
    options.push({
      id: input.currentVersion.id,
      versionNumber: input.currentVersion.versionNumber,
      mode: "existing_draft",
      label: `Utiliser V${input.currentVersion.versionNumber} (brouillon courant)`,
      helper: "Le métré sera rattaché directement à ce brouillon.",
    });
    seen.add(input.currentVersion.id);
  }

  for (const version of sortedVersions) {
    if (seen.has(version.id)) {
      continue;
    }

    options.push({
      id: version.id,
      versionNumber: version.versionNumber,
      mode: "create_draft_from_source",
      label: `Créer un brouillon depuis V${version.versionNumber}`,
      helper: `Un nouveau brouillon sera créé depuis V${version.versionNumber} avant lancement.`,
    });
    seen.add(version.id);
  }

  if (options.length === 0 && input.currentVersion) {
    options.push({
      id: input.currentVersion.id,
      versionNumber: input.currentVersion.versionNumber,
      mode:
        input.currentVersion.status === "draft"
          ? "existing_draft"
          : "create_draft_from_source",
      label:
        input.currentVersion.status === "draft"
          ? `Utiliser V${input.currentVersion.versionNumber} (brouillon courant)`
          : `Créer un brouillon depuis V${input.currentVersion.versionNumber}`,
      helper:
        input.currentVersion.status === "draft"
          ? "Le métré sera rattaché directement à ce brouillon."
          : `Un nouveau brouillon sera créé depuis V${input.currentVersion.versionNumber} avant lancement.`,
    });
  }

  return options;
}

export function LaunchMetreDialog({
  open,
  ...props
}: LaunchMetreDialogProps) {
  if (!open) {
    return null;
  }

  return <LaunchMetreDialogContent {...props} open={open} />;
}

function LaunchMetreDialogContent({
  open,
  onOpenChange,
  onLaunched,
  projectId,
  currentVersion,
  plansContext,
  availableVersions = [],
  availablePlanSets,
  initialPlanSetId = null,
}: LaunchMetreDialogProps) {
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [launchQueuedForRecovery, setLaunchQueuedForRecovery] = useState(false);
  const [launchRecoveryUnconfirmed, setLaunchRecoveryUnconfirmed] = useState(false);
  const [launchSuccessVersionLabel, setLaunchSuccessVersionLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedPlanSetId, setSelectedPlanSetId] = useState<string | null>(
    initialPlanSetId ?? plansContext?.defaultPlanSetId ?? null,
  );
  const shouldFetchPlanSets = availablePlanSets === undefined;
  const {
    data: fetchedPlanSets,
    error: planSetsLoadError,
    isLoading: isLoadingPlanSets,
    mutate: reloadPlanSets,
  } = useSWR<PlanSetListItem[]>(
    shouldFetchPlanSets ? ["launch-metre-plan-sets", projectId] : null,
    () => fetchPlanSetsForProject(projectId),
    {
      revalidateOnFocus: false,
    },
  );
  const fallbackPlanSet = useMemo<LaunchMetrePlanSetOption | null>(
    () =>
      plansContext?.defaultPlanSetId
        ? {
            id: plansContext.defaultPlanSetId,
            name: plansContext.defaultPlanSetName ?? "Plans de l'affaire",
            fileCount: plansContext.defaultPlanSetFileCount ?? 0,
            source: plansContext.defaultPlanSetSource ?? null,
          }
        : null,
    [plansContext],
  );
  const planSetOptions = useMemo(() => {
    const byId = new Map<string, LaunchMetrePlanSetOption>();
    const candidates =
      availablePlanSets ?? fetchedPlanSets?.map(toLaunchPlanSetOption) ?? [];

    for (const option of candidates) {
      byId.set(option.id, {
        ...option,
        name: option.name.trim() || "Jeu de plans",
        fileCount: Math.max(0, option.fileCount),
      });
    }

    if (fallbackPlanSet && !byId.has(fallbackPlanSet.id)) {
      byId.set(fallbackPlanSet.id, fallbackPlanSet);
    }

    return [...byId.values()];
  }, [availablePlanSets, fallbackPlanSet, fetchedPlanSets]);
  const selectedPlanSet = useMemo(
    () =>
      planSetOptions.find((option) => option.id === selectedPlanSetId) ??
      null,
    [planSetOptions, selectedPlanSetId],
  );
  const selectedPlanSetRecommendation =
    selectedPlanSet?.id === plansContext?.defaultPlanSetId
      ? plansContext?.launchRecommendation ?? null
      : null;
  const compatibleAnalysisLevels = useMemo(
    () => getCompatibleAnalysisLevels(selectedPlanSetRecommendation),
    [selectedPlanSetRecommendation],
  );
  const versionOptions = useMemo(
    () =>
      buildVersionOptions({
        currentVersion,
        availableVersions,
      }),
    [availableVersions, currentVersion],
  );
  const [selectedLevel, setSelectedLevel] = useState<PlanSetTakeoffLevel>(
    isPlanSetTakeoffLevel(selectedPlanSetRecommendation?.recommendedLevel) &&
      compatibleAnalysisLevels.some(
        ({ level }) => level === selectedPlanSetRecommendation?.recommendedLevel,
      )
      ? selectedPlanSetRecommendation.recommendedLevel
      : compatibleAnalysisLevels[0]?.level ?? "B",
  );

  const selectedVersionOption = useMemo(
    () =>
      versionOptions.find((option) => option.id === selectedVersionId) ??
      versionOptions[0] ??
      null,
    [selectedVersionId, versionOptions],
  );
  const versionMode: LaunchVersionMode =
    selectedVersionOption?.mode ??
    (currentVersion ? "create_draft_from_source" : "missing");
  const hasTargetVersion = selectedVersionOption !== null;
  const hasPlanFiles = (selectedPlanSet?.fileCount ?? 0) > 0;
  const hasUsablePlanSet = planSetOptions.some((option) => option.fileCount > 0);
  const versionLabel = selectedVersionOption
    ? selectedVersionOption.mode === "existing_draft"
      ? `V${selectedVersionOption.versionNumber} (brouillon)`
      : `Nouveau brouillon depuis V${selectedVersionOption.versionNumber}`
    : null;
  const selectionWarning = useMemo(
    () =>
      getTakeoffSelectionWarning({
        recommendation: selectedPlanSetRecommendation ?? null,
        selectedLevel,
      }),
    [selectedLevel, selectedPlanSetRecommendation],
  );

  useEffect(() => {
    setSelectedPlanSetId((currentId) => {
      const byId = new Map(planSetOptions.map((option) => [option.id, option]));
      const isUsable = (id: string | null | undefined) =>
        Boolean(id && (byId.get(id)?.fileCount ?? 0) > 0);

      if (isUsable(initialPlanSetId)) return initialPlanSetId;
      if (isUsable(currentId)) return currentId;
      if (isUsable(plansContext?.defaultPlanSetId)) {
        return plansContext?.defaultPlanSetId ?? null;
      }

      const firstUsable = planSetOptions.find((option) => option.fileCount > 0);
      if (firstUsable) return firstUsable.id;
      if (initialPlanSetId && byId.has(initialPlanSetId)) return initialPlanSetId;
      if (currentId && byId.has(currentId)) return currentId;
      return planSetOptions[0]?.id ?? null;
    });
  }, [initialPlanSetId, planSetOptions, plansContext?.defaultPlanSetId]);

  useEffect(() => {
    const recommendedLevel = selectedPlanSetRecommendation?.recommendedLevel;
    if (
      isPlanSetTakeoffLevel(recommendedLevel) &&
      compatibleAnalysisLevels.some(({ level }) => level === recommendedLevel)
    ) {
      setSelectedLevel(recommendedLevel);
      return;
    }

    setSelectedLevel(compatibleAnalysisLevels[0]?.level ?? "B");
  }, [compatibleAnalysisLevels, selectedPlanSetRecommendation?.recommendedLevel]);

  useEffect(() => {
    setSelectedVersionId(versionOptions[0]?.id ?? null);
  }, [versionOptions]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isSubmitting) {
        return;
      }
      onOpenChange(nextOpen);
    },
    [isSubmitting, onOpenChange],
  );

  const handleLaunch = useCallback(async () => {
    if (!selectedPlanSet || !hasPlanFiles) {
      return;
    }

    if (
      selectedPlanSetRecommendation &&
      !isTakeoffLevelCompatible(selectedPlanSetRecommendation, selectedLevel)
    ) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const selectedOption = selectedVersionOption;
      if (!selectedOption) {
        throw new Error("Aucune version cible n'est disponible.");
      }

      let resolvedVersionLabel = versionLabel ?? "Brouillon";
      let createdJobId: string | null = null;
      let queuedForRecovery = false;
      let recoveryUnconfirmed = false;

      if (selectedOption.mode === "existing_draft") {
        const result = await launchTakeoffFromPlanSet({
          projectId,
          planSetId: selectedPlanSet.id,
          versionId: selectedOption.id,
          level: selectedLevel,
        });
        createdJobId = result.jobId;
        queuedForRecovery = result.dispatch?.status === "queued_for_recovery";
        recoveryUnconfirmed =
          result.dispatch?.status === "persistence_unconfirmed";
      } else {
        const result = await launchTakeoffFromSourceVersionPlanSet({
          projectId,
          planSetId: selectedPlanSet.id,
          sourceVersionId: selectedOption.id,
          level: selectedLevel,
        });
        createdJobId = result.jobId;
        queuedForRecovery = result.dispatch?.status === "queued_for_recovery";
        recoveryUnconfirmed =
          result.dispatch?.status === "persistence_unconfirmed";
        resolvedVersionLabel = `Nouveau brouillon depuis V${selectedOption.versionNumber}`;
      }

      if (!createdJobId) {
        throw new Error("Impossible de lancer l'analyse.");
      }

      const toastPayload = {
        title: recoveryUnconfirmed
          ? "Analyse créée, reprise à vérifier"
          : queuedForRecovery
            ? "Analyse enregistrée, démarrage en attente"
            : "Analyse transmise au traitement",
        description: recoveryUnconfirmed
          ? `${resolvedVersionLabel} — le démarrage immédiat et l'enregistrement de la reprise n'ont pas pu être confirmés. Ouvrez le centre d'activité pour réessayer avec l'identifiant ${createdJobId}.`
          : queuedForRecovery
            ? `${resolvedVersionLabel} — la demande est conservée et sera reprise automatiquement. Suivez son état dans le centre d'activité des métrés.`
            : `${resolvedVersionLabel} — ${selectedPlanSet.fileCount} fichier${selectedPlanSet.fileCount > 1 ? "s" : ""} concerné${selectedPlanSet.fileCount > 1 ? "s" : ""}. Prochaine étape : suivre l'analyse dans le centre d'activité des métrés.`,
        durationMs: 6000,
      };
      if (queuedForRecovery || recoveryUnconfirmed) {
        toast.warning(toastPayload);
      } else {
        toast.success(toastPayload);
      }
      setLaunchSuccessVersionLabel(resolvedVersionLabel);
      setLaunchQueuedForRecovery(queuedForRecovery);
      setLaunchRecoveryUnconfirmed(recoveryUnconfirmed);
      setLaunchSuccess(true);
      onLaunched?.(createdJobId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Impossible de lancer l'analyse.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    hasPlanFiles,
    onLaunched,
    projectId,
    selectedLevel,
    selectedPlanSet,
    selectedPlanSetRecommendation,
    selectedVersionOption,
    toast,
    versionLabel,
  ]);

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content
        closeOnOverlayClick={!isSubmitting}
        closeOnEscapeKey={!isSubmitting}
      >
        <Modal.Header>
          <Modal.Title>Analyser les plans</Modal.Title>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>
        <Modal.Body className="max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain pr-1">
          {launchSuccess ? (
            <div aria-live="polite" className="space-y-4 py-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success)]/10">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--success)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-[var(--slate-800)]">
                {launchRecoveryUnconfirmed
                  ? "Analyse créée, reprise à vérifier"
                  : launchQueuedForRecovery
                    ? "Analyse enregistrée, démarrage en attente"
                    : "Analyse transmise au traitement"}
              </p>
              <p className="text-xs text-[var(--slate-500)]">
                {launchSuccessVersionLabel ?? versionLabel ?? "Brouillon"} —{" "}
                {selectedPlanSet?.fileCount ?? 0} fichier
                {(selectedPlanSet?.fileCount ?? 0) > 1 ? "s" : ""}.
                {launchRecoveryUnconfirmed
                  ? " La reprise automatique n'a pas pu être confirmée : ouvrez le centre d'activité et relancez ce job."
                  : launchQueuedForRecovery
                    ? " La demande est conservée et sera reprise automatiquement."
                    : " Le traitement a accepté la demande."}
              </p>
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-center sm:gap-3">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm w-full justify-center sm:w-auto"
                  onClick={() => onOpenChange(false)}
                >
                  Fermer
                </button>
                <Link
                  href={`/dashboard/affaires/${projectId}/takeoff`}
                  className="btn btn-primary btn-sm inline-flex w-full justify-center sm:w-auto"
                  onClick={() => onOpenChange(false)}
                >
                  Centre d&apos;activité
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {isLoadingPlanSets && !hasUsablePlanSet ? (
                <div className="py-6 text-center" role="status">
                  <p className="text-sm text-[var(--slate-600)]">
                    Chargement des jeux de plans…
                  </p>
                </div>
              ) : selectedPlanSet && hasPlanFiles ? (
                <>
                  <div>
                    {planSetOptions.length > 1 ? (
                      <>
                        <label
                          className="mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]"
                          htmlFor="launch-metre-plan-set"
                        >
                          Jeu de plans à analyser
                        </label>
                        <select
                          id="launch-metre-plan-set"
                          name="launch-metre-plan-set"
                          className="form-select mb-2 w-full"
                          value={selectedPlanSet.id}
                          onChange={(event) => {
                            setSelectedPlanSetId(event.target.value);
                            setErrorMessage(null);
                          }}
                          disabled={isSubmitting}
                          autoComplete="off"
                        >
                          {planSetOptions.map((option) => (
                            <option
                              key={option.id}
                              value={option.id}
                              disabled={option.fileCount === 0}
                            >
                              {option.name} — {option.fileCount > 0
                                ? `${option.fileCount} fichier${option.fileCount > 1 ? "s" : ""}`
                                : "vide"}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                        Jeu de plans à analyser
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Badge variant="info" size="sm">
                        {selectedPlanSet.name}
                      </Badge>
                      <span className="text-xs text-[var(--slate-500)]">
                        {selectedPlanSet.fileCount} fichier
                        {selectedPlanSet.fileCount > 1 ? "s" : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--slate-500)]">
                      {isIntakeSyncedPlanSet(selectedPlanSet.source)
                        ? "Plans synchronisés depuis le dossier de l'affaire. Seuls les plans confirmés sont repris ici."
                        : "Vérifiez que ce jeu contient bien les plans à analyser."}
                    </p>
                    {planSetsLoadError ? (
                      <div
                        className="mt-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--slate-700)]"
                        role="status"
                      >
                        <p>
                          La liste complète des jeux n’a pas pu être actualisée.
                        </p>
                        <button
                          type="button"
                          className="mt-1 font-semibold underline"
                          onClick={() => void reloadPlanSets()}
                        >
                          Réessayer
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className={!hasTargetVersion ? "opacity-50" : ""}>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                      Version cible
                    </p>
                    {selectedVersionOption ? (
                      <div className="space-y-2">
                        <label className="sr-only" htmlFor="launch-metre-target-version">
                          Version cible
                        </label>
                        <select
                          id="launch-metre-target-version"
                          name="launch-metre-target-version"
                          className="form-select"
                          value={selectedVersionOption.id}
                          onChange={(event) => setSelectedVersionId(event.target.value)}
                          disabled={isSubmitting || !hasTargetVersion}
                          autoComplete="off"
                        >
                          {versionOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <Badge variant="info" size="sm">
                            {versionLabel}
                          </Badge>
                          <span className="text-xs text-[var(--slate-500)]">
                            {selectedVersionOption.helper}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--slate-400)]">
                        Aucune version cible disponible.
                      </p>
                    )}
                  </div>

                  <fieldset className={!hasTargetVersion ? "opacity-50" : ""}>
                    <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                      Niveau d&apos;analyse
                    </legend>
                    <div className="space-y-2" role="radiogroup">
                      {compatibleAnalysisLevels.map((level) => (
                        <label
                          key={level.level}
                          aria-label={level.label}
                          className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                            selectedLevel === level.level
                              ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 cursor-pointer"
                              : "border-[var(--slate-200)] bg-white cursor-pointer"
                          }`}
                        >
                          <input
                            type="radio"
                            name="analysis-level"
                            value={level.level}
                            checked={selectedLevel === level.level}
                            onChange={() => setSelectedLevel(level.level)}
                            className="mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-[var(--slate-800)]">
                              {level.label}
                            </span>
                            <p className="text-xs text-[var(--slate-500)]">
                              {level.description}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                    {selectedPlanSetRecommendation ? (
                      <div className="mt-3 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-3 py-2">
                        <p className="text-xs text-[var(--slate-700)]">
                          Niveau recommandé :{" "}
                          {selectedPlanSetRecommendation.recommendedLevel ? (
                            <span className="font-semibold text-[var(--brand-blue)]">
                              {TAKEOFF_LEVEL_BUSINESS_LABELS[
                                selectedPlanSetRecommendation.recommendedLevel
                              ]}
                            </span>
                          ) : (
                            <span className="font-semibold text-[var(--warning)]">
                              Choix manuel requis
                            </span>
                          )}
                        </p>
                        {selectionWarning ? (
                          <p
                            className={`mt-1 text-xs ${
                              selectionWarning.severity === "critical"
                                ? "text-[var(--warning)]"
                                : "text-[var(--slate-600)]"
                            }`}
                          >
                            {selectionWarning.message}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </fieldset>

                  <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2">
                    <p className="text-xs text-[var(--slate-600)]">
                      Résultats disponibles dans le centre d&apos;activité des métrés après lancement.
                    </p>
                  </div>

                  {errorMessage ? (
                    <div
                      className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-3 py-2 text-sm text-[var(--error)]"
                      role="alert"
                    >
                      {errorMessage}
                    </div>
                  ) : null}

                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm w-full justify-center sm:w-auto"
                      onClick={() => onOpenChange(false)}
                      disabled={isSubmitting}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm w-full justify-center sm:w-auto"
                      onClick={() => void handleLaunch()}
                      disabled={isSubmitting || !hasTargetVersion}
                    >
                      {versionMode === "create_draft_from_source"
                        ? "Créer un brouillon et analyser"
                        : "Analyser maintenant"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-4 text-center">
                  <p className="text-sm text-[var(--slate-600)]">
                    Aucun jeu de plans exploitable n&apos;est disponible pour cette affaire.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {planSetsLoadError ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void reloadPlanSets()}
                      >
                        Réessayer
                      </button>
                    ) : null}
                    <Link
                      href={`/dashboard/affaires/${projectId}/plans`}
                      className="btn btn-secondary btn-sm inline-flex"
                    >
                      Voir les plans
                    </Link>
                  </div>
                </div>
              )}

              {!hasTargetVersion ? (
                <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
                  Créez d&apos;abord une première version pour lancer l&apos;analyse sur une cible de chiffrage.
                  <div className="mt-3">
                    <Link
                      href={`/dashboard/estimates/new?projectId=${projectId}`}
                      className="btn btn-secondary btn-sm inline-flex"
                    >
                      Créer une première version
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
