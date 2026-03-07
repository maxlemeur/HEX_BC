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
  DEFAULT_IMPORT_PLAN_SET_NAME,
  IMPORT_FLOW_PLAN_SET_METADATA,
  hasDefaultImportPlanSetMarker,
} from "@/lib/takeoff/default-import-plan-set";

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
          : "Impossible de preparer le jeu de plans."
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

      setUploadedCount(Math.max(0, currentCount - initialCounts.fileCount));
      setUploadedSizeBytes(Math.max(0, currentSize - initialCounts.totalSizeBytes));
    } catch {
      if (fallbackSummary) {
        setUploadedCount((currentCount) => currentCount + fallbackSummary.uploadedCount);
        setUploadedSizeBytes(
          (currentSize) => currentSize + fallbackSummary.uploadedSizeBytes
        );
      }
      setUploadSummaryWarning(
        "Le compteur affiche une estimation locale. Verifiez les fichiers depuis la section Plans de votre affaire."
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
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3" role="status">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-green-600">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="text-sm font-medium text-green-800">Chiffrage cree avec succes</span>
        </div>
      )}

      <div className="rounded-xl border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-blue)]/10">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--brand-blue)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-sm font-semibold text-[var(--slate-800)] outline-none"
              >
                Ajouter les plans
              </h2>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                Recommande
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              Ajoutez vos plans PDF maintenant ou plus tard depuis la section Plans de votre affaire.
            </p>
          </div>
        </div>
      </div>

      {/* Benefits explanation */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--slate-200)] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span className="text-xs font-semibold text-[var(--slate-800)]">Extraction de metres</span>
          </div>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Les quantites sont extraites des plans pour alimenter le chiffrage.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="text-xs font-semibold text-[var(--slate-800)]">Preuves</span>
          </div>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Chaque ligne du chiffrage est rattachee a sa source dans les plans.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--slate-200)] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="text-xs font-semibold text-[var(--slate-800)]">Detection des ecarts</span>
          </div>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Les ecarts entre le DPGF et les plans sont identifies automatiquement.
          </p>
        </div>
      </div>

      {prepareError && (
        <div className="mt-4" role="alert" aria-live="assertive">
          <div className="alert alert-error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{prepareError}</span>
              <button
                type="button"
                className="btn btn-sm font-medium underline underline-offset-2 hover:no-underline"
                onClick={() => void loadOrCreateDefaultPlanSet()}
              >
                Reessayer
              </button>
            </div>
          </div>
        </div>
      )}

      {isPreparing && !prepareError && (
        <div className="dashboard-card mt-4 p-6">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
            <span className="text-sm text-[var(--slate-500)]">
              On prepare tout pour vos plans...
            </span>
          </div>
        </div>
      )}

      {planSet && !prepareError && (
        <div className="dashboard-card mt-4 p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">
            Vos plans
          </p>
          <p className="text-sm font-semibold text-[var(--slate-800)]">{planSet.name}</p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
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
            <p className="mt-3 text-xs text-[var(--slate-500)]">
              Upload en cours... terminez l&apos;envoi avant de quitter cette etape.
            </p>
          )}

          {(uploadedCount > 0 || uploadedSizeBytes > 0) && isUploadActive && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--slate-500)]">
              <span>
                {uploadedCount} {uploadedCount > 1 ? "fichiers uploades" : "fichier uploade"} —{" "}
                {formatBytes(uploadedSizeBytes)}
              </span>
            </p>
          )}

          {!isUploadActive && uploadedCount > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-green-600" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-xs font-medium text-green-800">
                  {uploadedCount} {uploadedCount > 1 ? "fichiers uploades" : "fichier uploade"} — {formatBytes(uploadedSizeBytes)}
                </span>
              </div>

              {planSet && (
                <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
                  <p className="text-xs font-medium text-[var(--slate-700)]">
                    Jeu de plans : <span className="font-semibold">{planSet.name}</span>
                    <span className="ml-2 text-[var(--slate-500)]">
                      ({planSet.file_count + uploadedCount} {(planSet.file_count + uploadedCount) > 1 ? "fichiers" : "fichier"})
                    </span>
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-4 py-3">
                <p className="text-xs font-medium text-[var(--slate-700)]">
                  Prochaine etape suggeree
                </p>
                <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                  Lancez une analyse de metres depuis le hub de votre affaire.
                </p>
              </div>
            </div>
          )}

          {uploadSummaryWarning && (
            <p className="mt-3 text-xs text-[var(--warning)]">{uploadSummaryWarning}</p>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSkip}
          disabled={isUploadActive}
          aria-label="Continuer sans ajouter de plans"
        >
          Continuer sans plans
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleFinish}
          disabled={isPreparing || isUploadActive}
        >
          Terminer et acceder au dossier
        </button>
      </div>
    </section>
  );
}
