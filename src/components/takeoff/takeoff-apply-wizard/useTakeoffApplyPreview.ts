"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";

import {
  previewTakeoffConversion,
  type TakeoffMappingOverride,
  type TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";

import type { TakeoffApplyStrategy, WizardStep } from "./shared";
import { toOverrideList } from "./shared";

type UseTakeoffApplyPreviewParams = {
  open: boolean;
  step: WizardStep;
  isPreset: boolean;
  jobId: string;
  strategy: TakeoffApplyStrategy;
  targetSectionId: string | null;
  overridesRef: MutableRefObject<Record<string, TakeoffMappingOverride>>;
};

export function useTakeoffApplyPreview({
  open,
  step,
  isPreset,
  jobId,
  strategy,
  targetSectionId,
  overridesRef,
}: UseTakeoffApplyPreviewParams) {
  const [previewData, setPreviewData] =
    useState<TakeoffPreviewConversionResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const refreshPreview = useCallback(
    async (overridesSnapshot: Record<string, TakeoffMappingOverride>) => {
      setIsLoadingPreview(true);
      setPreviewError(null);

      try {
        const response = await previewTakeoffConversion(jobId, {
          strategy,
          target_section_id: targetSectionId,
          overrides:
            toOverrideList(overridesSnapshot).length > 0
              ? toOverrideList(overridesSnapshot)
              : undefined,
        });
        setPreviewData(response);
      } catch (error) {
        setPreviewData(null);
        setPreviewError(
          error instanceof Error
            ? error.message
            : "Impossible de calculer la preview de conversion."
        );
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [jobId, strategy, targetSectionId]
  );

  const resetPreview = useCallback(() => {
    setPreviewData(null);
    setPreviewError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const shouldRefresh = isPreset ? step === 4 : step === 3;
    if (!shouldRefresh) return;

    void refreshPreview(overridesRef.current);
  }, [isPreset, open, overridesRef, refreshPreview, step]);

  return {
    previewData,
    previewError,
    isLoadingPreview,
    refreshPreview,
    resetPreview,
  };
}
