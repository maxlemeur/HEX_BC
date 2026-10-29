"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  launchPreparedTakeoffFromPlanSetAction,
  launchPreparedTakeoffFromSourceVersionPlanSetAction,
} from "@/app/dashboard/affaires/_actions/takeoff";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/components/ui-legacy/Toast";
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
import { CheckIcon } from "lucide-react";
import { LazyTakeoffPreparationPanel } from "@/components/takeoff/LazyTakeoffPreparationPanel";
import { TakeoffProviderSelect } from "@/components/takeoff/TakeoffProviderSelect";
import type { TakeoffProvider } from "@/lib/takeoff/types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  onLaunched?: (jobId: string, versionId: string) => void;
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

function isIntakeSyncedPlanSet(source: string | null | undefined) {
  return source === "affaire-intake";
}

function versionBusinessLabel(versionNumber: number) {
  return versionNumber > 0 ? `V${versionNumber}` : "version courante";
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
      label: `Utiliser ${versionBusinessLabel(input.currentVersion.versionNumber)} (brouillon courant)`,
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
      label: `Créer un brouillon depuis ${versionBusinessLabel(version.versionNumber)}`,
      helper: `Un nouveau brouillon sera créé depuis ${versionBusinessLabel(version.versionNumber)} avant lancement.`,
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
          ? `Utiliser ${versionBusinessLabel(input.currentVersion.versionNumber)} (brouillon courant)`
          : `Créer un brouillon depuis ${versionBusinessLabel(input.currentVersion.versionNumber)}`,
      helper:
        input.currentVersion.status === "draft"
          ? "Le métré sera rattaché directement à ce brouillon."
          : `Un nouveau brouillon sera créé depuis ${versionBusinessLabel(input.currentVersion.versionNumber)} avant lancement.`,
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
  const savePreparationRef = useRef<(() => Promise<number | null>) | null>(null);
  const registerPreparationSave = useCallback((save: () => Promise<number | null>) => { savePreparationRef.current = save; }, []);
  const [provider, setProvider] = useState<TakeoffProvider>("auto");
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [launchQueuedForRecovery, setLaunchQueuedForRecovery] = useState(false);
  const [launchRecoveryUnconfirmed, setLaunchRecoveryUnconfirmed] = useState(false);
  const [launchSuccessVersionLabel, setLaunchSuccessVersionLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [targetSelectionKey, setTargetSelectionKey] = useState(0);
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
  const hasTargetVersion = selectedVersionOption !== null;
  const hasPlanFiles = (selectedPlanSet?.fileCount ?? 0) > 0;
  const hasUsablePlanSet = planSetOptions.some((option) => option.fileCount > 0);
  const versionLabel = selectedVersionOption
    ? selectedVersionOption.mode === "existing_draft"
      ? `${versionBusinessLabel(selectedVersionOption.versionNumber)} (brouillon)`
      : `Nouveau brouillon depuis ${versionBusinessLabel(selectedVersionOption.versionNumber)}`
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
      if (!nextOpen && !launchSuccess && savePreparationRef.current) {
        setIsSubmitting(true);
        void savePreparationRef.current().then(() => onOpenChange(false)).catch((cause) => { setErrorMessage(cause instanceof TakeoffActionError ? cause.message : "Enregistrez la préparation avant de fermer."); }).finally(() => setIsSubmitting(false));
        return;
      }
      onOpenChange(nextOpen);
    },
    [isSubmitting, launchSuccess, onOpenChange],
  );

  const handleLaunch = useCallback(async (preparationRevision: number) => {
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
      let resolvedVersionId = selectedOption.id;
      let queuedForRecovery = false;
      let recoveryUnconfirmed = false;

      if (selectedOption.mode === "existing_draft") {
        const result = unwrapTakeoffActionResult(await launchPreparedTakeoffFromPlanSetAction({
          projectId,
          planSetId: selectedPlanSet.id,
          versionId: selectedOption.id,
          level: selectedLevel,
          preparationRevision,
          ...(provider !== "auto" ? { provider } : {}),
        }));
        createdJobId = result.jobId;
        queuedForRecovery = result.dispatch?.status === "queued_for_recovery";
        recoveryUnconfirmed =
          result.dispatch?.status === "persistence_unconfirmed";
      } else {
        const result = unwrapTakeoffActionResult(await launchPreparedTakeoffFromSourceVersionPlanSetAction({
          projectId,
          planSetId: selectedPlanSet.id,
          sourceVersionId: selectedOption.id,
          level: selectedLevel,
          preparationRevision,
          ...(provider !== "auto" ? { provider } : {}),
        }));
        createdJobId = result.jobId;
        queuedForRecovery = result.dispatch?.status === "queued_for_recovery";
        recoveryUnconfirmed =
          result.dispatch?.status === "persistence_unconfirmed";
        resolvedVersionLabel = `Nouveau brouillon depuis ${versionBusinessLabel(selectedOption.versionNumber)}`;
        resolvedVersionId = result.versionId;
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
      onLaunched?.(createdJobId, resolvedVersionId);
    } catch (error) {
      setErrorMessage(
        error instanceof TakeoffActionError ? error.message : "Impossible de lancer l'analyse.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    hasPlanFiles,
    onLaunched,
    projectId,
    provider,
    selectedLevel,
    selectedPlanSet,
    selectedPlanSetRecommendation,
    selectedVersionOption,
    toast,
    versionLabel,
  ]);

  return (
    <Dialog disablePointerDismissal open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Préparer le métré</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {launchSuccess ? (
            <div aria-live="polite" className="space-y-4 py-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-light">
                <CheckIcon stroke="var(--success)" strokeWidth="2.5" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {launchRecoveryUnconfirmed
                  ? "Analyse créée, reprise à vérifier"
                  : launchQueuedForRecovery
                    ? "Analyse enregistrée, démarrage en attente"
                    : "Analyse transmise au traitement"}
              </p>
              <p className="text-xs text-muted-foreground">
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
                  className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full sm:w-auto")}
                  onClick={() => onOpenChange(false)}
                >
                  Fermer
                </button>
                <Link
                  href={`/dashboard/affaires/${projectId}/takeoff`}
                  className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full sm:w-auto")}
                  onClick={() => onOpenChange(false)}
                >
                  Centre d&apos;activité
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {isLoadingPlanSets && !hasUsablePlanSet ? <p role="status" className="text-sm text-muted-foreground">Chargement des jeux de plans…</p> : selectedPlanSet && hasPlanFiles ? (
                <LazyTakeoffPreparationPanel
                  projectId={projectId}
                  planSetId={selectedPlanSet.id}
                  estimateVersionId={selectedVersionOption?.id ?? null}
                  targetSelectionKey={targetSelectionKey}
                  disabled={isSubmitting}
                  launchDisabled={!hasTargetVersion}
                  onLaunch={handleLaunch}
                  onBusyChange={setIsSubmitting}
                  onRegisterSave={registerPreparationSave}
                  documentControls={<div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="launch-metre-plan-set">Jeu de plans à analyser</label>
                    <NativeSelect id="launch-metre-plan-set" value={selectedPlanSet.id} onChange={(event) => { setSelectedPlanSetId(event.target.value); setErrorMessage(null); }} disabled={isSubmitting}>
                      {planSetOptions.map((option) => <option key={option.id} value={option.id} disabled={option.fileCount === 0}>{option.name} — {option.fileCount} fichier{option.fileCount > 1 ? "s" : ""}{option.fileCount === 0 ? " · vide" : ""}</option>)}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">{isIntakeSyncedPlanSet(selectedPlanSet.source) ? "Plans synchronisés depuis les pièces confirmées du dossier. Confirmez les versions à utiliser pour ce métré." : "Choisissez ensuite les fichiers actifs et les révisions applicables."}</p>
                    {planSetsLoadError && <Alert variant="warning"><AlertDescription>La liste complète des jeux n’a pas pu être actualisée. <button type="button" className="underline" onClick={() => void reloadPlanSets()}>Réessayer</button></AlertDescription></Alert>}
                  </div>}
                  destinationControls={<div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="launch-metre-target-version">Version cible</label>
                    <NativeSelect id="launch-metre-target-version" value={selectedVersionOption?.id ?? ""} onChange={(event) => { setSelectedVersionId(event.target.value); setTargetSelectionKey((value) => value + 1); }} disabled={isSubmitting || !hasTargetVersion}>
                      {versionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">{selectedVersionOption?.helper ?? "Aucune version cible disponible."}</p>
                  </div>}
                  advancedControls={<>
                    <fieldset><legend className="mb-2 text-sm font-medium">Niveau d&apos;analyse</legend><div className="space-y-2" role="radiogroup">
                      {compatibleAnalysisLevels.map((level) => <label key={level.level} className="flex gap-2 text-sm"><input type="radio" name="analysis-level" value={level.level} checked={selectedLevel === level.level} onChange={() => setSelectedLevel(level.level)} aria-label={level.label} /><span>{level.label}<span className="ml-2 text-xs text-muted-foreground">{level.description}</span></span></label>)}
                    </div>
                    {selectedPlanSetRecommendation?.recommendedLevel && <p className="mt-2 text-xs text-muted-foreground">Niveau recommandé : {TAKEOFF_LEVEL_BUSINESS_LABELS[selectedPlanSetRecommendation.recommendedLevel]}. Le format des pièces ne prouve pas leur lisibilité ni leur échelle.</p>}
                    {selectionWarning && <p className="mt-2 text-xs text-warning">{selectionWarning.message}</p>}
                    </fieldset>
                    <TakeoffProviderSelect value={provider} onChange={setProvider} disabled={isSubmitting} />
                  </>}
                />
              ) : <div className="space-y-3 py-4 text-center"><p className="text-sm text-muted-foreground">Aucun jeu de plans exploitable n&apos;est disponible pour cette affaire.</p><Link href={`/dashboard/affaires/${projectId}/plans`} className={buttonVariants({ variant: "outline" })}>Voir les plans</Link>{planSetsLoadError && <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => void reloadPlanSets()}>Réessayer</button>}</div>}
              {errorMessage && <Alert variant="danger"><AlertDescription>{errorMessage}</AlertDescription></Alert>}
              {!hasTargetVersion && <Alert variant="warning"><AlertDescription>Créez d&apos;abord une première version pour lancer l&apos;analyse sur une cible de chiffrage.<div className="mt-3"><Link href={`/dashboard/estimates/new?projectId=${projectId}`} className={buttonVariants({ variant: "outline" })}>Créer une première version</Link></div></AlertDescription></Alert>}
            </div>

          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
