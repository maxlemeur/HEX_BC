"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { EstimateEditorAiMutationSource } from "@/hooks/useEstimateEditorAiDialogsController";

type AiMutationInput = {
  versionId: string;
  source: EstimateEditorAiMutationSource;
};

type EstimateEditorAiImportCoordinatorInput<TRefreshResult> = {
  routeVersionId: string;
  autoOpenVersionZero: boolean;
  autoOpenStructureDraft: boolean;
  ensureGroupedActionCanProceed: (actionLabel: string) => Promise<boolean>;
  openGeneratedOuvrageDialog: () => boolean;
  openVersionZeroDialog: () => boolean;
  dismissAiDialogs: () => void;
  openImportFromEstimateDialog: () => boolean;
  closeImportFromEstimateDialog: () => void;
  openEstimateStructureDraftDialog: () => boolean;
  closeEstimateStructureDraftDialog: () => void;
  clearImportSummary: () => void;
  refreshAfterAiMutation: (versionId: string) => Promise<TRefreshResult>;
  applyAiMutationRefresh: (result: TRefreshResult) => void;
};

export function resolveEstimateEditorAutoOpenDialogs({
  autoOpenVersionZero,
  autoOpenStructureDraft,
}: {
  autoOpenVersionZero: boolean;
  autoOpenStructureDraft: boolean;
}) {
  return {
    autoOpenVersionZero,
    autoOpenStructureDraft:
      autoOpenStructureDraft && !autoOpenVersionZero,
  };
}

export function useEstimateEditorAiImportCoordinator<TRefreshResult>({
  routeVersionId,
  autoOpenVersionZero,
  autoOpenStructureDraft,
  ensureGroupedActionCanProceed,
  openGeneratedOuvrageDialog,
  openVersionZeroDialog,
  dismissAiDialogs,
  openImportFromEstimateDialog,
  closeImportFromEstimateDialog,
  openEstimateStructureDraftDialog,
  closeEstimateStructureDraftDialog,
  clearImportSummary,
  refreshAfterAiMutation,
  applyAiMutationRefresh,
}: EstimateEditorAiImportCoordinatorInput<TRefreshResult>) {
  const activeRouteVersionIdRef = useRef(routeVersionId);
  const previousRouteVersionIdRef = useRef(routeVersionId);
  const routeGenerationRef = useRef(0);
  const refreshGenerationRef = useRef(0);

  useLayoutEffect(() => {
    activeRouteVersionIdRef.current = routeVersionId;
    if (previousRouteVersionIdRef.current === routeVersionId) return;

    previousRouteVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    refreshGenerationRef.current += 1;
  }, [routeVersionId]);

  const invalidateAfterAiMutation = useCallback(
    async ({ versionId }: AiMutationInput) => {
      if (activeRouteVersionIdRef.current !== versionId) return;

      const routeGeneration = routeGenerationRef.current;
      const refreshGeneration = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = refreshGeneration;
      const isCurrentRefresh = () =>
        activeRouteVersionIdRef.current === versionId &&
        routeGenerationRef.current === routeGeneration &&
        refreshGenerationRef.current === refreshGeneration;

      let refreshed: TRefreshResult;
      try {
        refreshed = await refreshAfterAiMutation(versionId);
      } catch (error) {
        if (!isCurrentRefresh()) return;
        throw error;
      }

      if (!isCurrentRefresh()) return;
      applyAiMutationRefresh(refreshed);
    },
    [applyAiMutationRefresh, refreshAfterAiMutation]
  );

  const openAiDialog = useCallback(
    async (actionLabel: string, openDialog: () => boolean) => {
      if (!(await ensureGroupedActionCanProceed(actionLabel))) return false;
      if (!openDialog()) return false;

      closeImportFromEstimateDialog();
      closeEstimateStructureDraftDialog();
      clearImportSummary();
      return true;
    },
    [
      clearImportSummary,
      closeEstimateStructureDraftDialog,
      closeImportFromEstimateDialog,
      ensureGroupedActionCanProceed,
    ]
  );

  const handleOpenGeneratedOuvrageDialog = useCallback(
    () =>
      openAiDialog(
        "ouvrir la generation d'ouvrages",
        openGeneratedOuvrageDialog
      ),
    [openAiDialog, openGeneratedOuvrageDialog]
  );

  const handleOpenVersionZeroDialog = useCallback(
    () => openAiDialog("ouvrir le brouillon IA", openVersionZeroDialog),
    [openAiDialog, openVersionZeroDialog]
  );

  const handleOpenImportFromEstimateDialog = useCallback(() => {
    const didOpen = openImportFromEstimateDialog();
    if (didOpen) dismissAiDialogs();
    return didOpen;
  }, [dismissAiDialogs, openImportFromEstimateDialog]);

  const handleOpenEstimateStructureDraftDialog = useCallback(() => {
    const didOpen = openEstimateStructureDraftDialog();
    if (didOpen) dismissAiDialogs();
    return didOpen;
  }, [dismissAiDialogs, openEstimateStructureDraftDialog]);

  const autoOpen = resolveEstimateEditorAutoOpenDialogs({
    autoOpenVersionZero,
    autoOpenStructureDraft,
  });

  const actions = useMemo(
    () => ({
      invalidateAfterAiMutation,
      openGeneratedOuvrageDialog: handleOpenGeneratedOuvrageDialog,
      openVersionZeroDialog: handleOpenVersionZeroDialog,
      openImportFromEstimateDialog: handleOpenImportFromEstimateDialog,
      openEstimateStructureDraftDialog:
        handleOpenEstimateStructureDraftDialog,
    }),
    [
      handleOpenEstimateStructureDraftDialog,
      handleOpenGeneratedOuvrageDialog,
      handleOpenImportFromEstimateDialog,
      handleOpenVersionZeroDialog,
      invalidateAfterAiMutation,
    ]
  );

  return { actions, meta: autoOpen };
}
