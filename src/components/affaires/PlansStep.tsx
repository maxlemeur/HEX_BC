"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  PlanFileUploadZone,
  type PlanFileUploadSummary,
} from "@/components/takeoff/PlanFileUploadZone";
import {
  createPlanSet,
  fetchPlanFiles,
  fetchPlanSetsForProject,
  type PlanSetListItem,
} from "@/lib/takeoff/client";
import {
  classifyTakeoffPlanSetSource,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";
import {
  DEFAULT_IMPORT_PLAN_SET_NAME,
  IMPORT_FLOW_PLAN_SET_METADATA,
  hasDefaultImportPlanSetMarker,
} from "@/lib/takeoff/default-import-plan-set";
import { TakeoffLaunchPrompt } from "@/components/takeoff/TakeoffLaunchPrompt";
import { useTakeoffAutoProposeDismissed } from "@/hooks/useTakeoffAutoProposeDismissed";
import { CheckIcon, CircleCheckBigIcon, FileIcon, LinkIcon, PackageIcon, SearchIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type PlansStepProps = {
  projectId: string;
  versionId: string;
  onSkip: () => void;
  onContinue: () => void;
  /** When true, show a success banner above the plans step. */
  showSuccessBanner?: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function compareByUpdatedAtDesc(left: PlanSetListItem, right: PlanSetListItem) {
  return right.updated_at.localeCompare(left.updated_at);
}

function isDefaultImportPlanSet(planSet: PlanSetListItem) {
  return planSet.name.trim().toLowerCase() === DEFAULT_IMPORT_PLAN_SET_NAME.toLowerCase();
}

function hasImportFlowPlanSetMarker(planSet: PlanSetListItem) {
  return hasDefaultImportPlanSetMarker(planSet.metadata);
}

function selectDefaultImportPlanSet(
  planSets: PlanSetListItem[],
  versionId: string
): PlanSetListItem | null {
  const sortedPlanSets = [...planSets].sort(compareByUpdatedAtDesc);
  const canonicalPlanSet =
    sortedPlanSets.find(
      (planSet) =>
        hasImportFlowPlanSetMarker(planSet) && planSet.estimate_version_id === versionId
    ) ??
    sortedPlanSets.find(
      (planSet) =>
        hasImportFlowPlanSetMarker(planSet) && planSet.estimate_version_id === null
    ) ??
    null;

  if (canonicalPlanSet) {
    return canonicalPlanSet;
  }

  const versionScopedNamedPlanSets = sortedPlanSets.filter(
    (planSet) =>
      isDefaultImportPlanSet(planSet) && planSet.estimate_version_id === versionId
  );
  if (versionScopedNamedPlanSets.length === 1) {
    return versionScopedNamedPlanSets[0];
  }

  const projectScopedNamedPlanSets = sortedPlanSets.filter(
    (planSet) =>
      isDefaultImportPlanSet(planSet) && planSet.estimate_version_id === null
  );
  if (projectScopedNamedPlanSets.length === 1) {
    return projectScopedNamedPlanSets[0];
  }

  const namedPlanSets = sortedPlanSets.filter(isDefaultImportPlanSet);
  if (namedPlanSets.length === 1) {
    return namedPlanSets[0];
  }

  return null;
}

function sumFileSizes(fileSizes: number[]) {
  return fileSizes.reduce((total, size) => total + size, 0);
}

export function PlansStep({
  projectId,
  versionId,
  onSkip,
  onContinue,
  showSuccessBanner = false,
}: PlansStepProps) {
  const [planSet, setPlanSet] = useState<PlanSetListItem | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [isUploadActive, setIsUploadActive] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadedSizeBytes, setUploadedSizeBytes] = useState(0);
  const [uploadSummaryWarning, setUploadSummaryWarning] = useState<string | null>(null);
  const [launchRecommendation, setLaunchRecommendation] =
    useState<TakeoffDocumentRecommendation | null>(null);
  const {
    dismissed: permanentlyDismissed,
    temporarilyDismissed,
    dismissPermanently,
    dismissTemporarily,
  } = useTakeoffAutoProposeDismissed(projectId, {
    context: "import",
    scopeKey: [
      planSet?.id ?? "none",
      versionId,
      String(planSet?.file_count ?? 0),
      String(uploadedCount),
      String(uploadedSizeBytes),
    ].join(":"),
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const initialCountsRef = useRef<{ fileCount: number; totalSizeBytes: number } | null>(
    null
  );

  const loadOrCreateDefaultPlanSet = useCallback(async () => {
    setIsPreparing(true);
    setPrepareError(null);

    try {
      const existingPlanSets = await fetchPlanSetsForProject(projectId);
      const matchingPlanSet = selectDefaultImportPlanSet(existingPlanSets, versionId);

      if (matchingPlanSet) {
        setPlanSet(matchingPlanSet);
        initialCountsRef.current = {
          fileCount: matchingPlanSet.file_count,
          totalSizeBytes: matchingPlanSet.total_size_bytes,
        };
        return;
      }

      const createdPlanSet = await createPlanSet({
        project_id: projectId,
        estimate_version_id: versionId,
        name: DEFAULT_IMPORT_PLAN_SET_NAME,
        metadata: IMPORT_FLOW_PLAN_SET_METADATA,
      });

      setPlanSet(createdPlanSet);
      initialCountsRef.current = {
        fileCount: createdPlanSet.file_count,
        totalSizeBytes: createdPlanSet.total_size_bytes,
      };
    } catch (error) {
      setPrepareError(
        error instanceof Error
          ? error.message
          : "Impossible de préparer le jeu de plans."
      );
    } finally {
      setIsPreparing(false);
    }
  }, [projectId, versionId]);

  const refreshUploadSummary = useCallback(async (fallbackSummary?: PlanFileUploadSummary) => {
    if (!planSet) {
      return;
    }

    const initialCounts = initialCountsRef.current;
    if (!initialCounts) {
      return;
    }

    try {
      setUploadSummaryWarning(null);
      const planFiles = await fetchPlanFiles(planSet.id);
      const currentCount = planFiles.length;
      const currentSize = sumFileSizes(planFiles.map((file) => file.file_size_bytes));
      setLaunchRecommendation(
        classifyTakeoffPlanSetSource({
          files: planFiles,
        })
      );

      setUploadedCount(Math.max(0, currentCount - initialCounts.fileCount));
      setUploadedSizeBytes(Math.max(0, currentSize - initialCounts.totalSizeBytes));
    } catch {
      setLaunchRecommendation(null);
      if (fallbackSummary) {
        setUploadedCount((currentCount) => currentCount + fallbackSummary.uploadedCount);
        setUploadedSizeBytes(
          (currentSize) => currentSize + fallbackSummary.uploadedSizeBytes
        );
      }
      setUploadSummaryWarning(
        "Le compteur affiche une estimation locale. Vérifiez les fichiers depuis la section Plans de votre affaire."
      );
    }
  }, [planSet]);

  useEffect(() => {
    void loadOrCreateDefaultPlanSet();
  }, [loadOrCreateDefaultPlanSet]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleFinish = useCallback(() => {
    if (isUploadActive) {
      return;
    }
    onContinue();
  }, [isUploadActive, onContinue]);

  const handleSkip = useCallback(() => {
    if (isUploadActive) {
      return;
    }
    onSkip();
  }, [isUploadActive, onSkip]);

  return (
    <section aria-label="Ajouter les plans (optionnel)">
      {showSuccessBanner && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-success-border bg-success-subtle px-4 py-3" role="status">
          <CircleCheckBigIcon aria-hidden="true" className="shrink-0 text-success" size={20} />
          <span className="text-sm font-medium text-success">Chiffrage créé avec succès</span>
        </div>
      )}

      <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.5" size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-sm font-semibold text-foreground outline-none"
              >
                Ajouter les plans
              </h2>
              <span className="rounded-full bg-success-light px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-success">
                Recommande
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ajoutez vos plans PDF maintenant ou plus tard depuis la section Plans de votre affaire.
            </p>
          </div>
        </div>
      </div>

      {/* Benefits explanation */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <PackageIcon stroke="var(--brand-blue)" strokeWidth="1.5" aria-hidden="true" size={16} />
            <span className="text-xs font-semibold text-foreground">Extraction de métrés</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Les quantités sont extraites des plans pour alimenter le chiffrage.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <LinkIcon stroke="var(--brand-blue)" strokeWidth="1.5" aria-hidden="true" size={16} />
            <span className="text-xs font-semibold text-foreground">Preuves</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Chaque ligne du chiffrage est rattachée à sa source dans les plans.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <SearchIcon stroke="var(--brand-blue)" strokeWidth="1.5" aria-hidden="true" size={16} />
            <span className="text-xs font-semibold text-foreground">Detection des écarts</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Les écarts entre le DPGF et les plans sont identifies automatiquement.
          </p>
        </div>
      </div>

      {prepareError && (
        <Alert variant="danger" className="mt-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-danger">
            <span>{prepareError}</span>
            <Button
              variant="link"
              size="sm"
              className="text-danger"
              onClick={() => void loadOrCreateDefaultPlanSet()}
            >
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isPreparing && !prepareError && (
        <div className="rounded-lg border border-border bg-surface shadow-card mt-4 p-6">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
            <span className="text-sm text-muted-foreground">
              On prépare tout pour vos plans…
            </span>
          </div>
        </div>
      )}

      {planSet && !prepareError && (
        <div className="rounded-lg border border-border bg-surface shadow-card mt-4 p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Vos plans
          </p>
          <p className="text-sm font-semibold text-foreground">{planSet.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Les plans seront accessibles depuis votre affaire.
          </p>

          <div className="mt-5">
            <PlanFileUploadZone
              setId={planSet.id}
              onUploadsComplete={(summary) => void refreshUploadSummary(summary)}
              onUploadActivityChange={setIsUploadActive}
            />
          </div>

          {isUploadActive && (
            <p className="mt-3 text-xs text-muted-foreground">
              Upload en cours... terminez l&apos;envoi avant de quitter cette étape.
            </p>
          )}

          {(uploadedCount > 0 || uploadedSizeBytes > 0) && isUploadActive && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                {uploadedCount} {uploadedCount > 1 ? "fichiers uploades" : "fichier uploade"} —{" "}
                {formatBytes(uploadedSizeBytes)}
              </span>
            </p>
          )}

          {!isUploadActive && uploadedCount > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-success-border bg-success-subtle px-4 py-3">
                <CheckIcon strokeWidth="2.5" className="shrink-0 text-success" aria-hidden="true" size={14} />
                <span className="text-xs font-medium text-success">
                  {uploadedCount} {uploadedCount > 1 ? "fichiers uploades" : "fichier uploade"} — {formatBytes(uploadedSizeBytes)}
                </span>
              </div>

              {planSet && (
                <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
                  <p className="text-xs font-medium text-foreground-secondary">
                    Jeu de plans : <span className="font-semibold">{planSet.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      ({planSet.file_count + uploadedCount} {(planSet.file_count + uploadedCount) > 1 ? "fichiers" : "fichier"})
                    </span>
                  </p>
                </div>
              )}

              {!permanentlyDismissed &&
              !temporarilyDismissed &&
              planSet &&
              launchRecommendation ? (
                <TakeoffLaunchPrompt
                  projectId={projectId}
                  versionId={versionId}
                  versionLabel="Brouillon en cours"
                  planSetId={planSet.id}
                  planSetName={planSet.name}
                  planFileCount={uploadedCount + (initialCountsRef.current?.fileCount ?? 0)}
                  launchRecommendation={launchRecommendation}
                  compact
                  onDismissTemporary={() => {
                    dismissTemporarily();
                    handleFinish();
                  }}
                  onDismissPermanent={() => {
                    dismissPermanently();
                    handleFinish();
                  }}
                  onLaunched={() => {
                    /* stay on step, user sees inline success */
                  }}
                />
              ) : (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <p className="text-xs font-medium text-foreground-secondary">
                    Prochaine étape suggérée
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Lancez une analyse de métrés depuis le hub de votre affaire.
                  </p>
                </div>
              )}
            </div>
          )}

          {uploadSummaryWarning && (
            <p className="mt-3 text-xs text-warning">{uploadSummaryWarning}</p>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          onClick={handleSkip}
          disabled={isUploadActive}
          aria-label="Continuer sans ajouter de plans"
        >
          Continuer sans plans
        </button>
        <button
          type="button"
          className={buttonVariants({ variant: "primary", size: "lg" })}
          onClick={handleFinish}
          disabled={isPreparing || isUploadActive}
        >
          Terminer et acceder au dossier
        </button>
      </div>
    </section>
  );
}
