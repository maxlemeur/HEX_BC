"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog";
import {
  generateEstimateStructureDraft,
  type ApplyEstimateStructureDraftPayload,
  type ApplyEstimateStructureDraftResult,
  type EstimateStructureDraft,
  type EstimateStructureDraftApplyMode,
} from "@/lib/estimates/structure-drafts-client";
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
import { EstimateDraftAiSettings, useEstimateDraftAiSettings } from "./EstimateDraftAiSettings";
import type { EstimateDraftAiRequest } from "@/lib/estimates/schemas";
import type { EstimateStructureDraftDialogProps } from "@/hooks/estimate-editor-view-props";

export type { ApplyEstimateStructureDraftResult };

export function EstimateStructureDraftDialog(props: EstimateStructureDraftDialogProps) {
  return props.isOpen ? <EstimateStructureDraftWizard key={props.targetVersionId} {...props} /> : null;
}

function EstimateStructureDraftWizard({
  targetVersionId,
  hasExistingItems,
  existingSections,
  onClose,
  onConfirm,
}: EstimateStructureDraftDialogProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [draft, setDraft] = useState<EstimateStructureDraft | null>(null);
  const settings = useEstimateDraftAiSettings(targetVersionId, true);
  const isGenerating = useRef(false);
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

  async function handleGenerate(ai: EstimateDraftAiRequest) {
    if (isGenerating.current) return;
    isGenerating.current = true;
    setIsLoadingDraft(true);
    setDraftError(null);
    setMode(hasExistingItems ? "merge_existing" : "create_empty");
    try {
      const generated = await generateEstimateStructureDraft(targetVersionId, { strategy: "hybrid", ai });
      setDraft(generated);
      setSelectedRootIds(getDefaultSelectedRootIds(generated));
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : "Impossible de générer l’aperçu de structure.",
      );
    } finally {
      isGenerating.current = false;
      setIsLoadingDraft(false);
    }
  }

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
          : "Impossible d'appliquer l'aperçu de structure.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !isSubmitting && !isGenerating.current) onClose();
      }}
    >
      <DialogContent
        size="xl"
        showCloseButton={false}
        className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-6xl sm:p-0"
      >
        <WizardHeader
          step={step}
          onClose={() => { if (!isGenerating.current) onClose(); }}
          isSubmitting={isSubmitting || isLoadingDraft}
        />

        <DialogBody className="relative min-h-0 flex-1 gap-0 overflow-y-auto px-6 py-5">
          {(step === 2 || step === 3) && draft ? (
            <StickySummaryBar counts={stickySummaryCounts} />
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              {!draft ? <EstimateDraftAiSettings settings={settings} locked={isLoadingDraft} /> : null}
              <SourcesStep
                draft={draft}
                isLoadingDraft={isLoadingDraft}
                draftError={draftError}
                sourceCoverageSummary={sourceCoverageSummary}
              />
            </div>
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
        </DialogBody>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
          {step === 4 ? (
            <div />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() =>
                setStep((current) =>
                  current > 1 ? ((current - 1) as WizardStep) : current,
                )
              }
              disabled={step === 1 || isSubmitting}
            >
              Retour
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {step === 4 ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => onClose(applyResult ?? undefined)}
              >
                Fermer
              </Button>
            ) : step === 1 && !draft ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLoadingDraft}
                  onClick={() => void handleGenerate({ source: "fallback" })}
                >
                  Générer sans IA
                </Button>
                <Button
                  type="button"
                  disabled={isLoadingDraft || !settings.request}
                  onClick={() => { if (settings.request) void handleGenerate(settings.request); }}
                >
                  Générer l’aperçu
                </Button>
              </>
            ) : step < 3 ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() =>
                  setStep((current) => ((current + 1) as 1 | 2 | 3))
                }
                disabled={
                  isSubmitting ||
                  (step === 1 ? !canContinueFromStep1 : !canContinueFromStep2)
                }
              >
                Continuer
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => void handleSubmit()}
                disabled={
                  isSubmitting ||
                  selectedRootIds.length === 0 ||
                  hasInvalidMergeConfiguration
                }
              >
                {isSubmitting ? "Application…" : "Appliquer la structure"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
