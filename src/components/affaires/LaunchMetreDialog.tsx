"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { TakeoffLevel } from "@/lib/takeoff/client";

type PlanSetTakeoffLevel = Extract<TakeoffLevel, "B" | "C">;

function isPlanSetTakeoffLevel(level: TakeoffLevel | null | undefined): level is PlanSetTakeoffLevel {
  return level === "B" || level === "C";
}

const ANALYSIS_LEVELS: Array<{
  level: PlanSetTakeoffLevel;
  label: string;
  description: string;
}> = [
  { level: "B", label: "Standard", description: "Analyse standard avec recoupements." },
  { level: "C", label: "Detaille", description: "Analyse approfondie poste par poste." },
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

type LaunchMetreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      helper: "Le metre sera rattache directement a ce brouillon.",
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
      label: `Creer un brouillon depuis V${version.versionNumber}`,
      helper: `Un nouveau brouillon sera cree depuis V${version.versionNumber} avant lancement.`,
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
          : `Creer un brouillon depuis V${input.currentVersion.versionNumber}`,
      helper:
        input.currentVersion.status === "draft"
          ? "Le metre sera rattache directement a ce brouillon."
          : `Un nouveau brouillon sera cree depuis V${input.currentVersion.versionNumber} avant lancement.`,
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
  projectId,
  currentVersion,
  plansContext,
  availableVersions = [],
}: LaunchMetreDialogProps) {
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [launchSuccessVersionLabel, setLaunchSuccessVersionLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const compatibleAnalysisLevels = useMemo(
    () => getCompatibleAnalysisLevels(plansContext?.launchRecommendation),
    [plansContext?.launchRecommendation],
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
    isPlanSetTakeoffLevel(plansContext?.launchRecommendation?.recommendedLevel) &&
      compatibleAnalysisLevels.some(
        ({ level }) => level === plansContext.launchRecommendation?.recommendedLevel,
      )
      ? plansContext.launchRecommendation.recommendedLevel
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
  const versionLabel = selectedVersionOption
    ? selectedVersionOption.mode === "existing_draft"
      ? `V${selectedVersionOption.versionNumber} (brouillon)`
      : `Nouveau brouillon depuis V${selectedVersionOption.versionNumber}`
    : null;
  const selectionWarning = useMemo(
    () =>
      getTakeoffSelectionWarning({
        recommendation: plansContext?.launchRecommendation ?? null,
        selectedLevel,
      }),
    [plansContext?.launchRecommendation, selectedLevel],
  );

  useEffect(() => {
    const recommendedLevel = plansContext?.launchRecommendation?.recommendedLevel;
    if (
      isPlanSetTakeoffLevel(recommendedLevel) &&
      compatibleAnalysisLevels.some(({ level }) => level === recommendedLevel)
    ) {
      setSelectedLevel(recommendedLevel);
      return;
    }

    setSelectedLevel(compatibleAnalysisLevels[0]?.level ?? "B");
  }, [compatibleAnalysisLevels, plansContext?.launchRecommendation?.recommendedLevel]);

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
    if (!plansContext?.defaultPlanSetId) {
      return;
    }

    if (
      plansContext.launchRecommendation &&
      !isTakeoffLevelCompatible(plansContext.launchRecommendation, selectedLevel)
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

      if (selectedOption.mode === "existing_draft") {
        const result = await launchTakeoffFromPlanSet({
          projectId,
          planSetId: plansContext.defaultPlanSetId,
          versionId: selectedOption.id,
          level: selectedLevel,
        });
        createdJobId = result.jobId;
      } else {
        const result = await launchTakeoffFromSourceVersionPlanSet({
          projectId,
          planSetId: plansContext.defaultPlanSetId,
          sourceVersionId: selectedOption.id,
          level: selectedLevel,
        });
        createdJobId = result.jobId;
        resolvedVersionLabel = `Nouveau brouillon depuis V${selectedOption.versionNumber}`;
      }

      if (!createdJobId) {
        throw new Error("Impossible de lancer l'analyse.");
      }

      toast.success({
        title: "Analyse lancee",
        description: `${resolvedVersionLabel} — ${plansContext.defaultPlanSetFileCount ?? 0} fichier(s) concernes. Prochaine etape : suivre l'analyse dans le centre d'activite metres.`,
        durationMs: 6000,
      });
      setLaunchSuccessVersionLabel(resolvedVersionLabel);
      setLaunchSuccess(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Impossible de lancer l'analyse.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    currentVersion,
    plansContext,
    projectId,
    selectedLevel,
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
        <Modal.Body>
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
                Analyse lancee avec succes
              </p>
              <p className="text-xs text-[var(--slate-500)]">
                {launchSuccessVersionLabel ?? versionLabel ?? "Brouillon"} —{" "}
                {plansContext?.defaultPlanSetFileCount ?? 0} fichier
                {(plansContext?.defaultPlanSetFileCount ?? 0) > 1 ? "s" : ""}.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenChange(false)}
                >
                  Rester sur le hub
                </button>
                <Link
                  href={`/dashboard/affaires/${projectId}/takeoff`}
                  className="btn btn-primary btn-sm inline-flex"
                >
                  Centre d&apos;activite
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {plansContext?.defaultPlanSetId ? (
                <>
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                      Jeu de plans retenu
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant="info" size="sm">
                        {plansContext.defaultPlanSetName ?? "Plans de l'affaire"}
                      </Badge>
                      <span className="text-xs text-[var(--slate-500)]">
                        {plansContext.defaultPlanSetFileCount ?? 0} fichier
                        {(plansContext.defaultPlanSetFileCount ?? 0) > 1 ? "s" : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--slate-500)]">
                      {isIntakeSyncedPlanSet(plansContext.defaultPlanSetSource)
                        ? "Plans synchronises depuis le dossier affaire. Seuls les plans confirmes sont repris ici."
                        : "Verifiez que ce jeu contient bien les plans a analyser."}
                    </p>
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
                          className="form-select"
                          value={selectedVersionOption.id}
                          onChange={(event) => setSelectedVersionId(event.target.value)}
                          disabled={isSubmitting || !hasTargetVersion}
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
                    {plansContext.launchRecommendation ? (
                      <div className="mt-3 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-3 py-2">
                        <p className="text-xs text-[var(--slate-700)]">
                          Niveau recommande :{" "}
                          {plansContext.launchRecommendation.recommendedLevel ? (
                            <span className="font-semibold text-[var(--brand-blue)]">
                              {TAKEOFF_LEVEL_BUSINESS_LABELS[
                                plansContext.launchRecommendation.recommendedLevel
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
                      Resultats disponibles dans le centre d&apos;activite metres apres lancement.
                    </p>
                  </div>

                  {errorMessage ? (
                    <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 px-3 py-2 text-sm text-[var(--error)]">
                      {errorMessage}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenChange(false)}
                      disabled={isSubmitting}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleLaunch()}
                      disabled={isSubmitting || !hasTargetVersion}
                    >
                      {versionMode === "create_draft_from_source"
                        ? "Creer un brouillon et analyser"
                        : "Analyser maintenant"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-4 text-center">
                  <p className="text-sm text-[var(--slate-600)]">
                    Aucun jeu de plans exploitable n&apos;est disponible pour cette affaire.
                  </p>
                  <Link
                    href={`/dashboard/affaires/${projectId}/plans`}
                    className="btn btn-secondary btn-sm mt-4 inline-flex"
                  >
                    Voir les plans
                  </Link>
                </div>
              )}

              {!hasTargetVersion ? (
                <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
                  Creez d&apos;abord une premiere version pour lancer l&apos;analyse sur une cible de chiffrage.
                  <div className="mt-3">
                    <Link
                      href={`/dashboard/estimates/new?projectId=${projectId}`}
                      className="btn btn-secondary btn-sm inline-flex"
                    >
                      Creer une premiere version
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
