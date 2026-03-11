"use client";

import type {
  TakeoffMappingOverride,
  TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { PreviewImpactCard } from "./PreviewImpactCard";
import { TakeoffApplyPreviewTable } from "./TakeoffApplyPreviewTable";
import {
  strategyCaution,
  strategyDescription,
  strategyLabel,
  type TakeoffApplyStrategy,
} from "./shared";

export function TakeoffApplyWizardPreviewStep({
  strategy,
  sourceFileName,
  includedCount,
  previewData,
  previewError,
  isLoadingPreview,
  overrideCount,
  overridesByItemId,
  sourceByItemId,
  isSubmitting,
  onRefreshPreview,
  onOverrideActionChange,
  onOverrideParamChange,
}: {
  strategy: TakeoffApplyStrategy;
  sourceFileName?: string | null;
  includedCount: number;
  previewData: TakeoffPreviewConversionResponse | null;
  previewError: string | null;
  isLoadingPreview: boolean;
  overrideCount: number;
  overridesByItemId: Record<string, TakeoffMappingOverride>;
  sourceByItemId: Map<string, TakeoffJobItem>;
  isSubmitting: boolean;
  onRefreshPreview: () => void;
  onOverrideActionChange: (
    item: TakeoffPreviewConversionResponse["items"][number],
    value: string
  ) => void;
  onOverrideParamChange: (
    itemId: string,
    nextOverride: TakeoffMappingOverride
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
              Preview d&apos;impact
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
              {strategyLabel(strategy)}
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              {strategyDescription(strategy)}
            </p>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              {strategyCaution(strategy)}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRefreshPreview}
            disabled={isLoadingPreview || isSubmitting}
          >
            {isLoadingPreview ? "Calcul..." : "Recalculer la preview"}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-3 text-xs text-[var(--slate-700)]">
        <div className="flex flex-wrap items-center gap-4">
          <span>
            Items retenus: <strong>{previewData?.summary.included_count ?? includedCount}</strong>
          </span>
          <span>
            Transformations: <strong>{previewData?.summary.transformed_count ?? 0}</strong>
          </span>
          <span>
            Overrides: <strong>{overrideCount}</strong>
          </span>
          <span>
            Hors mapping: <strong>{previewData?.summary.excluded_by_mapping_count ?? 0}</strong>
          </span>
        </div>
      </div>

      {isLoadingPreview && (
        <div className="alert alert-info">Calcul de la preview de conversion...</div>
      )}

      {previewError && (
        <div className="alert alert-error">{previewError}</div>
      )}

      {previewData && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PreviewImpactCard
              label="Items retenus"
              value={previewData.summary.included_count}
              hint="lignes candidates pour l'application"
            />
            <PreviewImpactCard
              label="Transformations"
              value={previewData.summary.transformed_count}
              hint="regles ou mappings proposes"
            />
            <PreviewImpactCard
              label="Overrides"
              value={previewData.summary.overridden_count}
              hint="ajustements humains avant confirmation"
            />
            <PreviewImpactCard
              label="Hors mapping"
              value={previewData.summary.excluded_by_mapping_count}
              hint="lignes qui ne seront pas injectees en l'etat"
            />
          </div>

          <div className="rounded-xl border border-[var(--slate-200)] bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
              Provenance visible avant confirmation
            </p>
            <p className="mt-2 text-sm text-[var(--slate-700)]">
              Source du metre :{" "}
              <span className="font-medium text-[var(--slate-800)]">
                {sourceFileName ?? "job takeoff"}
              </span>
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              Chaque ligne garde sa reference takeoff quand elle est disponible.
            </p>
          </div>

          <TakeoffApplyPreviewTable
            items={previewData.items}
            overridesByItemId={overridesByItemId}
            sourceByItemId={sourceByItemId}
            isSubmitting={isSubmitting}
            onOverrideActionChange={onOverrideActionChange}
            onOverrideParamChange={onOverrideParamChange}
          />
        </div>
      )}
    </div>
  );
}
