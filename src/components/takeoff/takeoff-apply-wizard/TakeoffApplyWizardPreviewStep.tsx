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
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function TakeoffApplyWizardPreviewStep({
  strategy,
  sourceFileName,
  includedCount,
  previewData,
  previewError,
  isLoadingPreview,
  isPreviewStale,
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
  isPreviewStale: boolean;
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
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Preview d&apos;impact
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {strategyLabel(strategy)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {strategyDescription(strategy)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {strategyCaution(strategy)}
            </p>
          </div>
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={onRefreshPreview}
            disabled={isLoadingPreview || isSubmitting}
          >
            {isLoadingPreview ? "Calcul…" : "Recalculer la preview"}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-surface-subtle p-3 text-xs text-foreground-secondary">
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
        <Alert variant="info">Calcul de la preview de conversion…</Alert>
      )}

      {previewError && (
        <Alert variant="danger">{previewError}</Alert>
      )}

      {isPreviewStale && (
        <Alert variant="info">
          Les ajustements ont changé. Recalculez la preview avant de continuer.
        </Alert>
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
              hint="règles ou mappings proposes"
            />
            <PreviewImpactCard
              label="Overrides"
              value={previewData.summary.overridden_count}
              hint="ajustements humains avant confirmation"
            />
            <PreviewImpactCard
              label="Hors mapping"
              value={previewData.summary.excluded_by_mapping_count}
              hint="lignes qui ne seront pas injectees en l'état"
            />
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Provenance visible avant confirmation
            </p>
            <p className="mt-2 text-sm text-foreground-secondary">
              Source du métré :{" "}
              <span className="font-medium text-foreground">
                {sourceFileName ?? "job takeoff"}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Chaque ligne garde sa référence takeoff quand elle est disponible.
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
