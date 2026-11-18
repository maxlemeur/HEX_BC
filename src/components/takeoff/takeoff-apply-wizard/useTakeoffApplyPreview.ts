"use client";

import { useCallback, useEffect, useState } from "react";

import {
  previewTakeoffConversion,
  type TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";

import type { TakeoffApplyStrategy } from "./shared";

export type TakeoffApplyPreviewRequest = {
  strategy: TakeoffApplyStrategy;
  targetSectionId: string;
};

type PreviewResult = { key: string; data: TakeoffPreviewConversionResponse | null; error: string | null };

/**
 * The impact preview of the screen « Envoyer au tableau de chiffrage », computed as soon as there is a request (the
 * sections are read and one is chosen) and again for each new request, without a click. A result is only ever read
 * under the request it was computed for: a late answer for an earlier section or strategy is dropped, never shown nor
 * confirmed. `retry` computes the same request again (after a failure).
 */
export function useTakeoffApplyPreview({ jobId, request }: { jobId: string; request: TakeoffApplyPreviewRequest | null }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const key = request ? JSON.stringify([request.strategy, request.targetSectionId, attempt]) : null;

  useEffect(() => {
    if (!key) return;
    const [strategy, targetSectionId] = JSON.parse(key) as [TakeoffApplyStrategy, string, number];
    let current = true;
    previewTakeoffConversion(jobId, { strategy, target_section_id: targetSectionId }).then(
      (data) => { if (current) setResult({ key, data, error: null }); },
      (error: unknown) => {
        if (current) setResult({ key, data: null,
          error: error instanceof Error && error.message ? error.message : "Impossible de calculer l’aperçu d’impact." });
      });
    return () => { current = false; };
  }, [jobId, key]);

  const read = result && result.key === key ? result : null;
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const reset = useCallback(() => setResult(null), []);
  return {
    previewData: read?.data ?? null,
    previewError: read?.error ?? null,
    isLoadingPreview: key !== null && read === null,
    retry,
    reset,
  };
}
