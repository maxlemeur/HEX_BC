"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

import {
  previewTakeoffConversion,
  type TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import { fetchTakeoffPageReplacement } from "@/lib/takeoff/page-replacement-client";
import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import { takeoffApplyStrategyFor, type TakeoffApplyStrategy } from "./shared";

/**
 * One selection of the screen « Envoyer au tableau de chiffrage »: the section chosen and the strategy computed for the
 * version. `id` grows with every new selection, a section chosen again included: A, then B, then A again is a third
 * generation, never the first.
 */
export type TakeoffApplyGeneration = { id: number; targetSectionId: string; strategy: TakeoffApplyStrategy };

type ReadResult<T> = { generation: number; data: T | null; error: string | null };

export type TakeoffApplyRead<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  retry: () => void;
};

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/**
 * The two reads the screen confirms on, issued together for each generation and without a click: the impact preview and
 * the proposal of the pages already in the estimate. An answer is current only for the generation it was asked for (the
 * independent review of eea9e030: a result kept under its section and strategy alone came back current when the section
 * was chosen again, before its new reads answered); another job remounts the screen, hence this state. `retry` asks one
 * failed read again for the same generation.
 *
 * The proposal says whether the version holds DPGF lines when it is read (`merge_required`). When that disagrees with the
 * strategy of the generation, its answers are dropped and `onStrategyChange` is told: the caller starts a generation for
 * that strategy, whose two reads are issued again, so that the preview, the proposal and the application share it.
 */
export function useTakeoffApplyReads({ jobId, generation, onStrategyChange }: {
  jobId: string;
  generation: TakeoffApplyGeneration | null;
  onStrategyChange: (generationId: number, holdsDpgfLines: boolean) => void;
}) {
  const [preview, setPreview] = useState<ReadResult<TakeoffPreviewConversionResponse> | null>(null);
  const [pages, setPages] = useState<ReadResult<TakeoffPageReplacementResponse> | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [pagesAttempt, setPagesAttempt] = useState(0);
  const generationId = generation?.id ?? null;
  const targetSectionId = generation?.targetSectionId ?? null;
  const strategy = generation?.strategy ?? null;
  // Read when the proposal answers: a new callback asks nothing again.
  const strategyChanged = useEffectEvent(onStrategyChange);

  useEffect(() => {
    if (generationId === null || !targetSectionId || !strategy) return;
    let current = true;
    previewTakeoffConversion(jobId, { strategy, target_section_id: targetSectionId }).then(
      (data) => { if (current) setPreview({ generation: generationId, data, error: null }); },
      (error: unknown) => {
        if (current) setPreview({ generation: generationId, data: null,
          error: errorMessage(error, "Impossible de calculer l’aperçu d’impact.") });
      });
    return () => { current = false; };
  }, [generationId, jobId, previewAttempt, strategy, targetSectionId]);

  useEffect(() => {
    if (generationId === null || !targetSectionId || !strategy) return;
    const controller = new AbortController();
    void fetchTakeoffPageReplacement(jobId, { strategy, target_section_id: targetSectionId }, { signal: controller.signal }).then(
      (data) => {
        if (controller.signal.aborted) return;
        if (takeoffApplyStrategyFor({ holdsDpgfLines: data.merge_required }) !== strategy) {
          strategyChanged(generationId, data.merge_required);
          return;
        }
        setPages({ generation: generationId, data, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setPages({ generation: generationId, data: null,
          error: errorMessage(error, "Impossible de proposer le remplacement des pages déjà au devis.") });
      });
    return () => controller.abort();
  }, [generationId, jobId, pagesAttempt, strategy, targetSectionId]);

  const isCurrent = (result: ReadResult<unknown> | null) =>
    generationId !== null && result !== null && result.generation === generationId;
  const previewRead = isCurrent(preview) ? preview : null;
  const pagesRead = isCurrent(pages) ? pages : null;
  const retryPreview = useCallback(() => { setPreview(null); setPreviewAttempt((count) => count + 1); }, []);
  const retryPages = useCallback(() => { setPages(null); setPagesAttempt((count) => count + 1); }, []);

  return {
    preview: { data: previewRead?.data ?? null, error: previewRead?.error ?? null, loading: generationId !== null && !previewRead,
      retry: retryPreview } satisfies TakeoffApplyRead<TakeoffPreviewConversionResponse>,
    pages: { data: pagesRead?.data ?? null, error: pagesRead?.error ?? null, loading: generationId !== null && !pagesRead,
      retry: retryPages } satisfies TakeoffApplyRead<TakeoffPageReplacementResponse>,
  };
}
