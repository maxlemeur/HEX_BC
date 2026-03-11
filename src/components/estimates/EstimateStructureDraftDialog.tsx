"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchEstimateStructureDraft,
  generateEstimateStructureDraft,
  type ApplyEstimateStructureDraftPayload,
  type ApplyEstimateStructureDraftResult,
  type EstimateStructureDraftApplyMode,
} from "@/lib/estimates/client";
import {
  buildDraftOverrides,
  buildFilterCounts,
  buildFilteredFlatNodeIds,
  buildNodeMergeStates,
  buildSourceCoverageSummary,
  buildStickySummaryCounts,
  flattenNodes,
  getDefaultSelectedRootIds,
  getSelectedNodes,
  isAssemblyOnlyWeakSignalMode,
  type ExistingSectionOption,
  type NodeOverrideState,
  type TreeFilterKey,
} from "@/lib/estimates/estimate-structure-draft";

import { ApplicationStep } from "./estimate-structure-draft/ApplicationStep";
import { ResultStep } from "./estimate-structure-draft/ResultStep";
import { SelectionStep } from "./estimate-structure-draft/SelectionStep";
import { SourcesStep } from "./estimate-structure-draft/SourcesStep";
import { StickySummaryBar } from "./estimate-structure-draft/StickySummaryBar";
import { WizardHeader } from "./estimate-structure-draft/WizardHeader";
import type { WizardStep } from "./estimate-structure-draft/shared";

export type { ApplyEstimateStructureDraftResult };

type EstimateStructureDraftDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  hasExistingItems: boolean;
  existingSections: ExistingSectionOption[];
  onClose: (result?: ApplyEstimateStructureDraftResult) => void;
  onConfirm: (
    draftId: string,
    input: ApplyEstimateStructureDraftPayload,
  ) => Promise<ApplyEstimateStructureDraftResult>;
};

export function EstimateStructureDraftDialog({
  isOpen,
  targetVersionId,
  hasExistingItems,
  existingSections,
  onClose,
  onConfirm,
}: EstimateStructureDraftDialogProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [draft, setDraft] = useState<Awaited<
    ReturnType<typeof fetchEstimateStructureDraft>
  > | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selectedRootIds, setSelectedRootIds] = useState<string[]>([]);
  const [mode, setMode] = useState<EstimateStructureDraftApplyMode>(
    hasExistingItems ? "merge_existing" : "create_empty",
  );
  const [overrides, setOverrides] = useState<Record<string, NodeOverrideState>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<TreeFilterKey>>(new Set());
  const [applyResult, setApplyResult] = useState<ApplyEstimateStructureDraftResult | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isActive = true;
    setStep(1);
    setMode(hasExistingItems ? "merge_existing" : "create_empty");
    setOverrides({});
    setSubmitError(null);
    setDraftError(null);
    setDraft(null);
    setSelectedRootIds([]);
    setIsLoadingDraft(true);
    setActiveFilters(new Set());
    setApplyResult(null);

    async function loadDraft() {
      try {
        const generated = await generateEstimateStructureDraft(targetVersionId, {
          strategy: "hybrid",
        });
        const persisted = await fetchEstimateStructureDraft(
          targetVersionId,
          generated.draftId,
        );
        if (!isActive) {
          return;
        }

        setDraft(persisted);
        setSelectedRootIds(getDefaultSelectedRootIds(persisted));
      } catch (error) {
        if (!isActive) {
          return;
        }

        setDraftError(
          error instanceof Error
            ? error.message
            : "Impossible de generer la preview de structure.",
        );
      } finally {
        if (!isActive) {
          return;
        }

        setIsLoadingDraft(false);
      }
    }

    void loadDraft();

    return () => {
      isActive = false;
    };
  }, [hasExistingItems, isOpen, targetVersionId]);

  const flatNodes = useMemo(() => flattenNodes(draft?.nodes ?? []), [draft?.nodes]);
  const selectedNodes = useMemo(
    () =>
      getSelectedNodes({
        draftNodes: draft?.nodes ?? [],
        flatNodes,
        selectedRootIds,
      }),
    [draft?.nodes, flatNodes, selectedRootIds],
  );
  const sourceCoverageSummary = useMemo(
    () => (draft ? buildSourceCoverageSummary(draft.sources) : null),
    [draft],
  );
  const isAssemblyOnlyWeakMode = useMemo(
    () => (draft ? isAssemblyOnlyWeakSignalMode(draft.sources) : false),
    [draft],
  );
  const nodeMergeStates = useMemo(
    () =>
      buildNodeMergeStates({
        draftNodes: draft?.nodes ?? [],
        existingSections,
        overrides,
      }),
    [draft?.nodes, existingSections, overrides],
  );
  const hasInvalidMergeConfiguration = useMemo(
    () =>
      selectedNodes.some(
        (node) => nodeMergeStates.get(node.id)?.hasInvalidMergeConfiguration,
      ),
    [nodeMergeStates, selectedNodes],
  );
  const stickySummaryCounts = useMemo(
    () =>
      buildStickySummaryCounts({
        selectedNodes,
        selectedRootIds,
        overrides,
      }),
    [overrides, selectedNodes, selectedRootIds],
  );
  const filterCounts = useMemo(
    () =>
      buildFilterCounts({
        flatNodes,
        overrides,
      }),
    [flatNodes, overrides],
  );
  const filteredFlatNodeIds = useMemo(
    () =>
      buildFilteredFlatNodeIds({
        activeFilters,
        flatNodes,
        overrides,
      }),
    [activeFilters, flatNodes, overrides],
  );

  const canContinueFromStep1 =
    !isLoadingDraft && !draftError && Boolean(draft?.nodes.length);
  const canContinueFromStep2 = selectedRootIds.length > 0;

  const toggleRootSelection = (nodeId: string) => {
    setSelectedRootIds((current) =>
      current.includes(nodeId)
        ? current.filter((value) => value !== nodeId)
        : [...current, nodeId],
    );
  };

  const updateOverride = (nodeId: string, patch: Partial<NodeOverrideState>) => {
    setOverrides((current) => {
      const existing = current[nodeId] ?? {
        action:
          flatNodes.find((node) => node.id === nodeId)?.defaultAction ?? "create",
        renameTo: "",
        mergeIntoItemId: "",
      };

      return {
        ...current,
        [nodeId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const handleToggleFilter = (key: TreeFilterKey) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!draft || selectedRootIds.length === 0 || hasInvalidMergeConfiguration) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload: ApplyEstimateStructureDraftPayload = {
        mode,
        selectedRootNodeIds: selectedRootIds,
        overrides: buildDraftOverrides({
          selectedNodes,
          overrides,
          nodeMergeStates,
        }),
      };

      const result = await onConfirm(draft.draftId, payload);
      setApplyResult(result);
      setStep(4);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Impossible d'appliquer la preview de structure.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.5)] p-4">
      <div
        className="dashboard-card max-h-[92vh] w-full max-w-6xl overflow-hidden p-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-structure-draft-dialog-title"
      >
        <WizardHeader
          step={step}
          onClose={() => onClose()}
          isSubmitting={isSubmitting}
        />

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {(step === 2 || step === 3) && draft ? (
            <StickySummaryBar counts={stickySummaryCounts} />
          ) : null}

          {step === 1 ? (
            <SourcesStep
              draft={draft}
              isLoadingDraft={isLoadingDraft}
              draftError={draftError}
              sourceCoverageSummary={sourceCoverageSummary}
            />
          ) : null}

          {step === 2 && draft ? (
            <SelectionStep
              draft={draft}
              selectedRootIds={selectedRootIds}
              onToggleRootSelection={toggleRootSelection}
              isAssemblyOnlyWeakMode={isAssemblyOnlyWeakMode}
              activeFilters={activeFilters}
              onToggleFilter={handleToggleFilter}
              filterCounts={filterCounts}
              flatNodes={flatNodes}
              filteredFlatNodeIds={filteredFlatNodeIds}
              overrides={overrides}
            />
          ) : null}

          {step === 3 && draft ? (
            <ApplicationStep
              hasExistingItems={hasExistingItems}
              mode={mode}
              onModeChange={setMode}
              selectedNodes={selectedNodes}
              overrides={overrides}
              onUpdateOverride={updateOverride}
              nodeMergeStates={nodeMergeStates}
              hasInvalidMergeConfiguration={hasInvalidMergeConfiguration}
              submitError={submitError}
            />
          ) : null}

          {step === 4 && applyResult ? (
            <ResultStep
              applyResult={applyResult}
              selectedNodes={selectedNodes}
              overrides={overrides}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--slate-200)] px-6 py-4">
          {step === 4 ? (
            <div />
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                setStep((current) =>
                  current > 1 ? ((current - 1) as WizardStep) : current,
                )
              }
              disabled={step === 1 || isSubmitting}
            >
              Retour
            </button>
          )}
          <div className="flex items-center gap-2">
            {step === 4 ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onClose(applyResult ?? undefined)}
              >
                Fermer
              </button>
            ) : step < 3 ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  setStep((current) => ((current + 1) as 1 | 2 | 3))
                }
                disabled={
                  isSubmitting ||
                  (step === 1 ? !canContinueFromStep1 : !canContinueFromStep2)
                }
              >
                Continuer
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSubmit()}
                disabled={
                  isSubmitting ||
                  selectedRootIds.length === 0 ||
                  hasInvalidMergeConfiguration
                }
              >
                {isSubmitting ? "Application..." : "Appliquer la structure"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
