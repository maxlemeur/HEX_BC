"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  launchPreparedTakeoffFromPlanSetAction,
  launchPreparedTakeoffFromSourceVersionPlanSetAction,
  relaunchTakeoffAction,
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
import { useToast } from "@/components/feedback/toast-provider";
import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";
import {
  fetchPlanSetsForProject,
  type PlanSetListItem,
} from "@/lib/takeoff/client";
import { CheckIcon } from "lucide-react";
import { LazyTakeoffPreparationPanel } from "@/components/takeoff/LazyTakeoffPreparationPanel";
import { DETAILED_TAKEOFF_PROCESSING } from "@/lib/takeoff/preparation-from-dossier";
import { isIntakeSyncedPlanSet } from "@/lib/takeoff/default-import-plan-set";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LaunchMetrePlanSetOption = {
  id: string;
  name: string;
  fileCount: number;
  source?: string | null;
};

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

/**
 * What the dialogue launches (the affaire's takeoff zone decides it, lib/takeoff/affaire-takeoff-zone.ts):
 * - `version` (default): while the automatic start is off, an analysis on the current draft or a new draft;
 * - `request`: once it is on, a manual request on the clicker's subscription, without a version (the send chooses it):
 *   the affaire's first analysis, or a relaunch naming the analysis it replaces;
 * - `save_only`: the options are saved for the analysis that waits or runs; nothing is launched.
 */
export type LaunchMetreDialogMode =
  | { kind: "version" }
  | { kind: "request"; predecessorJobId: string | null }
  | { kind: "save_only"; reason: string };

type LaunchMetreDialogProps = {
  open: boolean;
  launchMode?: LaunchMetreDialogMode;
  onOpenChange: (open: boolean) => void;
  /** The version is null for a request: it has none until its send. */
  onLaunched?: (jobId: string, versionId: string | null) => void;
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
  initialVersionId?: string | null;
};

type LaunchVersionOption = {
  id: string;
  versionNumber: number;
  mode: "existing_draft" | "create_draft_from_source";
  label: string;
  helper: string;
};

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
  initialVersionId = null,
  launchMode = { kind: "version" },
}: LaunchMetreDialogProps) {
  const toast = useToast();
  const versionMode = launchMode.kind === "version";
  // One key per click of a request launch, kept when its answer was lost (a timeout, a network failure) so that the next
  // click replays it; a new click after an answer is a new command.
  const intentKeyRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const savePreparationRef = useRef<(() => Promise<number | null>) | null>(null);
  const registerPreparationSave = useCallback((save: () => Promise<number | null>) => { savePreparationRef.current = save; }, []);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [launchPlanFileCount, setLaunchPlanFileCount] = useState<number | null>(null);
  const [launchQueuedForRecovery, setLaunchQueuedForRecovery] = useState(false);
  const [launchRecoveryUnconfirmed, setLaunchRecoveryUnconfirmed] = useState(false);
  const [launchExistingAnalysis, setLaunchExistingAnalysis] = useState(false);
  const [launchAlreadyRunning, setLaunchAlreadyRunning] = useState(false);
  const [launchSuccessVersionLabel, setLaunchSuccessVersionLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState(initialVersionId);
  const [selectedPlanSetId, setSelectedPlanSetId] = useState<string | null>(
    initialPlanSetId ?? plansContext?.defaultPlanSetId ?? null,
  );
  // The set and the version the link names are applied when the dialogue opens, and again when the link names another
  // one. Once the member picks in a select, that choice stands while the set still has files or the version is still
  // offered, however often the caller renders with new arrays. Each choice records the link it was made under and the
  // id picked: a fallback or a later link ends it.
  const memberPlanSetChoiceRef = useRef<{ linkPlanSetId: string | null; planSetId: string } | null>(null);
  const memberVersionChoiceRef = useRef<{ linkVersionId: string | null; versionId: string } | null>(null);
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
  const versionOptions = useMemo(
    () => buildVersionOptions({ currentVersion, availableVersions }),
    [availableVersions, currentVersion],
  );
  const selectedVersionOption = useMemo(
    () =>
      versionOptions.find((option) => option.id === selectedVersionId) ??
      versionOptions[0] ??
      null,
    [selectedVersionId, versionOptions],
  );
  // A request carries no version: the send chooses its destination.
  const hasTargetVersion = !versionMode || selectedVersionOption !== null;
  const hasPlanFiles = (selectedPlanSet?.fileCount ?? 0) > 0;
  const hasUsablePlanSet = planSetOptions.some((option) => option.fileCount > 0);
  const versionLabel = selectedVersionOption
    ? selectedVersionOption.mode === "existing_draft"
      ? `${versionBusinessLabel(selectedVersionOption.versionNumber)} (brouillon)`
      : `Nouveau brouillon depuis ${versionBusinessLabel(selectedVersionOption.versionNumber)}`
    : null;

  useEffect(() => {
    const memberChoice = memberPlanSetChoiceRef.current;
    const memberChoiceId = memberChoice?.linkPlanSetId === initialPlanSetId ? memberChoice.planSetId : null;
    setSelectedPlanSetId((currentId) => {
      const byId = new Map(planSetOptions.map((option) => [option.id, option]));
      const isUsable = (id: string | null | undefined) =>
        Boolean(id && (byId.get(id)?.fileCount ?? 0) > 0);

      if (memberChoiceId !== null && currentId === memberChoiceId && isUsable(currentId)) return currentId;
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
    const memberChoice = memberVersionChoiceRef.current;
    const memberChoiceId = memberChoice?.linkVersionId === initialVersionId ? memberChoice.versionId : null;
    setSelectedVersionId((currentId) => {
      if (memberChoiceId !== null && currentId === memberChoiceId && versionOptions.some((option) => option.id === currentId)) {
        return currentId;
      }
      return versionOptions.find((option) => option.id === initialVersionId)?.id ?? versionOptions[0]?.id ?? null;
    });
  }, [initialVersionId, versionOptions]);

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

  const handleRequestLaunch = useCallback(async (preparationRevision: number, planFileCount: number) => {
    if (!selectedPlanSet || !hasPlanFiles || launchMode.kind !== "request") return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const intentKey = intentKeyRef.current ?? crypto.randomUUID();
    intentKeyRef.current = intentKey;
    try {
      const result = unwrapTakeoffActionResult(await relaunchTakeoffAction({
        projectId, planSetId: selectedPlanSet.id, preparationRevision, intentKey, predecessorJobId: launchMode.predecessorJobId,
      }));
      intentKeyRef.current = null;
      const label = "Sans devis : la destination se choisit à l’envoi";
      const title = result.outcome === "already_running" ? "Une analyse de l’affaire est déjà en cours"
        : result.outcome === "replayed" ? "Analyse existante retrouvée" : "Analyse transmise au traitement";
      if (result.outcome === "already_running") {
        toast.warning({ title, description: "Suivez-la depuis l’état du métré de l’affaire.", durationMs: 6000 });
      } else {
        toast.success({ title, description: `${label} — ${planFileCount} fichier${planFileCount > 1 ? "s" : ""} de plan.`, durationMs: 6000 });
      }
      setLaunchSuccessVersionLabel(label);
      setLaunchPlanFileCount(result.outcome === "admitted" ? planFileCount : null);
      setLaunchQueuedForRecovery(false);
      setLaunchRecoveryUnconfirmed(false);
      setLaunchExistingAnalysis(result.outcome === "replayed");
      setLaunchAlreadyRunning(result.outcome === "already_running");
      setLaunchSuccess(true);
      if (result.jobId) onLaunched?.(result.jobId, null);
    } catch (error) {
      // A refusal the server named decides the command: a new click is a new one. After a server error or a lost answer
      // the command may have been recorded: the next click replays it with the same key.
      if (error instanceof TakeoffActionError && error.status < 500) intentKeyRef.current = null;
      setErrorMessage(error instanceof TakeoffActionError ? error.message : "Impossible de lancer l'analyse.");
    } finally {
      setIsSubmitting(false);
    }
  }, [hasPlanFiles, launchMode, onLaunched, projectId, selectedPlanSet, toast]);

  const handleLaunch = useCallback(async (preparationRevision: number, planFileCount: number) => {
    if (!selectedPlanSet || !hasPlanFiles) return;
    if (launchMode.kind === "request") return handleRequestLaunch(preparationRevision, planFileCount);
    if (launchMode.kind !== "version") return;

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
      let existingStatus: string | undefined;

      if (selectedOption.mode === "existing_draft") {
        const result = unwrapTakeoffActionResult(await launchPreparedTakeoffFromPlanSetAction({
          projectId,
          planSetId: selectedPlanSet.id,
          versionId: selectedOption.id,
          ...DETAILED_TAKEOFF_PROCESSING,
          preparationRevision,
        }));
        createdJobId = result.jobId;
        existingStatus = result.existingStatus;
        queuedForRecovery = result.dispatch?.status === "queued_for_recovery";
        recoveryUnconfirmed =
          result.dispatch?.status === "persistence_unconfirmed";
      } else {
        const result = unwrapTakeoffActionResult(await launchPreparedTakeoffFromSourceVersionPlanSetAction({
          projectId,
          planSetId: selectedPlanSet.id,
          sourceVersionId: selectedOption.id,
          ...DETAILED_TAKEOFF_PROCESSING,
          preparationRevision,
        }));
        createdJobId = result.jobId;
        existingStatus = result.existingStatus;
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
        title: existingStatus
          ? "Analyse existante retrouvée"
          : recoveryUnconfirmed
          ? "Analyse créée, reprise à vérifier"
          : queuedForRecovery
            ? "Analyse enregistrée, démarrage en attente"
            : "Analyse transmise au traitement",
        description: existingStatus
          ? `${resolvedVersionLabel} — consultez cette analyse dans le centre d’activité.`
          : recoveryUnconfirmed
          ? `${resolvedVersionLabel} — le démarrage immédiat et l'enregistrement de la reprise n'ont pas pu être confirmés. Ouvrez le centre d'activité pour réessayer avec l'identifiant ${createdJobId}.`
          : queuedForRecovery
            ? `${resolvedVersionLabel} — la demande est conservée et sera reprise automatiquement. Suivez son état dans le centre d'activité des métrés.`
            : `${resolvedVersionLabel} — ${planFileCount} fichier${planFileCount > 1 ? "s" : ""} de plan. Prochaine étape : suivre l'analyse dans le centre d'activité des métrés.`,
        durationMs: 6000,
      };
      if (queuedForRecovery || recoveryUnconfirmed) {
        toast.warning(toastPayload);
      } else {
        toast.success(toastPayload);
      }
      setLaunchSuccessVersionLabel(resolvedVersionLabel);
      setLaunchPlanFileCount(existingStatus ? null : planFileCount);
      setLaunchQueuedForRecovery(queuedForRecovery);
      setLaunchRecoveryUnconfirmed(recoveryUnconfirmed);
      setLaunchExistingAnalysis(Boolean(existingStatus));
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
    handleRequestLaunch,
    hasPlanFiles,
    launchMode.kind,
    onLaunched,
    projectId,
    selectedPlanSet,
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
                {launchAlreadyRunning
                  ? "Une analyse de l’affaire est déjà en cours"
                  : launchExistingAnalysis
                  ? "Analyse existante retrouvée"
                  : launchRecoveryUnconfirmed
                  ? "Analyse créée, reprise à vérifier"
                  : launchQueuedForRecovery
                    ? "Analyse enregistrée, démarrage en attente"
                    : "Analyse transmise au traitement"}
              </p>
              <p className="text-xs text-muted-foreground">
                {launchSuccessVersionLabel ?? versionLabel ?? "Brouillon"}
                {launchPlanFileCount !== null ? ` — ${launchPlanFileCount} fichier${launchPlanFileCount > 1 ? "s" : ""} de plan.` : "."}
                {launchAlreadyRunning
                  ? " Aucune autre analyse n’a été lancée : suivez celle-ci depuis l’état du métré de l’affaire."
                  : launchExistingAnalysis
                  ? " Consultez son état dans le centre d’activité."
                  : launchRecoveryUnconfirmed
                  ? " La reprise automatique n'a pas pu être confirmée : ouvrez le centre d'activité et relancez cette analyse."
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
                  estimateVersionId={versionMode ? selectedVersionOption?.id ?? null : null}
                  analysisOnly={!versionMode}
                  disabled={isSubmitting}
                  launchDisabled={!hasTargetVersion || launchMode.kind === "save_only"}
                  launchNotice={launchMode.kind === "save_only" ? launchMode.reason : null}
                  onLaunch={handleLaunch}
                  onBusyChange={setIsSubmitting}
                  onRegisterSave={registerPreparationSave}
                  documentControls={<div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="launch-metre-plan-set">Jeu de plans à analyser</label>
                    <NativeSelect id="launch-metre-plan-set" value={selectedPlanSet.id} onChange={(event) => {
                      const next = event.target.value;
                      const linkPlanSetId = initialPlanSetId;
                      setErrorMessage(null);
                      void Promise.resolve(savePreparationRef.current?.()).then(() => {
                        memberPlanSetChoiceRef.current = { linkPlanSetId, planSetId: next };
                        setSelectedPlanSetId(next);
                      })
                        .catch((cause) => setErrorMessage(cause instanceof TakeoffActionError ? cause.message : "Impossible d’enregistrer les options du métré."));
                    }} disabled={isSubmitting}>
                      {planSetOptions.map((option) => <option key={option.id} value={option.id} disabled={option.fileCount === 0}>{option.name} — {option.fileCount} fichier{option.fileCount > 1 ? "s" : ""}{option.fileCount === 0 ? " · vide" : ""}</option>)}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">{isIntakeSyncedPlanSet(selectedPlanSet.source) ? "Plans synchronisés depuis les pièces confirmées du dossier. Toutes les pages des plans retenus sont analysées par défaut." : "Toutes les pages du jeu sont retenues par défaut."}</p>
                    {planSetsLoadError && <Alert variant="warning"><AlertDescription>La liste complète des jeux n’a pas pu être actualisée. <button type="button" className="underline" onClick={() => void reloadPlanSets()}>Réessayer</button></AlertDescription></Alert>}
                  </div>}
                  destinationControls={!versionMode ? <p className="text-sm text-muted-foreground">Sans devis à ce stade : l’analyse se relit dans sa revue, et la version de devis qui reçoit ses quantités se choisit à leur envoi au tableau de chiffrage.</p> : <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="launch-metre-target-version">Version cible</label>
                    <NativeSelect id="launch-metre-target-version" value={selectedVersionOption?.id ?? ""} onChange={(event) => {
                      const next = event.target.value;
                      memberVersionChoiceRef.current = { linkVersionId: initialVersionId, versionId: next };
                      setSelectedVersionId(next);
                    }} disabled={isSubmitting || !hasTargetVersion}>
                      {versionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">{selectedVersionOption?.helper ?? "Aucune version cible disponible."}</p>
                  </div>}

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
